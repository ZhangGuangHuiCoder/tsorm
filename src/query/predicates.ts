import { allOf, fail, OrmError, checkObject, object } from "../shared/index.js";
import { internalColumnName, internalPrimaryKey, internalTableName, type Schema, type Table, type Column } from "../schema/model.js";
import type { Dialect } from "../core/adapter.js";

// ─── Soft-delete visibility ────────────────────────────────────────────────
export type DeletedMode = "exclude" | "include" | "only";
export const visibility = Symbol("visibility");
export function visibleWhere(where: any, mode?: DeletedMode): any {
  if (where !== undefined && (where === null || typeof where !== "object" || Array.isArray(where))) {
    fail("where must be an object");
  }
  const selected = mode ?? where?.[visibility] ?? "exclude";
  if (!["exclude", "include", "only"].includes(selected)) {
    fail("Invalid deleted mode");
  }
  return { ...where, [visibility]: selected };
}

// ─── Field updates ─────────────────────────────────────────────────────────
export type NumericUpdate<T = number, O = number> =
  | { set: T; increment?: never; decrement?: never; multiply?: never; divide?: never }
  | { increment: O; set?: never; decrement?: never; multiply?: never; divide?: never }
  | { decrement: O; set?: never; increment?: never; multiply?: never; divide?: never }
  | { multiply: O; set?: never; increment?: never; decrement?: never; divide?: never }
  | { divide: O; set?: never; increment?: never; decrement?: never; multiply?: never };
type ArithmeticOperation = "increment" | "decrement" | "multiply" | "divide";
export type UpdateValue = { kind: "set"; value: any } | { kind: "arithmetic"; value: number | bigint | string; operation: ArithmeticOperation };
export function updateValue(column: Column, value: any, encode: (c: Column, v: any) => any): UpdateValue {
  if (column.type === "json" && (!object(value) || !Object.hasOwn(value, "set"))) {
    return { kind: "set", value: encode(column, value) };
  }
  if (!object(value)) {
    return { kind: "set", value: encode(column, value) };
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    fail("Use exactly one field update operation");
  }
  const operation = keys[0];
  const operand = value[operation];
  if (operation === "set") {
    return { kind: "set", value: encode(column, operand) };
  }
  if (!["int", "bigint", "number", "decimal"].includes(column.type) || !["increment", "decrement", "multiply", "divide"].includes(operation)) {
    fail("Invalid numeric update operation");
  }
  if (column.type === "bigint" || column.type === "decimal") {
    // Validate the operand as a value of the column type, ignoring the column's size limits.
    const operandValue = encode({ ...column, nullable: false, precision: undefined, scale: undefined }, operand);
    if (operation === "divide" && Number(operandValue) === 0) {
      fail("Cannot divide by zero");
    }
    return { kind: "arithmetic", operation: operation as ArithmeticOperation, value: operandValue };
  }
  if (typeof operand !== "number" || !Number.isFinite(operand) || (column.type === "int" && !Number.isSafeInteger(operand))) {
    fail("Invalid numeric update operand");
  }
  if (operation === "divide" && operand === 0) {
    fail("Cannot divide by zero");
  }
  return { kind: "arithmetic", operation: operation as ArithmeticOperation, value: operand };
}
/**
 * 规范化标量 orderBy 项中的 'asc' | 'desc' | { sort, nulls? }。
 * Normalizes 'asc' | 'desc' | { sort, nulls? } for a scalar orderBy entry.
 */
export function sortOrder(value: unknown): { sort: "asc" | "desc"; nulls?: "first" | "last" } {
  if (value === "asc" || value === "desc") {
    return { sort: value };
  }
  const v = value as any;
  if (
    object(v) &&
    Object.keys(v).every((k) => {
      return k === "sort" || k === "nulls";
    }) &&
    ["asc", "desc"].includes(v.sort) &&
    [undefined, "first", "last"].includes(v.nulls)
  ) {
    return v;
  }
  return fail("Invalid orderBy");
}
/**
 * 除非 `nulls` 显式指定位置，否则 NULL 按最小值排序。
 * NULL sorts as the smallest value unless `nulls` places it explicitly.
 */
