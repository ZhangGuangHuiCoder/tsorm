import { visibleWhere, type DeletedMode } from "../query/predicates.js";
import type { Engine } from "./engine.js";
import type { Table, Column } from "../schema/model.js";
import type { Spec, Where, ScalarFilter, QueryableRow, Simplify } from "./client-types.js";
import { fail, allOf, checkObject, object, safeInteger, finiteNumber, decodeBigInt, decodeDecimal } from "../shared/index.js";

const operations = ["_count", "_sum", "_avg", "_min", "_max"] as const;
type Operation = (typeof operations)[number];
export async function analytics(engine: Engine, table: Table, args: any = {}, grouped = false): Promise<any> {
  checkObject(args, "aggregate");
  const allowed = ["where", "deleted", "orderBy", "skip", "take", ...operations, ...(grouped ? ["by", "having"] : [])];
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) {
      fail("Unknown aggregate option " + key);
    }
  }
  let by: string[] = [];
  if (grouped && Array.isArray(args.by)) {
    by = args.by;
  }
  if (
    grouped &&
    (!by.length ||
      new Set(by).size !== by.length ||
      by.some((k) => {
        return !table.columns[k] || table.columns[k].type === "json";
      }))
  ) {
    fail("by requires distinct scalar fields");
  }
  const q = engine.quote;
  const d = engine.adapter.dialect;
  const values: any[] = [];
  const selected: { op: Operation; field: string; alias: string; column?: Column }[] = [];
  // Grouped queries read the table itself; aggregates read an aliased subquery.
  const column = (field: string) => {
    return grouped ? engine.column(table, "t", field) : q("t") + "." + q(field);
  };
  const aggregate = (op: Operation, field: string) => {
    if (field === "_all") {
      if (op !== "_count") {
        fail("_all only supports count");
      }
      return "COUNT(*)";
    }
    const c = table.columns[field];
    if (!c) {
      fail("Unknown aggregate field " + field);
    }
    if (c.type === "json") {
      fail("JSON aggregation is not supported");
    }
    if ((op === "_avg" || op === "_sum") && !["int", "bigint", "number", "decimal"].includes(c.type)) {
      fail(op + " requires numeric field");
    }
    // Boolean min/max has no plain aggregate in some dialects; the dialect provides the equivalent.
    if (c.type === "boolean" && (op === "_min" || op === "_max")) {
      return d.booleanMinMax(op === "_min" ? "MIN" : "MAX", column(field));
    }
    return op.slice(1).toUpperCase() + "(" + column(field) + ")";
  };
  const select = by.map((field) => {
    return column(field) + " AS " + q(field);
  });
  for (const op of operations) {
    const input = args[op];
    if (input === undefined || input === false) {
      continue;
    }
    if (input === true && op === "_count") {
      selected.push({ op, field: "_all", alias: "__orm_count_all" });
      select.push("COUNT(*) AS " + q("__orm_count_all"));
      continue;
    }
    checkObject(input, op);
    for (const [field, enabled] of Object.entries(input)) {
      if (typeof enabled !== "boolean") {
        fail("Aggregate selection requires boolean");
      }
      if (!enabled) {
        continue;
      }
      const expression = aggregate(op, field);
      const alias = "__orm" + op + "_" + field;
      selected.push({ op, field, alias, column: table.columns[field] });
      select.push(expression + " AS " + q(alias));
    }
  }
  if (!select.length) {
    fail("Select at least one aggregate");
  }
  let text: string;
  if (!grouped) {
    const scope = { where: visibleWhere(args.where, args.deleted), orderBy: args.orderBy, skip: args.skip, take: args.take };
    const source = engine.compile({
      kind: "select",
      table,
      args: {
        select: Object.fromEntries(
          selected
            .filter((item) => {
              return item.field !== "_all";
            })
            .map((item) => {
              return [item.field, true];
            }),
        ),
        ...scope,
      },
    });
    engine.validate(table, scope);
    // Expressions carry no parameters; reuse the structurally compiled source values.
    values.push(...source.values);
    text = "SELECT " + select.join(",") + " FROM (" + source.text + ") AS " + q("t");
  } else {
    const having = (input: any, depth = 0): string => {
      if (input === undefined) {
        return engine.truth;
      }
      if (depth > 12) {
        fail("Maximum having depth is 12");
      }
      checkObject(input, "having");
      const pieces: string[] = [];
      for (const [field, value] of Object.entries(input)) {
        if (field === "AND" || field === "OR") {
          if (!Array.isArray(value)) {
            fail(field + " requires array");
          }
          const items = value as any[];
          if (!items.length) {
            pieces.push(field === "AND" ? engine.truth : engine.falsity);
          } else {
            const parts = items.map((v: any) => {
              return having(v, depth + 1);
            });
            pieces.push("(" + parts.join(" " + field + " ") + ")");
          }
          continue;
        }
        if (field === "NOT") {
          pieces.push("NOT (" + having(value, depth + 1) + ")");
          continue;
        }
        const c = table.columns[field];
        if (!c) {
          fail("Unknown having field " + field);
        }
        if (object(value)) {
          const scalars: any = {};
          for (const [key, filter] of Object.entries(value as object)) {
            if (operations.includes(key as Operation)) {
              const op = key as Operation;
              const expression = aggregate(op, field);
              let operand: Column = c;
              if (op === "_count") {
                operand = { ...c, type: "int", nullable: false };
              } else if (c.type === "decimal" && (op === "_sum" || op === "_avg")) {
                operand = { ...c, precision: undefined, scale: undefined };
              } else if (op === "_avg") {
                operand = {
                  ...c,
                  type: c.type === "bigint" ? "decimal" : "number",
                  precision: undefined,
                  scale: undefined,
                };
              }
              pieces.push(engine.scalar(operand, expression, filter, values));
            } else {
              scalars[key] = filter;
            }
          }
          if (Object.keys(scalars).length) {
            if (!by.includes(field)) {
              fail("Plain having field must appear in by");
            }
            pieces.push(engine.scalar(c, column(field), scalars, values));
          }
        } else {
          if (!by.includes(field)) {
            fail("Plain having field must appear in by");
          }
          pieces.push(engine.scalar(c, column(field), value, values));
        }
      }
      return allOf(pieces, engine.truth);
    };
    const where = engine.predicate(table, visibleWhere(args.where, args.deleted), "t", values);
    text = "SELECT " + select.join(",") + " FROM " + engine.table(table) + " " + q("t") + " WHERE " + where + " GROUP BY " + by.map(column).join(",");
    if (args.having !== undefined) {
      text += " HAVING " + having(args.having);
    }
    const orders: string[] = [];
    for (const item of [args.orderBy ?? []].flat()) {
      checkObject(item, "orderBy");
      for (const [key, value] of Object.entries(item)) {
        if (operations.includes(key as Operation)) {
          checkObject(value, "aggregate orderBy");
          for (const [field, direction] of Object.entries(value as object)) {
            if (!["asc", "desc"].includes(direction as string)) {
              fail("Invalid aggregate order");
            }
            const nulls = d.nullsOrder(direction === "asc");
            orders.push(aggregate(key as Operation, field) + " " + direction + (nulls ? " " + nulls : ""));
          }
        } else {
          if (!by.includes(key) || !["asc", "desc"].includes(value as string)) {
            fail("Group order field must appear in by");
          }
          const nulls = d.nullsOrder(value === "asc");
          orders.push(column(key) + " " + value + (nulls ? " " + nulls : ""));
        }
      }
    }
    if ((args.take !== undefined || args.skip !== undefined) && !orders.length) {
      fail("Grouped pagination requires orderBy");
    }
    for (const key of ["skip", "take"]) {
      if (args[key] !== undefined && (!Number.isSafeInteger(args[key]) || args[key] < 0)) {
        fail(key + " requires nonnegative integer");
      }
    }
    const defaultNull = d.nullsOrder(true);
    const defaultNulls = defaultNull ? " " + defaultNull : "";
    const ordering = orders.length
      ? orders
      : by.map((field) => {
          return column(field) + " ASC" + defaultNulls;
        });
    // The dialect decides whether a large page value is bound as an integer or a BigInt.
    text += " ORDER BY " + ordering.join(",") + " LIMIT " + engine.bind(values, d.pageValue(args.take ?? d.unlimited)) + " OFFSET " + engine.bind(values, d.pageValue(args.skip ?? 0));
  }
  const result = await engine.session.execute({ text, values });
  // Precompute row-invariant decode table descriptors and decimal operands per item, avoiding per-row rebuilds.
  const byTable = by.length ? { ...table, columns: Object.fromEntries(by.map((k) => [k, table.columns[k]])) } : undefined;
  const itemMeta = selected.map((item) => {
    const type = item.column?.type;
    const operand = item.op === "_avg" && (type === "decimal" || type === "bigint") ? { ...item.column!, scale: undefined } : item.column;
    const fieldTable = item.column && item.op !== "_count" && item.op !== "_avg" && item.op !== "_sum" ? { ...table, columns: { [item.field]: item.column } } : undefined;
    return { operand, fieldTable, type };
  });
  const decode = (raw: any) => {
    let output: any = {};
    if (byTable) {
      output = d.decode(byTable, raw);
    }
    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      const meta = itemMeta[i];
      const value = raw[item.alias];
      let decoded: any = value;
      if (value !== null) {
        if (item.op === "_count") {
          decoded = safeInteger(value);
        } else if (item.op === "_avg" || item.op === "_sum") {
          if (meta.type === "decimal" || (meta.type === "bigint" && item.op === "_avg")) {
            decoded = decodeDecimal(meta.operand!, value);
          } else if (item.op === "_sum" && meta.type === "int") {
            decoded = safeInteger(value);
          } else if (item.op === "_sum" && meta.type === "bigint") {
            const text = typeof value === "string" ? value.replace(/\.0+$/, "") : value;
            decoded = decodeBigInt(text);
          } else {
            decoded = finiteNumber(value);
          }
        } else {
          decoded = d.decode(meta.fieldTable!, { [item.field]: value })[item.field];
        }
      }
      if (args[item.op] === true) {
        output[item.op] = decoded;
      } else {
        output[item.op] ??= {};
        output[item.op][item.field] = decoded;
      }
    }
    return output;
  };
  return grouped ? result.rows.map(decode) : decode(result.rows[0]);
}

