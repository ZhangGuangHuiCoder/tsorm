import { visibleWhere } from "./visibility.js";
import type { UpdateValue } from "./updates.js";
import { columnName, omitted, primaryKey, type Table, type Relation, type Schema } from "../schema/index.js";
import { QueryCompiler } from "./predicates.js";
import { OrmError } from "../shared/errors.js";
import type { RuntimeAdapter, CompiledSQL } from "../core/adapter.js";
export type Statement =
  | {
      kind: "select";
      table: Table;
      args: any;
      unique?: boolean;
    }
  | {
      kind: "count" | "delete";
      table: Table;
      where: any;
      distinct?: string[];
      physical?: boolean;
    }
  | {
      kind: "insert";
      table: Table;
      data: Record<string, any>;
    }
  | {
      kind: "insert-many";
      table: Table;
      rows: Record<string, any>[];
      skipDuplicates?: boolean;
      returning: boolean;
    }
  | {
      kind: "upsert";
      table: Table;
      data: Record<string, any>;
      update: Record<string, UpdateValue>;
      conflict: string[];
    }
  | {
      kind: "update";
      table: Table;
      data: Record<string, UpdateValue>;
      where: any;
    }
  | {
      kind: "related" | "relation-count";
      table: Table;
      source: Table;
      relation: Relation;
      keys: any[];
      args: any;
    };
