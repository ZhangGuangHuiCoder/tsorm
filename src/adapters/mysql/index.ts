import { decodeJson } from "../../shared/json.js";
import { validateDateTime } from "../../shared/datetime.js";
import { OrmError, fail } from "../../shared/errors.js";
import { encode as encodeScalar, safeInteger, finiteNumber, decodeBigInt, decodeDecimal, toBytes, scalarGroupKey } from "../../shared/scalars.js";
import type { Adapter, RuntimeAdapter } from "../../core/adapter.js";
import mariadb from "mariadb";
import { mysqlConnection } from "../../shared/connection.js";
import { createHash } from "node:crypto";
import { quoteMysqlIdentifier } from "../../query/identifiers.js";
import { columnName, objectName, referentialActions, tableName, type Schema, type Table, type Column } from "../../schema/index.js";
const q = quoteMysqlIdentifier;
function encode(c: Column, value: any): any {
  const result = encodeScalar(c, value);
  if (c.type === "bytes" && result !== null) {
    return Buffer.from(result);
  }
  if (c.type === "datetime" && c.dateStorage !== "timestamp" && value !== null) {
    const year = Number(result.slice(0, 4));
    if (year < 1000 || year > 9999) {
      fail("MySQL dates require years 1000..9999");
    }
    return result;
  }
  return result;
}
function decode(t: Table, raw: any): any {
  const row: any = {};
  for (const [k, c] of Object.entries(t.columns)) {
    const v = raw[k];
    if (c.type === "json") {
      row[k] = decodeJson(c.json!, v, c.nullable, k);
      continue;
    }
    if (v === null) {
      row[k] = null;
      continue;
    }
    // mariadb delivers dates, decimals and integers as text or bigint; strings and enum unions pass through.
    switch (c.type) {
      case "datetime":
        row[k] = c.dateStorage === "timestamp" ? v : validateDateTime(v);
        break;
      case "number":
        row[k] = finiteNumber(v);
        break;
      case "int":
        row[k] = safeInteger(v);
        break;
      case "bigint":
        row[k] = decodeBigInt(v);
        break;
      case "decimal":
        row[k] = decodeDecimal(c, v);
        break;
      case "boolean":
        row[k] = !!Number(v);
        break;
      case "bytes":
        row[k] = toBytes(v);
        break;
      default:
        row[k] = v;
    }
  }
  return row;
}
function groupKey(c: Column, value: any): string {
  // utf8mb4_bin uses PAD SPACE comparisons, including foreign-key joins, for every string column.
  return c.type === "string" || c.type === "text" ? String(value).replace(/ +$/, "") : scalarGroupKey(c, value);
}
const sqlType = (c: Column) => {
  return {
    int: "BIGINT",
    bigint: "BIGINT",
    number: "DOUBLE",
    decimal: c.precision !== undefined ? `DECIMAL(${c.precision},${c.scale})` : "DECIMAL(65,30)",
    string: c.maxLength ? `VARCHAR(${c.maxLength})` : "LONGTEXT",
    text: "LONGTEXT",
    boolean: "TINYINT(1)",
    json: "JSON",
    datetime: c.dateStorage === "timestamp" ? "BIGINT" : "DATETIME(3)",
    bytes: "LONGBLOB",
  }[c.type];
};
const literal = (v: any) => {
  if (v === null) {
    return "NULL";
  }
  if (typeof v === "string") {
    return "'" + v.replaceAll("'", "''") + "'";
  }
  if (typeof v === "boolean") {
    return Number(v);
  }
  return v;
};
const indexName = (...parts: string[]) => {
  return "orm_" + createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24);
};
/** Run with NO_BACKSLASH_ESCAPES enabled, matching the adapter's session setup. */
export function mysqlSchemaSQL(schema: Schema): string[] {
  const tables: string[] = [];
  const foreign: string[] = [];
  for (const t of Object.values(schema.tables)) {
    if (tableName(t).length > 64) {
      fail("MySQL table identifier exceeds 64 characters");
    }
    const col = (key: string) => {
      return q(columnName(t.columns[key]));
    };
    const indexed = new Set([
      ...t.unique.flat(),
      ...t.indexes.flat(),
      ...(t.primaryKey ?? []),
      ...Object.values(t.columns)
        .filter((c) => {
          return c.primary || c.unique;
        })
        .map((c) => {
          return c.name;
        }),
      ...Object.values(t.relations)
        .filter((r) => {
          return r.owner && !r.many;
        })
        .map((r) => {
          return r.source;
        }),
    ]);
    for (const key of indexed) {
      const column = t.columns[key];
      if ((column.type === "string" || column.type === "text") && !column.maxLength) {
        throw new OrmError("UNSUPPORTED_CAPABILITY", `MySQL indexed text column ${t.name}.${key} requires string(n)`);
      }
    }
    const defs = Object.values(t.columns).map((c) => {
      if (columnName(c).length > 64) {
        fail("MySQL column identifier exceeds 64 characters");
      }
      const name = q(columnName(c));
      let s = `${name} ${sqlType(c)}${c.nullable ? "" : " NOT NULL"}${c.auto ? " AUTO_INCREMENT" : ""}${c.primary ? " PRIMARY KEY" : ""}${c.unique ? " UNIQUE" : ""}`;
      if (c.default !== undefined) {
        const d = c.default;
        if (d && typeof d === "object") {
          if (d.fn === "now") {
            s += c.dateStorage === "timestamp" ? " DEFAULT (CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED))" : " DEFAULT CURRENT_TIMESTAMP(3)";
          }
        } else {
          encode(c, d);
          s += " DEFAULT " + (d !== null && (c.type === "text" || (c.type === "string" && !c.maxLength)) ? "(" + literal(d) + ")" : literal(d));
        }
      }
      if (c.enum) {
        for (const value of c.enum) {
          encode(c, value);
        }
        s += ` CHECK (${name} IN (${c.enum.map(literal).join(",")}))`;
      }
      if (c.type === "boolean") {
        s += ` CHECK (${name} IN (0,1))`;
      }
      return s;
    });
    if (t.primaryKey?.length) {
      defs.push(`PRIMARY KEY (${t.primaryKey.map(col).join(",")})`);
    }
    for (const keys of t.unique) {
      defs.push(`UNIQUE (${keys.map(col).join(",")})`);
    }
    for (const keys of t.indexes) {
      defs.push(`INDEX ${q(indexName(objectName(t), ...keys))} (${keys.map(col).join(",")})`);
    }
    // 关系列索引与外键约束解耦：morph 与普通外键列一律显式建索引，不再依赖 InnoDB 的隐式行为。
    for (const r of Object.values(t.relations)) {
      if (r.owner && !r.many && !t.columns[r.source].unique) {
        defs.push(`INDEX ${q(indexName(objectName(t), r.source, "relidx"))} (${col(r.source)})`);
      }
    }
    tables.push(`CREATE TABLE ${q(tableName(t))} (${defs.join(", ")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
    for (const r of Object.values(t.relations)) {
      if (r.owner && !r.many && !r.polymorphic) {
        const target = schema.tables[r.target];
        foreign.push(
          `ALTER TABLE ${q(tableName(t))} ADD CONSTRAINT ${q(indexName(objectName(t), r.name, "fk"))} FOREIGN KEY (${col(r.source)}) REFERENCES ${q(tableName(target))} (${q(columnName(target.columns[r.foreign]))}) ON DELETE ${referentialActions[r.onDelete ?? "Restrict"]} ON UPDATE ${referentialActions[r.onUpdate ?? "Restrict"]}`,
        );
      }
    }
  }
  for (const t of Object.values(schema.tables)) {
    for (const r of Object.values(t.relations)) {
      if (r.owner && r.junction) {
        if (r.junction.length > 64) {
          fail("MySQL junction identifier exceeds 64 characters");
        }
        const target = schema.tables[r.target];
        const source = t.columns[r.source];
        const foreignColumn = target.columns[r.foreign];
        tables.push(
          `CREATE TABLE ${q(r.junction)} (${q("sourceId")} ${sqlType(source)} NOT NULL, ${q("targetId")} ${sqlType(foreignColumn)} NOT NULL, PRIMARY KEY (${q("sourceId")},${q("targetId")}), INDEX ${q(indexName(r.junction, "relidx"))} (${q("targetId")})) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
        );
        foreign.push(
          `ALTER TABLE ${q(r.junction)} ADD FOREIGN KEY (${q("sourceId")}) REFERENCES ${q(tableName(t))} (${q(columnName(source))}) ON DELETE CASCADE, ADD FOREIGN KEY (${q("targetId")}) REFERENCES ${q(tableName(target))} (${q(columnName(foreignColumn))}) ON DELETE CASCADE`,
        );
      }
    }
  }
  return [...tables, ...foreign];
}