export const nullsFirst = (sort: string, nulls?: string): boolean => {
  return nulls ? nulls === "first" : sort === "asc";
};
export class QueryCompiler {
  alias = 0;
  constructor(
    readonly schema: Schema,
    readonly dialect: Dialect,
  ) {}
  get quote() {
    return this.dialect.quote;
  }
  get encode() {
    return this.dialect.encode;
  }
  /** Quoted physical table name. */
  table(t: Table): string {
    return this.quote(internalTableName(t));
  }
  /** Qualified physical column of a model field. */
  column(t: Table, alias: string, field: string): string {
    const c = t.columns[field];
    return this.quote(alias) + "." + this.quote(c ? internalColumnName(c) : field);
  }
  bind(params: any[], value: any): string {
    params.push(value);
    return this.dialect.parameter(params.length);
  }
  get truth() {
    return this.dialect.trueLiteral;
  }
  get falsity() {
    return this.dialect.falseLiteral;
  }
  predicate(t: Table, where: any, alias: string, params: any[], depth = 0, unguarded = false): string {
    const q = this.quote;
    if (depth > 12) {
      fail("Maximum query depth is 12");
    }
    if (where === undefined) {
      where = {};
    }
    checkObject(where, "where");
    const pieces: string[] = [];
    for (const [key, v] of Object.entries(where)) {
      if (key === "AND" || key === "OR") {
        if (!Array.isArray(v)) {
          fail(`${key} requires an array`);
        }
        const items = v as any[];
        if (!items.length) {
          pieces.push(key === "AND" ? this.truth : this.falsity);
        } else {
          const parts = items.map((w: any) => {
            return this.predicate(t, w, alias, params, depth + 1, true);
          });
          pieces.push("(" + parts.join(` ${key} `) + ")");
        }
        continue;
      }
      if (key === "NOT") {
        pieces.push(`NOT (${this.predicate(t, v, alias, params, depth + 1, true)})`);
        continue;
      }
      const c = t.columns[key];
      if (c) {
        pieces.push(this.scalar(c, this.column(t, alias, key), v, params));
        continue;
      }
      const r = t.relations[key];
      if (!r) {
        fail(`Unknown field ${t.name}.${key}`);
      }
      if (r.polymorphic && r.owner) {
        fail(`Polymorphic relation ${key} cannot be filtered`);
      }
      checkObject(v, "relation filter");
      for (const [op, filter] of Object.entries(v as any)) {
        if (!(r.many ? ["some", "none", "every"] : ["is", "isNot"]).includes(op)) {
          fail(`Invalid relation operator ${op}`);
        }
        if (r.many && filter === null) {
          fail("Array relation filter cannot be null");
        }
        const target = this.schema.tables[r.target];
        const child = "r" + this.alias++;
        const j = "j" + this.alias++;
        const { join, link } = this.link(t, r, alias, child, j, params);
        let condition = filter === null ? this.truth : this.predicate(target, filter, child, params, depth + 1, true);
        if (op === "every") {
          condition = `NOT (${condition})`;
        }
        if (target.softDelete) {
          condition = "(" + condition + ") AND " + this.column(target, child, target.softDelete) + " IS NULL";
        }
        const exists = `EXISTS (SELECT 1 FROM ${this.table(target)} ${q(child)}${join} WHERE ${link} AND (${condition}))`;
        const negate = op === "none" || op === "every" || (op === "is" && filter === null) || (op === "isNot" && filter !== null);
        pieces.push(negate ? `NOT ${exists}` : exists);
      }
    }
    if (t.softDelete && !unguarded) {
      const mode = where[visibility] ?? "exclude";
      if (mode !== "include") {
        pieces.push(this.column(t, alias, t.softDelete) + (mode === "only" ? " IS NOT NULL" : " IS NULL"));
      }
    }
    return allOf(pieces, this.truth);
  }
  /** Join and correlation between a parent row (alias) and related rows (child). */
  link(t: Table, r: Table["relations"][string], alias: string, child: string, j: string, params: any[]) {
    const q = this.quote;
    const target = this.schema.tables[r.target];
    const join = r.junction ? ` JOIN ${q(r.junction)} ${q(j)} ON ${q(j)}.${q(r.junctionTarget!)}=${this.column(target, child, r.foreign)}` : "";
    let link = r.junction ? `${q(j)}.${q(r.junctionSource!)}=${this.column(t, alias, r.source)}` : `${this.column(target, child, r.foreign)}=${this.column(t, alias, r.source)}`;
    // Polymorphic inverse relation: fix the discriminator value in the join condition.
    if (r.discriminator !== undefined && !r.junction) {
      link += " AND " + this.column(target, child, r.discriminator) + "=" + this.bind(params, this.encode(target.columns[r.discriminator], r.discriminatorValue));
    }
    return { join, link };
  }
  scalar(c: Column, col: string, value: any, params: any[], insensitive = false): string {
    const encode = this.encode;
    if (c.type === "json") {
      return this.json(c, col, value, params);
    }
    const parameter = (input: any) => {
      const bound = this.bind(params, encode(c, input));
      return c.type === "decimal" && this.dialect.decimalComparisonOperand ? this.dialect.decimalComparisonOperand(bound) : bound;
    };
    const lower = (sql: string, on: boolean) => {
      return on ? `LOWER(${sql})` : sql;
    };
    // Comparisons must stay two-valued so NOT works. A NOT NULL column already is; for a nullable
    // one, "AND col IS NOT NULL" turns NULL into false. Unlike COALESCE, both keep indexes usable.
    const total = (sql: string) => {
      return c.nullable ? `(${sql} AND ${col} IS NOT NULL)` : sql;
    };
    if (!object(value)) {
      if (value === null) {
        if (!c.nullable) {
          fail(`${c.name} is not nullable`);
        }
        return `${col} IS NULL`;
      }
      return total(`${lower(col, insensitive)} = ${lower(parameter(value), insensitive)}`);
    }
    let mode = insensitive;
    if (Object.hasOwn(value, "mode")) {
      if (c.type !== "string" && c.type !== "text") {
        fail("mode requires a string field");
      }
      if (!["default", "insensitive"].includes(value.mode)) {
        fail('mode must be "default" or "insensitive"');
      }
      mode = value.mode === "insensitive";
    }
    const pieces: string[] = [];
    for (const [op, v] of Object.entries(value)) {
      if (op === "mode") {
        continue;
      }
      if (op === "equals") {
        pieces.push(this.scalar(c, col, v, params, mode));
        continue;
      }
      if (op === "not") {
        pieces.push(`NOT (${this.scalar(c, col, v, params, mode)})`);
        continue;
      }
      if (op === "in" || op === "notIn") {
        if (!Array.isArray(v)) {
          fail(`${op} requires array`);
        }
        const terms = (v as any[]).map((x) => {
          return this.scalar(c, col, x, params, mode);
        });
        const expr = terms.length ? "(" + terms.join(" OR ") + ")" : this.falsity;
        pieces.push(op === "notIn" ? `NOT (${expr})` : expr);
        continue;
      }
      if (["gt", "gte", "lt", "lte"].includes(op)) {
        if (c.type === "boolean" || v === null) {
          fail("Ordered comparison requires non-null ordered scalar");
        }
        pieces.push(total(`${lower(col, mode)} ${{ gt: ">", gte: ">=", lt: "<", lte: "<=" }[op]} ${lower(parameter(v), mode)}`));
        continue;
      }
      if (["contains", "startsWith", "endsWith"].includes(op)) {
        if ((c.type !== "string" && c.type !== "text") || typeof v !== "string") {
          fail(`${op} requires string`);
        }
        const placeholder = this.bind(params, this.pattern(op, v as string));
        pieces.push(total(this.dialect.containsPredicate(col, placeholder, mode)));
        continue;
      }
      fail(`Unknown filter ${op}`);
    }
    return allOf(pieces, this.truth);
  }
  /** LIKE pattern with %, _ and ! escaped. Serves both contains/startsWith/endsWith and string_* operators. */
  pattern(op: string, value: string): string {
    const s = value.replace(/[!%_]/g, "!$&");
    const start = op.endsWith("ontains") || op === "endsWith" || op.endsWith("ends_with");
    const end = op.endsWith("ontains") || op === "startsWith" || op.endsWith("starts_with");
    return (start ? "%" : "") + s + (end ? "%" : "");
  }
  /** Filters on a value inside a JSON field: `{ path: ['a', 0], equals | gt | string_contains ... }`. */
  json(c: Column, col: string, value: any, params: any[]): string {
    if (!object(value)) {
      fail(`${c.name} requires a JSON filter with a path`);
    }
    const allowed = ["path", "equals", "not", "gt", "gte", "lt", "lte", "string_contains", "string_starts_with", "string_ends_with"];
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        fail(`Unknown JSON filter ${key}`);
      }
    }
    const path = value.path;
    if (
      !Array.isArray(path) ||
      !path.length ||
      path.some((p: unknown) => {
        return typeof p !== "string" && !(typeof p === "number" && Number.isSafeInteger(p) && p >= 0);
      })
    ) {
      fail("JSON filter path must be a non-empty array of keys and array indexes");
    }
    // Placeholders bind in text order, so expression building lives in the dialect.
    return this.dialect.json.predicate(col, path as (string | number)[], value, params, {
      bind: (p, v) => {
        return this.bind(p, v);
      },
      pattern: (op, v) => {
        return this.pattern(op, v);
      },
      truth: this.truth,
      falsity: this.falsity,
    });
  }
  validate(t: Table, args: any, depth = 0): void {
    if (depth > 8) {
      fail("Maximum selection depth is 8");
    }
    checkObject(args, "query");
    for (const k of Object.keys(args)) {
      if (!["where", "select", "include", "orderBy", "skip", "take", "cursor", "distinct", "omit", "deleted"].includes(k)) {
        fail(`Unknown query option ${k}`);
      }
    }
    if (args.select !== undefined && args.include !== undefined) {
      fail("select and include are mutually exclusive");
    }
    visibleWhere(args.where, args.deleted);
    if (args.cursor !== undefined) {
      if (depth > 0) {
        fail("Nested cursor is not supported yet");
      }
      this.unique(t, args.cursor);
    }
    if (args.distinct !== undefined) {
      if (depth > 0) {
        fail("Nested distinct is not supported yet");
      }
      const fields = Array.isArray(args.distinct) ? args.distinct : [args.distinct];
      if (
        !fields.length ||
        new Set(fields).size !== fields.length ||
        fields.some((k: any) => {
          return !t.columns[k] || t.columns[k].type === "json";
        })
      ) {
        fail("distinct requires scalar fields");
      }
    }
    if (args.omit !== undefined) {
      if (args.select !== undefined) {
        fail("select and omit are mutually exclusive");
      }
      checkObject(args.omit, "omit");
      for (const [name, value] of Object.entries(args.omit)) {
        if ((!t.columns[name] && !t.virtuals?.[name]) || typeof value !== "boolean") {
          fail("Invalid omitted field");
        }
      }
    }
    this.predicate(t, args.where, "v", []);
    for (const k of ["skip", "take"]) {
      if (args[k] !== undefined && (!Number.isSafeInteger(args[k]) || args[k] < 0)) {
        fail(`${k} must be a nonnegative integer`);
      }
    }
    // The related-row paging path binds skip + take as one rank upper bound; reject
    // an overflowing sum here so it stays an exact integer when bound to SQL.
    if (args.skip !== undefined && args.take !== undefined && !Number.isSafeInteger(args.skip + args.take)) {
      fail("skip + take exceeds the safe integer range");
    }
    this.order(t, args.orderBy, "v", []);
    for (const kind of ["select", "include"]) {
      if (args[kind] !== undefined) {
        checkObject(args[kind], kind);
        for (const [name, option] of Object.entries(args[kind])) {
          if (name === "_count") {
            if (typeof option === "boolean") {
              continue;
            }
            checkObject(option, "relation count");
            if (
              Object.keys(option as object).some((k) => {
                return k !== "select";
              }) ||
              !(option as any).select
            ) {
              fail("_count requires select");
            }
            checkObject((option as any).select, "count select");
            for (const [field, filter] of Object.entries((option as any).select)) {
              const relation = t.relations[field];
              if (!relation?.many) {
                fail("Relation count requires a many relation");
              }
              if (typeof filter !== "boolean") {
                checkObject(filter, "count filter");
                if (
                  Object.keys(filter as object).some((k) => {
                    return k !== "where";
                  })
                ) {
                  fail("Relation count only accepts where");
                }
                this.predicate(this.schema.tables[relation.target], (filter as any).where, "v", []);
              }
            }
            continue;
          }
          if ((t.columns[name] || t.virtuals?.[name]) && kind === "select") {
            if (typeof option !== "boolean") {
              fail("Scalar selection requires boolean");
            }
            continue;
          }
          const r = t.relations[name];
          if (!r) {
            fail(`Unknown ${kind} field ${name}`);
          }
          // Use dedicated error codes for include/select, matching the runtime guard in project.
          if (r.polymorphic && r.owner) {
            throw new OrmError("POLYMORPHIC_INCLUDE", `Polymorphic relation ${name} does not support ${kind}`);
          }
          if (typeof option === "boolean") {
            continue;
          }
          this.validate(this.schema.tables[r.target], option, depth + 1);
          if (
            !r.many &&
            Object.keys(option as object).some((k) => {
              return ["where", "skip", "take", "orderBy"].includes(k);
            })
          ) {
            fail("Single relation only supports select/include");
          }
        }
      }
    }
  }
  order(t: Table, order: any, alias: string, values: any[]): string {
    const list = [order ?? []].flat();
    const parts: string[] = [];
    const keys = internalPrimaryKey(t);
    const seen = new Set<string>();
    for (const item of list) {
      checkObject(item, "orderBy");
      for (const [expression, direction, placement] of this.orderTerms(t, alias, item, 0, values)) {
        const first = nullsFirst(direction, placement);
        const nulls = this.dialect.nullsOrder(first);
        if (nulls) {
          parts.push(`${expression} ${direction} ${nulls}`);
        } else if (placement && first !== (direction === "asc")) {
          parts.push(`${expression} IS NULL ${first ? "DESC" : "ASC"}`, `${expression} ${direction}`);
        } else {
          parts.push(`${expression} ${direction}`);
        }
        seen.add(expression);
      }
    }
    for (const key of keys) {
      if (!seen.has(this.column(t, alias, key))) {
        parts.push(`${this.column(t, alias, key)} ASC`);
      }
    }
    return parts.join(", ");
  }
  /** Sort expressions for one orderBy object; relations sort through correlated subqueries. */
  orderTerms(t: Table, alias: string, item: any, depth: number, values: any[]): [string, string, string?][] {
    if (depth > 4) {
      fail("orderBy nests at most 4 relations");
    }
    const q = this.quote;
    const terms: [string, string, string?][] = [];
    for (const [k, v] of Object.entries(item)) {
      const c = t.columns[k];
      if (c) {
        const { sort, nulls } = sortOrder(v);
        if (c.type === "json") {
          fail("Invalid orderBy");
        }
        terms.push([this.column(t, alias, k), sort, nulls]);
        continue;
      }
      const r = t.relations[k];
      if (!r || !object(v)) {
        fail("Invalid orderBy");
      }
      if (r.polymorphic && r.owner) {
        fail(`Polymorphic relation ${k} cannot order`);
      }
      const target = this.schema.tables[r.target];
      const child = "o" + this.alias++;
      const j = "oj" + this.alias++;
      const { join, link } = this.link(t, r, alias, child, j, values);
      const visible = target.softDelete ? " AND " + this.column(target, child, target.softDelete) + " IS NULL" : "";
      if (r.many) {
        const keys = Object.keys(v as object);
        if (keys.length !== 1 || keys[0] !== "_count" || !["asc", "desc"].includes((v as any)._count)) {
          fail('Many relations order by { _count: "asc" | "desc" }');
        }
        terms.push([`(SELECT COUNT(*) FROM ${this.table(target)} ${q(child)}${join} WHERE ${link}${visible})`, (v as any)._count]);
        continue;
      }
      checkObject(v, "orderBy");
      for (const [expression, direction, placement] of this.orderTerms(target, child, v, depth + 1, values)) {
        terms.push([`(SELECT ${expression} FROM ${this.table(target)} ${q(child)} WHERE ${link}${visible})`, direction, placement]);
      }
    }
    return terms;
  }
  unique(t: Table, where: any): void {
    const encode = this.encode;
    checkObject(where, "unique where");
    const keys = Object.keys(where);
    const allowed =
      (keys.length === 1 && (t.columns[keys[0]]?.unique || keys[0] === t.primary)) ||
      [...t.unique, ...(t.primaryKey?.length ? [t.primaryKey] : [])].some((u) => {
        return (
          u.length === keys.length &&
          u.every((k) => {
            return keys.includes(k);
          })
        );
      });
    if (!allowed) {
      fail("where must specify one complete unique key");
    }
    for (const k of keys) {
      if (where[k] === null) {
        fail("Unique key cannot be null");
      }
      encode(t.columns[k], where[k]);
    }
  }
  updateValues(t: Table, data: any, managed = false): any {
    const encode = this.encode;
    checkObject(data, "data");
    const values: any = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) {
        continue;
      }
      const c = t.columns[k];
      if (k === t.softDelete && !managed) {
        fail("Use delete/restore for the soft-delete field");
      }
      if (!c || internalPrimaryKey(t).includes(k) || c.auto) {
        fail(`Cannot update ${k}; this version accepts scalar updates only`);
      }
      values[k] = updateValue(c, v, encode);
    }
    // @updatedAt follows every user update unless it is assigned explicitly.
    if (!managed && Object.keys(values).length) {
      for (const c of Object.values(t.columns)) {
        if (c.updatedAt && !Object.hasOwn(values, c.name)) {
          values[c.name] = { kind: "set", value: encode(c, new Date()) };
        }
      }
    }
    return values;
  }
}
