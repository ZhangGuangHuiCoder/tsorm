import { OrmError, fail } from "../../shared/errors.js";
import { encode as encodeScalar, decode, safeInteger, scalarGroupKey } from "../../shared/scalars.js";
import { quoteIdentifier as q } from "../../query/identifiers.js";
import type { Adapter, RuntimeAdapter } from "../../core/adapter.js";
import { DatabaseSync } from "node:sqlite";
import { columnName, objectName, referentialActions, tableName, type Column, type Schema } from "../../schema/index.js";
const sqliteTypes: Record<string, string> = {
  int: "INTEGER",
  bigint: "INTEGER",
  boolean: "INTEGER",
  number: "REAL",
  decimal: "NUMERIC",
  text: "TEXT",
  bytes: "BLOB",
};
const sqliteType = (c: Column) => {
  if (c.type === "datetime" && c.dateStorage === "timestamp") {
    return "INTEGER";
  }
  return sqliteTypes[c.type] ?? "TEXT";
};
/** SQLite literal for a column default: strings are quoted, booleans become 1/0. */
const defaultValueLiteral = (d: any) => {
  if (d === null) {
    return "NULL";
  }
  if (typeof d === "string") {
    return "'" + d.replaceAll("'", "''") + "'";
  }
  if (typeof d === "boolean") {
    return Number(d);
  }
  return d;
};
export function sqliteSchemaSQL(schema: Schema): string[] {
  const statements: string[] = [];
  for (const t of Object.values(schema.tables)) {
    const col = (key: string) => {
      return q(columnName(t.columns[key]));
    };
    const definitions = Object.values(t.columns).map((c) => {
      const name = q(columnName(c));
      let sql = `${name} ${sqliteType(c)}`;
      if (c.primary) {
        sql += " PRIMARY KEY";
      }
      if (c.auto) {
        sql += " AUTOINCREMENT";
      }
      if (!c.nullable) {
        sql += " NOT NULL";
      }
      if (c.unique) {
        sql += " UNIQUE";
      }
      if (c.maxLength) {
        sql += ` CHECK (length(${name}) <= ${c.maxLength})`;
      }
      if (c.type === "json") {
        sql += " CHECK (json_valid(" + name + "))";
      }
      if (c.enum) {
        sql += ` CHECK (${name} IN (${c.enum
          .map((v) => {
            return "'" + v.replaceAll("'", "''") + "'";
          })
          .join(",")}))`;
      }
      if (c.type === "boolean") {
        sql += ` CHECK (${name} IN (0,1))`;
      }
      if (c.default !== undefined) {
        const d = c.default;
        if (d && typeof d === "object") {
          if (d.fn === "now") {
            sql += c.dateStorage === "timestamp" ? " DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))" : " DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now','localtime'))";
          }
        } else {
          sql += " DEFAULT " + defaultValueLiteral(d);
        }
      }
      return sql;
    });
    if (t.primaryKey?.length) {
      definitions.push(`PRIMARY KEY (${t.primaryKey.map(col).join(",")})`);
    }
    for (const r of Object.values(t.relations)) {
      if (r.owner && !r.many && !r.polymorphic) {
        const target = schema.tables[r.target];
        definitions.push(
          `FOREIGN KEY (${col(r.source)}) REFERENCES ${q(tableName(target))} (${q(columnName(target.columns[r.foreign]))}) ON DELETE ${referentialActions[r.onDelete ?? "Restrict"]}${r.onUpdate ? " ON UPDATE " + referentialActions[r.onUpdate] : ""}`,
        );
      }
    }
    for (const keys of t.unique) {
      definitions.push(`UNIQUE (${keys.map(col).join(",")})`);
    }
    statements.push(`CREATE TABLE ${q(tableName(t))} (${definitions.join(", ")});`);
    for (const keys of t.indexes) {
      statements.push(`CREATE INDEX ${q(`${objectName(t)}_${keys.join("_")}_idx`)} ON ${q(tableName(t))} (${keys.map(col).join(",")});`);
    }
    // 关系列索引与外键约束解耦：morph 与普通外键列一律建索引，命名只描述“关系列”。
    for (const r of Object.values(t.relations)) {
      if (r.owner && !r.many && !t.columns[r.source].unique) {
        statements.push(`CREATE INDEX ${q(`${objectName(t)}_${r.source}_rel_idx`)} ON ${q(tableName(t))} (${col(r.source)});`);
      }
    }
  }
  for (const t of Object.values(schema.tables)) {
    for (const r of Object.values(t.relations)) {
      if (r.owner && r.junction) {
        const target = schema.tables[r.target];
        const source = t.columns[r.source];
        const foreign = target.columns[r.foreign];
        statements.push(
          `CREATE TABLE ${q(r.junction)} ("sourceId" ${sqliteType(source)} NOT NULL REFERENCES ${q(tableName(t))} (${q(columnName(source))}) ON DELETE CASCADE, "targetId" ${sqliteType(foreign)} NOT NULL REFERENCES ${q(tableName(target))} (${q(columnName(foreign))}) ON DELETE CASCADE, PRIMARY KEY ("sourceId", "targetId"));`,
        );
        statements.push(`CREATE INDEX ${q(r.junction + "_rel_idx")} ON ${q(r.junction)} ("targetId");`);
      }
    }
  }
  return statements;
}