// ─── Aggregate and groupBy types ───────────────────────────────────────────
type Numeric<R> = {
  [K in keyof R]: NonNullable<R[K]> extends number | bigint ? K : never;
}[keyof R];
type Comparable<R> = keyof R;
type DecimalFields<S extends Spec, K extends keyof S> = S[K] extends {
  decimalFields: infer D extends string;
}
  ? Extract<D, keyof QueryableRow<S, K>>
  : never;
type BigintFields<S extends Spec, K extends keyof S> = Extract<S[K]["bigintFields"], keyof QueryableRow<S, K>>;
type NumericFields<S extends Spec, K extends keyof S> = Numeric<QueryableRow<S, K>> | DecimalFields<S, K> | BigintFields<S, K>;
type Fields<R, K extends keyof R = keyof R> = Partial<Record<K, boolean>>;
export type AggregateArgs<S extends Spec, K extends keyof S> = {
  where?: Where<S, K>;
  deleted?: DeletedMode;
  orderBy?: Partial<Record<keyof QueryableRow<S, K>, "asc" | "desc">> | Partial<Record<keyof QueryableRow<S, K>, "asc" | "desc">>[];
  skip?: number;
  take?: number;
  _count?: true | (Fields<QueryableRow<S, K>> & { _all?: boolean });
  _sum?: Fields<QueryableRow<S, K>, NumericFields<S, K>>;
  _avg?: Fields<QueryableRow<S, K>, NumericFields<S, K>>;
  _min?: Fields<QueryableRow<S, K>, Comparable<QueryableRow<S, K>>>;
  _max?: Fields<QueryableRow<S, K>, Comparable<QueryableRow<S, K>>>;
};
type Selected<P, V> = Simplify<{ [F in keyof P as P[F] extends false | undefined ? never : F]: V }>;
/**
 * 在 `A` 未解析时保持延迟，方法悬停显示 `AggregateResult<...>`；调用后展开。
 * Deferred while `A` is unresolved, so method hovers print `AggregateResult<...>`; flat once called.
 */