/** Structured statement nodes are compiled once; parameters are emitted as nodes are visited. */
/** Tables never change after the client is built, so whether they use @map is computed once. */
const mappedTables = new WeakMap<Table, boolean>();
export class StatementCompiler extends QueryCompiler {
  constructor(
    schema: Schema,
    readonly adapter: RuntimeAdapter,
  ) {
    super(schema, adapter.dialect);
  }
  bindPage(values: any[], value: number | null): string {
    // The dialect decides how a large page value is bound (integer vs BigInt protocol encoding).
    return this.bind(values, this.dialect.pageValue(value));
  }
  /** True when some column has a physical name different from its field name. */
  mapped(t: Table): boolean {
    let result = mappedTables.get(t);
    if (result === undefined) {
      mappedTables.set(
        t,
        (result = Object.values(t.columns).some((c) => {
          return c.map !== undefined;
        })),
      );
    }
    return result;
  }
  /** One selected column, aliased back to its field name when mapped. */
  selectColumn(t: Table, alias: string, field: string): string {
    const expression = this.column(t, alias, field);
    return t.columns[field]?.map !== undefined ? expression + " AS " + this.quote(field) : expression;
  }
  /** Every column of a row, named by field. */
  everyColumn(t: Table, alias: string): string {
    return this.mapped(t)
      ? Object.keys(t.columns)
          .map((field) => {
            return this.selectColumn(t, alias, field);
          })
          .join(",")
      : this.quote(alias) + ".*";
  }
  /** RETURNING list with field names. */
  returning(t: Table): string {
    const q = this.quote;
    if (!this.mapped(t)) {
      return "*";
    }
    return Object.values(t.columns)
      .map((c) => {
        return q(columnName(c)) + (c.map !== undefined ? " AS " + q(c.name) : "");
      })
      .join(",");
  }
  columns(t: Table, args: any, alias: string): string {
    const omit = omitted(t, args);
    if (!args.select && !omit) {
      return this.everyColumn(t, alias);
    }
    const selection = args.select ?? {
      ...Object.fromEntries(
        Object.keys(t.columns)
          .filter((key) => {
            return !omit?.[key];
          })
          .map((key) => {
            return [key, true];
          }),
      ),
      ...Object.fromEntries(
        Object.keys(t.virtuals ?? {})
          .filter((key) => {
            return !omit?.[key];
          })
          .map((key) => {
            return [key, true];
          }),
      ),
      ...args.include,
    };
    const keys = new Set<string>(primaryKey(t));
    for (const [name, enabled] of Object.entries(selection)) {
      if (!enabled) {
        continue;
      }
      if (t.columns[name]) {
        keys.add(name);
      } else if (t.virtuals?.[name]) {
        for (const dependency of t.virtuals[name].needs) {
          keys.add(dependency);
        }
      } else if (t.relations[name]) {
        keys.add(t.relations[name].source);
      } else if (name === "_count") {
        const selected = enabled === true ? Object.keys(t.relations) : (enabled as any).select;
        for (const relation of Object.values(t.relations)) {
          if (relation.many && (Array.isArray(selected) ? selected.includes(relation.name) : selected?.[relation.name])) {
            keys.add(relation.source);
          }
        }
      }
    }
    return [...keys]
      .filter((k) => {
        return t.columns[k];
      })
      .map((k) => {
        return this.selectColumn(t, alias, k);
      })
      .join(",");
  }
  private assignments(t: Table, data: Record<string, UpdateValue>, bind: (v: any) => string, qualified = false): string {
    const d = this.adapter.dialect;
    const q = d.quote;
    return Object.entries(data)
      .map(([key, value]) => {
        const column = q(columnName(t.columns[key]));
        const source = qualified ? this.table(t) + "." + column : column;
        if (value.kind === "set") {
          return column + "=" + bind(value.value);
        }
        const operator = { increment: "+", decrement: "-", multiply: "*", divide: "/" }[value.operation];
        const type = t.columns[key].type;
        let operand = bind(type === "bigint" ? d.bigintOperand(value.value) : value.value);
        // Keep decimal arithmetic exact where the dialect would coerce string operands.
        if (type === "decimal") {
          operand = d.wrapDecimalOperand(operand);
        }
        let expression = source + " " + operator + " " + operand;
        if (value.operation === "divide" && (type === "int" || type === "bigint")) {
          expression = d.integerDivide(expression);
        }
        return column + "=" + expression;
      })
      .join(",");
  }
  compile(node: Statement): CompiledSQL {
    const d = this.adapter.dialect;
    const q = d.quote;
    const t = node.table;
    const values: any[] = [];
    const bind = (v: any) => {
      return this.bind(values, v);
    };
    const pageBind = (v: number | null) => {
      return this.bindPage(values, v);
    };
    let text = "";
    switch (node.kind) {
      case "select": {
        const distinct = !node.unique && node.args.distinct !== undefined;
        // Parameters are bound in the order their placeholders appear in the SQL text. The window
        // ORDER BY of the distinct subquery precedes its WHERE clause, so it is compiled first.
        const innerOrder = distinct ? this.order(t, node.args.orderBy, "t", values) : "";
        const where = this.predicate(t, visibleWhere(node.args.where, node.args.deleted), "t", values);
        let selected: string;
        if (!node.unique) {
          selected = this.columns(t, node.args, "t");
        } else if (this.mapped(t)) {
          selected = this.everyColumn(t, "t");
        } else {
          selected = "*";
        }
        text = `SELECT ${selected} FROM ${this.table(t)} ${q("t")} WHERE ${where}`;
        if (distinct) {
          const fields = Array.isArray(node.args.distinct) ? node.args.distinct : [node.args.distinct];
          const inner =
            "SELECT " +
            q("t") +
            ".*, ROW_NUMBER() OVER (PARTITION BY " +
            fields
              .map((k: string) => {
                return this.column(t, "t", k);
              })
              .join(",") +
            " ORDER BY " +
            innerOrder +
            ") AS " +
            q("__orm_distinct_rank") +
            " FROM " +
            this.table(t) +
            " " +
            q("t") +
            " WHERE " +
            where;
          text = "SELECT " + this.columns(t, node.args, "t") + " FROM (" + inner + ") " + q("t") + " WHERE " + q("t") + "." + q("__orm_distinct_rank") + "=1";
        }
        if (!node.unique) {
          text += ` ORDER BY ${this.order(t, node.args.orderBy, "t", values)} LIMIT ${pageBind(node.args.take ?? d.unlimited)} OFFSET ${pageBind(node.args.skip ?? 0)}`;
        }
        break;
      }
      case "count": {
        const where = this.predicate(t, node.where, "t", values);
        text = node.distinct?.length
          ? "SELECT COUNT(*) AS n FROM (SELECT DISTINCT " +
            node.distinct
              .map((k) => {
                return this.column(t, "t", k);
              })
              .join(",") +
            " FROM " +
            this.table(t) +
            " " +
            q("t") +
            " WHERE " +
            where +
            ") AS " +
            q("counted")
          : "SELECT COUNT(*) AS n FROM " + this.table(t) + " " + q("t") + " WHERE " + where;
        break;
      }
      case "delete":
        text = `DELETE ${d.deleteKeyword("t")}FROM ${this.table(t)} AS ${q("t")} WHERE ${this.predicate(t, node.where, "t", values)}`;
        break;
      case "insert": {
        const keys = Object.keys(node.data);
        text = keys.length
          ? `INSERT INTO ${this.table(t)} (${keys
              .map((k) => {
                return q(columnName(t.columns[k]));
              })
              .join(",")}) VALUES (${keys
              .map((k) => {
                return bind(d.encode(t.columns[k], node.data[k]));
              })
              .join(",")})`
          : `INSERT INTO ${this.table(t)} ${d.emptyInsertValues}`;
        if (this.adapter.capabilities.returning) {
          text += " RETURNING " + this.returning(t);
        }
        break;
      }
      case "insert-many": {
        const keys = Object.keys(node.rows[0]);
        text = keys.length
          ? "INSERT INTO " +
            this.table(t) +
            " (" +
            keys
              .map((k) => {
                return q(columnName(t.columns[k]));
              })
              .join(",") +
            ") VALUES " +
            node.rows
              .map((row) => {
                return (
                  "(" +
                  keys
                    .map((k) => {
                      return bind(d.encode(t.columns[k], row[k]));
                    })
                    .join(",") +
                  ")"
                );
              })
              .join(",")
          : "INSERT INTO " + this.table(t) + " " + d.emptyInsertValues;
        if (node.skipDuplicates && keys.length) {
          text += d.onConflictDoNothing();
        }
        if (node.returning) {
          text += " RETURNING " + this.returning(t);
        }
        break;
      }
      case "upsert": {
        const keys = Object.keys(node.data);
        text =
          "INSERT INTO " +
          this.table(t) +
          " (" +
          keys
            .map((k) => {
              return q(columnName(t.columns[k]));
            })
            .join(",") +
          ") VALUES (" +
          keys
            .map((k) => {
              return bind(d.encode(t.columns[k], node.data[k]));
            })
            .join(",") +
          d.upsertConflictSuffix(
            node.conflict
              .map((k) => {
                return q(columnName(t.columns[k]));
              })
              .join(","),
          );
        // An empty update still needs one no-op assignment. Use a conflict column: it is always
        // written explicitly here, unlike the primary key, which may be a generated identity
        // column that PostgreSQL refuses to assign even to itself.
        const key = q(columnName(t.columns[node.conflict[0]]));
        text += Object.keys(node.update).length ? this.assignments(t, node.update, bind, true) : key + "=" + this.table(t) + "." + key;
        if (this.adapter.capabilities.returning) {
          text += " RETURNING " + this.returning(t);
        }
        break;
      }
      case "update": {
        text = "UPDATE " + this.table(t) + " AS " + q("t") + " SET " + this.assignments(t, node.data, bind) + " WHERE " + this.predicate(t, node.where, "t", values);
        if (this.adapter.capabilities.returning) {
          text += " RETURNING " + this.returning(t);
        }
        break;
      }
      case "related":
      case "relation-count": {
        if (node.kind === "related" && (node.args.take !== undefined || (node.args.skip ?? 0) > 0) && !this.adapter.capabilities.windowFunctions) {
          throw new OrmError("UNSUPPORTED_CAPABILITY", "Nested pagination requires window functions");
        }
        const r = node.relation;
        const a = node.args;
        const parent = r.junction ? `${q("j")}.${q(r.junctionSource!)}` : this.column(t, "c", r.foreign);
        const join = r.junction ? ` JOIN ${q(r.junction)} ${q("j")} ON ${q("j")}.${q(r.junctionTarget!)}=${this.column(t, "c", r.foreign)}` : "";
        // Parameters are bound in the order their placeholders appear in the SQL text. The window
        // ORDER BY of the paginated subquery comes first, so it is compiled before the keys.
        const paged = a.take !== undefined || (a.skip ?? 0) > 0;
        const windowOrder = node.kind === "related" && paged ? this.order(t, a.orderBy, "c", values) : "";
        const keys = node.keys
          .map((v) => {
            return bind(d.encode(node.source.columns[r.source], v));
          })
          .join(",");
        // 多态反向关系：判别列常量限定归属，include、count 与分页三段 SQL 共用。
        // 判别值的占位符排在过滤条件之前，绑定顺序必须与文本一致。
        const discriminator = r.discriminator !== undefined ? this.column(t, "c", r.discriminator) + "=" + bind(d.encode(t.columns[r.discriminator], r.discriminatorValue)) : undefined;
        const filter = this.predicate(t, visibleWhere(a.where, a.deleted), "c", values);
        const where = discriminator !== undefined ? discriminator + " AND (" + filter + ")" : filter;
        if (node.kind === "relation-count") {
          text = "SELECT " + parent + " AS " + q("__orm_parent") + ",COUNT(*) AS " + q("__orm_count") + " FROM " + this.table(t) + " " + q("c") + join + " WHERE " + parent + " IN (" + keys + ") AND (" + where + ") GROUP BY " + parent;
          break;
        }
        if (a.take === undefined && (a.skip ?? 0) === 0) {
          text =
            "SELECT " +
            this.columns(t, a, "c") +
            ", " +
            parent +
            " AS " +
            q("__orm_parent") +
            " FROM " +
            this.table(t) +
            " " +
            q("c") +
            join +
            " WHERE " +
            parent +
            " IN (" +
            keys +
            ") AND (" +
            where +
            ") ORDER BY " +
            parent +
            ", " +
            this.order(t, a.orderBy, "c", values);
          break;
        }
        const inner = `SELECT ${this.columns(t, a, "c")}, ${parent} AS ${q("__orm_parent")}, ROW_NUMBER() OVER (PARTITION BY ${parent} ORDER BY ${windowOrder}) AS ${q("__orm_rank")} FROM ${this.table(t)} ${q("c")}${join} WHERE ${parent} IN (${keys}) AND (${where})`;
        text = `SELECT * FROM (${inner}) AS ranked WHERE ${q("__orm_rank")} > ${bind(a.skip ?? 0)}${a.take !== undefined ? ` AND ${q("__orm_rank")} <= ${bind((a.skip ?? 0) + a.take)}` : ""} ORDER BY ${q("__orm_parent")}, ${q("__orm_rank")}`;
        break;
      }
    }
    return { text, values };
  }
}