export interface SQLiteOptions {
  connection?: string;
  initialize?: boolean;
}
export function sqlite(options: SQLiteOptions = {}): Adapter {
  return {
    name: "sqlite",
    connect: (schema) => {
      return connectSQLite(schema, options);
    },
  };
}
function connectSQLite(schema: Schema, options: SQLiteOptions): RuntimeAdapter {
  if (Object.hasOwn(options, "filename")) {
    fail("Use a file: connection URL");
  }
  const connection = options.connection ?? "file::memory:";
  if (typeof connection !== "string" || !connection.startsWith("file:") || !connection.slice(5)) {
    fail("SQLite connection requires a file: URL string");
  }
  if (connection.includes("?")) {
    fail("SQLite connection URL does not support query parameters");
  }
  const db = new DatabaseSync(connection.slice(5));
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  if (options.initialize) {
    const existing = db.prepare("SELECT 1 FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
    if (existing) {
      db.close();
      throw new OrmError("DATABASE_NOT_EMPTY", "initialize requires an empty SQLite database");
    }
    try {
      db.exec("BEGIN");
      for (const sql of sqliteSchemaSQL(schema)) {
        db.exec(sql);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      db.close();
      throw e;
    }
  }
  let tail = Promise.resolve();
  let broken = false;
  return {
    dialect: {
      name: "sqlite",
      quote: q,
      parameter: () => {
        return "?";
      },
      encode: encodeScalar,
      decode: (table, row) => {
        return decode(
          table,
          Object.fromEntries(
            Object.entries(row).map(([k, v]) => {
              const type = table.columns[k]?.type;
              if (typeof v === "string" && type === "decimal" && /^-?\d+$/.test(v)) {
                return [k, BigInt(v)];
              }
              if (typeof v === "bigint" && type !== "bigint" && type !== "decimal") {
                return [k, safeInteger(v)];
              }
              return [k, v];
            }),
          ),
        );
      },
      groupKey: scalarGroupKey,
      unlimited: -1,
      trueLiteral: "1",
      falseLiteral: "0",
      emptyInsertValues: "DEFAULT VALUES",
      onConflictDoNothing: () => {
        return " ON CONFLICT DO NOTHING";
      },
      upsertConflictSuffix: (cols) => {
        return ") ON CONFLICT (" + cols + ") DO UPDATE SET ";
      },
      deleteKeyword: () => {
        return "";
      },
      pageValue: (value) => {
        return value;
      },
      bigintOperand: (value) => {
        return value;
      },
      wrapDecimalOperand: (operand) => {
        return operand;
      },
      decimalComparisonOperand: (operand) => {
        return "CAST(" + operand + " AS NUMERIC)";
      },
      integerDivide: (expr) => {
        return "CAST(" + expr + " AS INTEGER)";
      },
      containsPredicate: (col, placeholder, insensitive) => {
        return insensitive ? `LOWER(${col}) LIKE LOWER(${placeholder}) ESCAPE '!'` : `${col} LIKE ${placeholder} ESCAPE '!'`;
      },
      nullsOrder: () => {
        return undefined;
      },
      booleanMinMax: (op, expr) => {
        return op + "(" + expr + ")";
      },
      defaultTransactionIsolation: () => {
        return "serializable";
      },
      json: {
        predicate: (col, path, value, params, ctx) => {
          const pathParam = () => {
            return ctx.bind(
              params,
              "$" +
                path
                  .map((p) => {
                    return typeof p === "number" ? `[${p}]` : "." + JSON.stringify(p);
                  })
                  .join(""),
            );
          };
          const type = () => {
            return `json_type(${col}, ${pathParam()})`;
          };
          const text = () => {
            return `json_extract(${col}, ${pathParam()})`;
          };
          const number = () => {
            return `json_extract(${col}, ${pathParam()})`;
          };
          const types: Record<"string" | "number", string> = {
            string: "'text'",
            number: "'integer','real'",
          };
          const guard = (kind: "string" | "number", condition: () => string) => {
            return `COALESCE(${type()} IN (${types[kind]}) AND ${condition()}, ${ctx.falsity})`;
          };
          const equals = (v: unknown): string => {
            if (v !== null && !["string", "number", "boolean"].includes(typeof v)) {
              fail("JSON equals accepts a string, number, boolean or null");
            }
            if (typeof v === "number" && !Number.isFinite(v)) {
              fail("JSON equals requires a finite number");
            }
            if (v === null) {
              return `COALESCE(${type()} = 'null', 0)`;
            }
            if (typeof v === "boolean") {
              return `COALESCE(${type()} = '${v}', 0)`;
            }
            return guard(typeof v === "string" ? "string" : "number", () => {
              return `${text()} = ${ctx.bind(params, v)}`;
            });
          };
          const pieces: string[] = [];
          for (const [op, v] of Object.entries(value)) {
            if (op === "path") {
              continue;
            }
            if (op === "equals") {
              pieces.push(equals(v));
            } else if (op === "not") {
              pieces.push(`NOT (${equals(v)})`);
            } else if (["gt", "gte", "lt", "lte"].includes(op)) {
              if (typeof v !== "number" || !Number.isFinite(v)) {
                fail(`JSON ${op} requires a finite number`);
              }
              pieces.push(
                guard("number", () => {
                  return `${number()} ${{ gt: ">", gte: ">=", lt: "<", lte: "<=" }[op]} ${ctx.bind(params, v)}`;
                }),
              );
            } else {
              if (typeof v !== "string") {
                fail(`JSON ${op} requires a string`);
              }
              pieces.push(
                guard("string", () => {
                  return `${text()} LIKE ${ctx.bind(params, ctx.pattern(op, v as string))} ESCAPE '!'`;
                }),
              );
            }
          }
          return pieces.length
            ? pieces
                .map((x) => {
                  return "(" + x + ")";
                })
                .join(" AND ")
            : ctx.truth;
        },
      },
    },
    capabilities: {
      returning: true,
      windowFunctions: true,
      transactionalDDL: true,
      versionedMigrations: true,
      isolationLevels: ["serializable"],
    },
    async acquire() {
      const previous = tail;
      let unlock!: () => void;
      tail = new Promise<void>((resolve) => {
        return (unlock = resolve);
      });
      await previous;
      if (broken) {
        unlock();
        throw new OrmError("CLIENT_CLOSED", "SQLite connection is unusable");
      }
      return {
        async execute({ text, values }) {
          const statement = db.prepare(text);
          statement.setReadBigInts(true);
          if (statement.columns().length) {
            const rows = statement.all(...values).map((row) => {
              return Object.fromEntries(
                Object.entries(row).map(([key, value]) => {
                  return [key, typeof value === "bigint" ? String(value) : value];
                }),
              );
            });
            return { rows, affectedRows: rows.length };
          }
          const result = statement.run(...values);
          return {
            rows: [],
            affectedRows: Number(result.changes),
            insertId: result.lastInsertRowid,
          };
        },
        async begin(options) {
          db.exec(options?.readOnly ? "BEGIN" : "BEGIN IMMEDIATE");
        },
        async commit() {
          db.exec("COMMIT");
        },
        async rollback() {
          db.exec("ROLLBACK");
        },
        release(failed) {
          if (failed) {
            broken = true;
          }
          unlock();
        },
      };
    },
    async close() {
      db.close();
    },
    translate(error) {
      if (error instanceof OrmError || !error?.code) {
        return error;
      }
      const message = String(error.message);
      let code = "DATABASE_ERROR";
      if (message.includes("UNIQUE constraint")) {
        code = "UNIQUE_CONSTRAINT";
      } else if (message.includes("FOREIGN KEY constraint")) {
        code = "FOREIGN_KEY_CONSTRAINT";
      } else if (message.includes("NOT NULL constraint")) {
        code = "NOT_NULL_CONSTRAINT";
      } else if (message.includes("CHECK constraint")) {
        code = "CHECK_CONSTRAINT";
      }
      return new OrmError(code, "SQLite operation failed", { cause: error });
    },
  };
}