export type AggregateResult<R, A, D extends keyof R = never> = A extends unknown
  ? Simplify<{
      [Op in keyof A as Op extends "_count" | "_sum" | "_avg" | "_min" | "_max" ? Op : never]: Op extends "_count"
        ? A[Op] extends true
          ? number
          : Selected<A[Op], number>
        : Op extends "_avg"
          ? Simplify<{
              [F in keyof A[Op] as A[Op][F] extends false | undefined ? never : F]: F extends keyof R ? (F extends D ? string | null : number | null) : never;
            }>
          : Simplify<{
              [F in keyof A[Op] as A[Op][F] extends false | undefined ? never : F]: F extends keyof R ? R[F] | null : never;
            }>;
    }>
  : never;
type HavingOperand<R, F extends keyof R, D extends keyof R> = F extends D ? string | number | (null extends R[F] ? null : never) : R[F];
type Having<R, D extends keyof R = never> = {
  [F in keyof R]?:
    | HavingOperand<R, F, D>
    | (ScalarFilter<HavingOperand<R, F, D>> & {
        _count?: ScalarFilter<number>;
        _min?: ScalarFilter<HavingOperand<R, F, D>>;
        _max?: ScalarFilter<HavingOperand<R, F, D>>;
      } & (F extends Numeric<R> | D
          ? {
              _sum?: ScalarFilter<F extends D ? string | number : NonNullable<R[F]> extends bigint ? bigint | number : number>;
              _avg?: ScalarFilter<F extends D ? string | number : number>;
            }
          : { _sum?: never; _avg?: never }));
} & { AND?: Having<R, D>[]; OR?: Having<R, D>[]; NOT?: Having<R, D> };
export type GroupByArgs<S extends Spec, K extends keyof S> = Omit<AggregateArgs<S, K>, "orderBy"> & {
  by: readonly (keyof QueryableRow<S, K>)[];
  having?: Having<QueryableRow<S, K>, DecimalFields<S, K> | BigintFields<S, K>>;
  orderBy?: GroupOrder<QueryableRow<S, K>, DecimalFields<S, K> | BigintFields<S, K>> | GroupOrder<QueryableRow<S, K>, DecimalFields<S, K> | BigintFields<S, K>>[];
};
type GroupOrder<R, D extends keyof R = never> = Partial<Record<keyof R, "asc" | "desc">> & {
  _count?: Partial<Record<keyof R | "_all", "asc" | "desc">>;
  _sum?: Partial<Record<Numeric<R> | D, "asc" | "desc">>;
  _avg?: Partial<Record<Numeric<R> | D, "asc" | "desc">>;
  _min?: Partial<Record<Comparable<R>, "asc" | "desc">>;
  _max?: Partial<Record<Comparable<R>, "asc" | "desc">>;
};
export type GroupByResult<R, A extends { by: readonly PropertyKey[] }, D extends keyof R = never> = A extends unknown ? Simplify<Pick<R, A["by"][number] & keyof R> & AggregateResult<R, A, D>> : never;