export interface MySQLConnection {
  execute(sql: string, values?: any[]): Promise<any>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void | Promise<void>;
  destroy?(): void;
  threadId?: number | null;
}
export interface MySQLOptions {
  /** Connection URL; protocol-critical options are fixed by the adapter. */
  connection: string;
  /** Creates tables only in a completely empty selected database. DDL is not transactional. */
  initialize?: boolean;
}
function translate(error: any): Error {
  if (error instanceof OrmError) {
    return error;
  }
  if (error instanceof Error && !error.hasOwnProperty("errno") && !error.hasOwnProperty("code")) {
    return error;
  }
  const codes: Record<number, string> = {
    1062: "UNIQUE_CONSTRAINT",
    1451: "FOREIGN_KEY_CONSTRAINT",
    1452: "FOREIGN_KEY_CONSTRAINT",
    1048: "NOT_NULL_CONSTRAINT",
    3819: "CHECK_CONSTRAINT",
    4025: "CHECK_CONSTRAINT",
    1213: "TRANSACTION_DEADLOCK",
    1205: "LOCK_TIMEOUT",
    1317: "QUERY_CANCELLED",
  };
  // Connector messages can include SQL and values; keep them only in the internal cause.
  return new OrmError(codes[error?.errno] ?? "DATABASE_ERROR", `MySQL operation failed (${error?.code ?? "unknown"})`, { cause: error });
}
async function connectMySQL(schema: Schema, options: MySQLOptions): Promise<RuntimeAdapter> {
  if (!options?.connection) {
    fail("Provide MySQL connection options");
  }
  const connection = mysqlConnection(options.connection);
  // Validate DDL and schema limits before opening a connection.
  const ddl = mysqlSchemaSQL(schema);
  const pool: { getConnection(): Promise<MySQLConnection>; end(): Promise<void> } = mariadb.createPool({
    ...connection,
    multipleStatements: false,
    timezone: "Z",
    dateStrings: true,
    autoJsonMap: false,
    bigIntAsNumber: false,
    insertIdAsNumber: false,
    decimalAsNumber: false,
  });
  async function acquire() {
    const c = await pool.getConnection();
    try {
      await c.execute("SET SESSION time_zone = '+00:00'");
      await c.execute("SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'STRICT_TRANS_TABLES', 'NO_BACKSLASH_ESCAPES')");
      return c;
    } catch (error) {
      await c.release();
      throw error;
    }
  }
  try {
    const c = await acquire();
    try {
      const rows = await c.execute("SELECT VERSION() AS version");
      const version = String(rows[0]?.version ?? "");
      const maria = version.includes("MariaDB");
      const match = (maria ? version.replace(/^5\.5\.5-/, "") : version).match(/^(\d+)\.(\d+)\.(\d+)/);
      if (!match) {
        fail("Cannot identify database version");
      }
      const [major, minor, patch] = match!.slice(1).map(Number);
      // MySQL 底线是 8.0.16：enum/bool 列靠 CHECK 约束保证完整性，低于此版 CHECK 被静默忽略；表达式 DEFAULT 需 8.0.13。
      if (maria ? major < 10 || (major === 10 && minor < 6) : major < 8 || (major === 8 && minor === 0 && patch < 16)) {
        throw new OrmError("UNSUPPORTED_SERVER", "Requires MySQL 8.0.16+ or MariaDB 10.6+");
      }
      const present = await c.execute("SELECT table_name AS name, engine AS engine FROM information_schema.tables WHERE table_schema = DATABASE()");
      const managed = new Set([
        ...Object.values(schema.tables).map(tableName),
        ...Object.values(schema.tables).flatMap((t) => {
          return Object.values(t.relations).flatMap((r) => {
            return r.junction ? [r.junction] : [];
          });
        }),
      ]);
      if (
        !options.initialize &&
        present.some((table: any) => {
          return managed.has(table.name) && table.engine !== "InnoDB";
        })
      ) {
        throw new OrmError("UNSUPPORTED_ENGINE", "Managed MySQL tables must use InnoDB for transactional writes");
      }
      if (options.initialize) {
        if (present.length) {
          throw new OrmError("DATABASE_NOT_EMPTY", "initialize requires an empty selected database");
        }
        for (const sql of ddl) {
          await c.execute(sql);
        }
      }
    } finally {
      await c.release();
    }
  } catch (error) {
    await pool.end();
    throw translate(error);
  }
  return {
    dialect: {
      name: "mysql",
      quote: q,
      parameter: () => {
        return "?";
      },
      encode,
      decode,
      groupKey,
      unlimited: Number.MAX_SAFE_INTEGER,
      trueLiteral: "1",
      falseLiteral: "0",
      // Duplicate handling happens row by row outside the statement, so no clause is emitted.
      emptyInsertValues: "() VALUES ()",
      onConflictDoNothing: () => {
        return "";
      },
      upsertConflictSuffix: () => {
        return ") ON DUPLICATE KEY UPDATE ";
      },
      deleteKeyword: (alias) => {
        return q(alias) + " ";
      },
      pageValue: (value) => {
        return value !== null && value > 2147483647 ? BigInt(value) : value;
      },
      bigintOperand: (value) => {
        return value;
      },
      wrapDecimalOperand: (operand) => {
        return "CAST(" + operand + " AS DECIMAL(65,30))";
      },
      integerDivide: (expr) => {
        return "TRUNCATE(" + expr + ", 0)";
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
        return "repeatable read";
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
            return `JSON_TYPE(JSON_EXTRACT(${col}, ${pathParam()}))`;
          };
          const text = () => {
            return `JSON_UNQUOTE(JSON_EXTRACT(${col}, ${pathParam()}))`;
          };
          const number = () => {
            return `JSON_EXTRACT(${col}, ${pathParam()})`;
          };
          const types: Record<"string" | "number", string> = {
            string: "'STRING'",
            number: "'INTEGER','DOUBLE','DECIMAL','UNSIGNED INTEGER'",
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
              return `COALESCE(${type()} = 'NULL', 0)`;
            }
            if (typeof v === "boolean") {
              return `COALESCE(${type()} = 'BOOLEAN' AND ${text()} = '${v}', 0)`;
            }
            return typeof v === "string"
              ? guard("string", () => {
                  return `${text()} = ${ctx.bind(params, v)}`;
                })
              : guard("number", () => {
                  return `${number()} = ${ctx.bind(params, v)}`;
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
      returning: false,
      windowFunctions: true,
      transactionalDDL: false,
      versionedMigrations: true,
      isolationLevels: ["read committed", "repeatable read", "serializable"],
    },
    translate,
    async acquire() {
      const c = await acquire();
      return {
        async execute({ text, values }) {
          const result = await c.execute(text, values);
          return {
            rows: Array.isArray(result)
              ? result.map((row) => {
                  return Object.fromEntries(
                    Object.entries(row).map(([key, value]) => {
                      return [key, typeof value === "bigint" ? String(value) : value];
                    }),
                  );
                })
              : [],
            affectedRows: Array.isArray(result) ? result.length : safeInteger(result.affectedRows),
            insertId: result.insertId,
          };
        },
        async begin(options) {
          if (options?.isolationLevel) {
            await c.execute("SET TRANSACTION ISOLATION LEVEL " + options.isolationLevel.toUpperCase());
          }
          if (options?.readOnly) {
            await c.execute("SET TRANSACTION READ ONLY");
          }
          await c.beginTransaction();
        },
        commit: () => {
          return c.commit();
        },
        rollback: () => {
          return c.rollback();
        },
        async release(broken) {
          if (broken && c.destroy) {
            c.destroy();
          } else {
            await c.release();
          }
        },
        async cancel() {
          if (!c.threadId) {
            return;
          }
          const admin = await mariadb.createConnection(connection);
          try {
            await admin.query("KILL QUERY " + Number(c.threadId));
          } finally {
            await admin.end().catch(() => {});
          }
        },
      };
    },
    async close() {
      await pool.end();
    },
  };
}
export function mysql(options: MySQLOptions): Adapter {
  return {
    name: "mysql",
    connect: (schema) => {
      return connectMySQL(schema, options);
    },
  };
}
