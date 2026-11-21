import { randomBytes } from "node:crypto";
import type { ConnectionConfig } from "mariadb";
import { BaseDialect } from "../../core/dialect.js";
import { createDatabaseFlow, createProvider, pushSection } from "../../core/migration.js";
import { createAdapter, createPoolRuntime, openRuntime, type ConnectConfig, type PoolHooks } from "../../core/transport.js";
import { jsonPath, jsonPredicate } from "../../query/json-predicate.js";
import type { Column, Schema } from "../../schema/model.js";
import { internalColumnName, internalObjectName, internalTableName, referentialActions } from "../../schema/model.js";
import { columnChanges, structuralIndexKey, type Connection, type Datasource, type MigrationProvider } from "../../migrations/provider.js";
import { historyTable, leadingIdentifier, splitTopLevel, squash, unquote, type DbColumn, type DbModel, type DbTable } from "../../migrations/diff.js";
import type { TableChange } from "../../migrations/diff.js";
import type { Section } from "../../migrations/provider.js";
import { MigrationError } from "../../migrations/provider.js";
import { OrmError, fail, safeInteger, bigintsAsText, encode as encodeScalar, dateGroupKey, scalarGroupKey, hashedName, literal, historyTableDDL, parameterValue } from "../../shared/index.js";
import { mariadbPool, mysqlConnection, quoteMysqlIdentifier } from "./driver.js";
import type { Adapter, Capabilities, TransactionOptions } from "../../core/adapter.js";

/** A connection from the driver pool; internal to the adapter, not part of the package public API. */
interface MySQLPoolConnection {
  execute(sql: string, values?: any[]): Promise<any>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void | Promise<void>;
  destroy?(): void;
  threadId?: number | null;
}

/** MySQL datasource: connection options and target database name. */
interface MysqlDatasource extends Datasource {
  options: ConnectionConfig;
  database: string;
}

const asMysql = (ds: Datasource) => {
  return ds as MysqlDatasource;
};

/** utf8mb4_bin uses PAD SPACE comparisons, including foreign-key joins, for every string column. */
function groupKeyImpl(c: Column, value: any): string {
  return c.type === "string" || c.type === "text" ? String(value).replace(/ +$/, "") : scalarGroupKey(c, value);
}

/** Lease a connection and apply the idempotent session modes, shared by probe and runtime. */
async function acquireWithSessionMode(pool: { getConnection(): Promise<MySQLPoolConnection> }): Promise<MySQLPoolConnection> {
  const c = await pool.getConnection();
  try {
    // Idempotent: FIND_IN_SET skips modes already present, so pooled connections
    // do not accumulate duplicate entries across repeated acquisitions.
    await c.execute(
      "SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, IF(FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode), NULL, 'STRICT_TRANS_TABLES'), IF(FIND_IN_SET('NO_BACKSLASH_ESCAPES', @@SESSION.sql_mode), NULL, 'NO_BACKSLASH_ESCAPES'))",
    );
    return c;
  } catch (error) {
    // A failed SET leaves the session in an unknown state; destroy instead of
    // returning a possibly misconfigured connection to the pool.
    if (c.destroy) {
      c.destroy();
    } else {
      await c.release();
    }
    throw error;
  }
}

/** Standard session capabilities plus MySQL driver differences: execution, transactions, and cancellation. */
const mysqlHooks = (mariadb: any, connection: Record<string, any>): PoolHooks => ({
  lease: (pool: any) => acquireWithSessionMode(pool),
  release: async (c: MySQLPoolConnection, broken?: boolean) => {
    if (broken && c.destroy) {
      c.destroy();
      return;
    }
    await c.release();
  },
  close: (pool: any) => pool.end(),
  execute: async (c: MySQLPoolConnection, text: string, values: any[]) => {
    const result = await c.execute(text, values);
    return {
      rows: Array.isArray(result) ? result.map(bigintsAsText) : [],
      affectedRows: Array.isArray(result) ? result.length : safeInteger(result.affectedRows),
      insertId: result.insertId,
    };
  },
  begin: async (c: MySQLPoolConnection, options?: TransactionOptions & { readOnly?: boolean }) => {
    if (options?.isolationLevel) {
      await c.execute("SET TRANSACTION ISOLATION LEVEL " + options.isolationLevel.toUpperCase());
    }
    if (options?.readOnly) {
      await c.execute("SET TRANSACTION READ ONLY");
    }
    await c.beginTransaction();
  },
  commit: (c: MySQLPoolConnection) => c.commit(),
  rollback: (c: MySQLPoolConnection) => c.rollback(),
  cancel: async (c: MySQLPoolConnection) => {
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
});

/** Column list in SHOW CREATE TABLE output. */
const backtickList = (text: string) => {
  return splitTopLevel(text).map((part) => {
    return unquote(part.replace(/\(\d+\)$/, "").trim());
  });
};
/** Comment text in SHOW CREATE TABLE output, with single quotes escaped by doubling. */
const commentIn = (text: string, separator = " ") => {
  return new RegExp(`\\bCOMMENT${separator}'((?:[^']|'')*)'`).exec(text)?.[1].replaceAll("''", "'");
};

/** Identifier quoting: backtick style, escaping embedded backticks. */
/**
 * MySQL/MariaDB: 方言翻译的唯一落点。
 *
 * 基类 `BaseDialect` 承担与其它方言一致的标准行为，这里只重写 MySQL 的差异：
 * 反引号引用、ON DUPLICATE KEY 冲突语法、PAD SPACE 分组键、BigInt 分页值与错误码映射，
 * 以及迁移侧的目录查询、清库脚本、建库与影子库规则。
 *
 * MySQL/MariaDB: the single location for dialect translation.
 *
 * `BaseDialect` provides standard behavior shared with other dialects; only MySQL differences are
 * overridden here: backtick quoting, ON DUPLICATE KEY conflict syntax, PAD SPACE group keys,
 * BigInt pagination values and error mapping, plus migration catalog queries, database clearing
 * scripts, database creation, and scratch database rules.
 */
/**
 * @internal MySQL/MariaDB 方言实现：内部模块，不属于包公开 API。
 * MySQL/MariaDB dialect implementation: internal module, not part of the package public API.
 */
export class MysqlDialect extends BaseDialect {
  name = "mysql" as const;
  providerId = "mysql" as const;
  capabilities: Capabilities = { returning: false, isolationLevels: ["read committed", "repeatable read", "serializable"] };
  quote = quoteMysqlIdentifier;
  unlimited = Number.MAX_SAFE_INTEGER;
  emptyInsertValues = "() VALUES ()";
  onConflictDoNothing = () => "";
  upsertConflictSuffix = () => ") ON DUPLICATE KEY UPDATE ";
  deleteKeyword = (alias: string) => quoteMysqlIdentifier(alias) + " ";
  pageValue = (value: number | null) => (value !== null && value > 2147483647 ? BigInt(value) : value);
  wrapDecimalOperand = (operand: string) => "CAST(" + operand + " AS DECIMAL(65,30))";
  integerDivide = (expr: string) => "TRUNCATE(" + expr + ", 0)";
  defaultTransactionIsolation = () => "repeatable read" as const;

  // MySQL: inline datetime decoding plus the trailing-space trim on string group keys.
  groupKey = (column: Column, value: any) => dateGroupKey(column, value, groupKeyImpl);

  /** Convert byte columns to Buffer before passing them to the mariadb driver. */
  protected encodeValue = (column: Column, value: any): any => {
    const result = encodeScalar(column, value);
    if (column.type === "bytes" && result !== null) {
      return Buffer.from(result);
    }
    return result;
  };

  /** DATETIME stores wall-clock time in the connection timezone; validate year limits accordingly. */
  protected encodeTextInstant = (instant: Date): any => {
    const year = instant.getFullYear();
    if (year < 1000 || year > 9999) {
      fail("MySQL dates require years 1000..9999");
    }
    return instant;
  };

  json = {
    predicate: jsonPredicate((col, path, bind, falsity) => {
      const number = () => {
        return `JSON_EXTRACT(${col}, ${bind(jsonPath(path))})`;
      };
      const type = () => {
        return `JSON_TYPE(${number()})`;
      };
      const text = () => {
        return `JSON_UNQUOTE(${number()})`;
      };
      return {
        type,
        text,
        number,
        types: { string: "'STRING'", number: "'INTEGER','DOUBLE','DECIMAL','UNSIGNED INTEGER'" },
        falsity,
        equals: (v: any, guard: any) => {
          if (v === null) {
            return `COALESCE(${type()} = 'NULL', ${falsity})`;
          }
          if (typeof v === "boolean") {
            return `COALESCE(${type()} = 'BOOLEAN' AND ${text()} = '${v}', ${falsity})`;
          }
          return typeof v === "string"
            ? guard("string", () => {
                return `${text()} = ${bind(v)}`;
              })
            : guard("number", () => {
                return `${number()} = ${bind(v)}`;
              });
        },
      };
    }),
  };

  // ─── 迁移侧的翻译 ────────────────────────────────────────────────────────
  now = () => "CURRENT_TIMESTAMP(3)";
  describe = (ds: Datasource) => `MySQL database "${asMysql(ds).database}"`;
  indexKey = structuralIndexKey;
  columnChanges = (a: DbColumn, b: DbColumn) => columnChanges(a, b, true);
  historyDDL = (table: string) =>
    historyTableDDL(table, quoteMysqlIdentifier, {
      id: "VARCHAR(36)",
      time: "DATETIME(3)",
      now: "CURRENT_TIMESTAMP(3)",
      suffix: " DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
    });
  runScriptAtomically = async (conn: Connection, sql: string) => conn.script(sql);
  acquireLock = async (conn: Connection) => {
    const [row] = await conn.query("SELECT GET_LOCK('tsorm_migrate', 10) AS ok");
    if (Number(row.ok) !== 1) {
      throw new MigrationError("MIGRATION_LOCKED", "Timed out waiting for the migration advisory lock");
    }
  };
  releaseLock = async (conn: Connection) => void (await conn.query("SELECT RELEASE_LOCK('tsorm_migrate')"));

  parseDatasource = (url: string): MysqlDatasource => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new MigrationError("INVALID_URL", "Invalid mysql url");
    }
    const database = decodeURIComponent(parsed.pathname.slice(1));
    if (!database) {
      throw new MigrationError("INVALID_URL", "The mysql url must name a database");
    }
    if (!["mysql:", "mariadb:"].includes(parsed.protocol)) {
      throw new MigrationError("INVALID_URL", "MySQL urls start with mysql://");
    }
    const options: Record<string, unknown> = {
      host: decodeURIComponent(parsed.hostname),
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
    };
    // Remaining query parameters are mariadb connection options, e.g. allowPublicKeyRetrieval=true.
    for (const [key, value] of parsed.searchParams) {
      // Pool settings size the adapter's pool, not the single migration connection.
      if (["connectionLimit", "minimumIdle", "acquireTimeout", "idleTimeout"].includes(key)) {
        continue;
      }
      options[key] = parameterValue(key, value);
    }
    return { options: options as ConnectionConfig, database };
  };

  /** Open a migration connection; load the mariadb driver only when connecting. */
  openConnection = async (ds: MysqlDatasource): Promise<Connection> => {
    const mariadb = (await import("mariadb")).default;
    const conn = await mariadb.createConnection({
      ...ds.options,
      database: ds.database,
      multipleStatements: true,
      dateStrings: true,
      bigIntAsNumber: true,
    });
    try {
      await conn.query("SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'STRICT_TRANS_TABLES', 'NO_BACKSLASH_ESCAPES')");
    } catch (error) {
      await conn.end();
      throw error;
    }
    return {
      provider: mysqlProvider,
      datasource: ds,
      async query(sql, params) {
        const rows = await conn.query(sql, params);
        return Array.isArray(rows) ? rows : [];
      },
      async script(sql) {
        await conn.query(sql);
      },
      async close() {
        await conn.end();
      },
    };
  };

  connectMigration = async (ds: Datasource): Promise<Connection> => this.openConnection(asMysql(ds));

  /** Administrative connection without a database name, used to create and drop databases. */
  adminConnection = async (ds: MysqlDatasource): Promise<Connection> => {
    const mariadb = (await import("mariadb")).default;
    const conn = await mariadb.createConnection({ ...ds.options, multipleStatements: false });
    return {
      provider: mysqlProvider,
      datasource: ds,
      query: async (sql: string, params?: unknown[]) => conn.query(sql, params),
      script: async (sql: string) => void (await conn.query(sql)),
      close: () => conn.end(),
    };
  };

  clearDatabase = async (conn: Connection): Promise<void> => {
    const keep = conn.datasource.ignore;
    const objects = (await conn.query("SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()")).filter((o) => {
      return !keep?.(o.name);
    });
    if (!objects.length) {
      return;
    }
    await conn.script(
      "SET FOREIGN_KEY_CHECKS=0;" +
        objects
          .map((o) => {
            return `DROP ${o.type === "VIEW" ? "VIEW" : "TABLE"} IF EXISTS ${quoteMysqlIdentifier(o.name)};`;
          })
          .join("") +
        "SET FOREIGN_KEY_CHECKS=1;",
    );
  };

  historyExists = async (conn: Connection): Promise<boolean> => {
    const rows = await conn.query("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [historyTable(conn)]);
    return rows.length > 0;
  };

  introspect = async (conn: Connection): Promise<DbModel> => {
    const tables: Record<string, DbTable> = {};
    const ignore = conn.datasource.ignore;
    const names = (await conn.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> ? ORDER BY TABLE_NAME", [historyTable(conn)])).filter((row) => {
      return !ignore?.(row.name);
    });
    for (const { name } of names) {
      const [row] = await conn.query(`SHOW CREATE TABLE ${quoteMysqlIdentifier(name)}`);
      const text: string = row["Create Table"];
      const lines = text.split("\n");
      const head = lines[0];
      const tail = lines.at(-1)!.replace(/ AUTO_INCREMENT=\d+/, "");
      // Executing rendered DDL makes MySQL print explicit charsets; drop what the table default implies
      // so both sides of a comparison render the same text.
      const collation = /COLLATE=(\w+)/.exec(tail)?.[1];
      const impliedCollation = collation ? new RegExp(` COLLATE ${collation}\\b`) : undefined;
      const items = lines.slice(1, -1).map((l) => {
        const item = l
          .trim()
          .replace(/,$/, "")
          .replace(/ CHARACTER SET \w+/, "");
        return impliedCollation ? item.replace(impliedCollation, "") : item;
      });
      const table: DbTable = {
        name,
        columns: [],
        uniques: [],
        indexes: [],
        checks: [],
        foreignKeys: [],
        definition: "",
        comment: commentIn(tail, "="),
      };
      const kept: string[] = [];
      for (const item of items) {
        let m: RegExpExecArray | null;
        if (item.startsWith("`")) {
          const id = leadingIdentifier(item);
          const definition = item.slice(id.length).trim();
          table.columns.push({
            name: unquote(id),
            type: definition.split(/\s/)[0],
            nullable: !/\bNOT NULL\b/.test(definition),
            default: /\bDEFAULT (.+?)(?: (?:ON UPDATE|COMMENT|CHECK|COLLATE)\b|$)/.exec(definition)?.[1] ?? null,
            auto: /\bAUTO_INCREMENT\b/.test(definition),
            definition: item,
            comment: commentIn(definition),
          });
          kept.push(item);
        } else if ((m = /^PRIMARY KEY \((.*)\)/.exec(item))) {
          table.primaryKey = { name: "PRIMARY", columns: backtickList(m[1]), definition: item };
          kept.push(item);
        } else if ((m = /^(UNIQUE )?KEY (`(?:[^`]|``)*`) \((.*?)\)/.exec(item))) {
          table.indexes.push({
            name: unquote(m[2]),
            columns: backtickList(m[3]),
            unique: !!m[1],
            definition: item,
          });
          kept.push(item);
        } else if ((m = /^CONSTRAINT (`(?:[^`]|``)*`) FOREIGN KEY \((.*?)\) REFERENCES (`(?:[^`]|``)*`) \((.*?)\)/.exec(item))) {
          table.foreignKeys.push({
            name: unquote(m[1]),
            columns: backtickList(m[2]),
            table: unquote(m[3]),
            references: backtickList(m[4]),
            definition: item,
          });
        } else if ((m = /^CONSTRAINT (`(?:[^`]|``)*`) CHECK (.*)$/.exec(item))) {
          table.checks.push({ name: unquote(m[1]), expression: squash(m[2]) });
          kept.push(item);
        } else {
          kept.push(item);
        }
      }
      table.definition = [
        head,
        kept
          .map((l) => {
            return "  " + l;
          })
          .join(",\n"),
        tail,
      ].join("\n");
      tables[name] = table;
    }
    return { provider: mysqlProvider, tables };
  };

  /** Database/shadow lifecycle: only SQL text and identity rules vary from PostgreSQL. */
  databaseFlow = createDatabaseFlow<MysqlDatasource>({
    quote: quoteMysqlIdentifier,
    adminConnection: (ds) => this.adminConnection(ds),
    existsSQL: (ds) => ["SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [ds.database]],
    createSQL: (database) => `CREATE DATABASE ${quoteMysqlIdentifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
    dropSQL: (database) => `DROP DATABASE IF EXISTS ${quoteMysqlIdentifier(database)}`,
    shadowName: () => "tsorm_shadow_db_" + randomBytes(8).toString("hex"),
    sameDatabase: (base, shadow) => base.database.toLowerCase() === shadow.database.toLowerCase(),
    shadowMismatchMessage: "The shadow datasource must use a different database name",
    connect: (ds) => this.openConnection(ds),
    withDatabase: (ds, database) => ({ ...ds, database }),
  });

  connectOrCreate = async (ds: Datasource) => this.databaseFlow.connectOrCreate(asMysql(ds));
  databaseExists = async (ds: Datasource) => this.databaseFlow.databaseExists(asMysql(ds));
  createScratch = async (base: Datasource, shadow?: Datasource) => this.databaseFlow.createScratch(asMysql(base), shadow);

  /** Column type text; was the module-level `sqlType`. */
  private sqlType = (c: Column): string => {
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

  /** DDL generation: verbatim table + foreign-key + junction SQL. */
  schemaDDL = (schema: Schema): string[] => {
    const tables: string[] = [];
    const foreign: string[] = [];
    for (const t of Object.values(schema.tables)) {
      if (internalTableName(t).length > 64) {
        fail("MySQL table identifier exceeds 64 characters");
      }
      const col = (key: string) => {
        return quoteMysqlIdentifier(internalColumnName(t.columns[key]));
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
        if (internalColumnName(c).length > 64) {
          fail("MySQL column identifier exceeds 64 characters");
        }
        const name = quoteMysqlIdentifier(internalColumnName(c));
        let s = `${name} ${this.sqlType(c)}${c.nullable ? "" : " NOT NULL"}${c.auto ? " AUTO_INCREMENT" : ""}${c.primary ? " PRIMARY KEY" : ""}${c.unique ? " UNIQUE" : ""}`;
        if (c.default !== undefined) {
          const d = c.default;
          if (d && typeof d === "object") {
            if (d.fn === "now") {
              s += c.dateStorage === "timestamp" ? " DEFAULT (CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED))" : " DEFAULT CURRENT_TIMESTAMP(3)";
            }
          } else {
            this.encode(c, d);
            s += " DEFAULT " + (d !== null && (c.type === "text" || (c.type === "string" && !c.maxLength)) ? "(" + literal(d) + ")" : literal(d));
          }
        }
        if (c.comment) {
          s += ` COMMENT ${literal(c.comment)}`;
        }
        if (c.enum) {
          for (const value of c.enum) {
            this.encode(c, value);
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
        defs.push(`INDEX ${quoteMysqlIdentifier(hashedName(internalObjectName(t), ...keys))} (${keys.map(col).join(",")})`);
      }
      // Decouple relationship-column indexes from foreign keys: explicitly index morph and regular foreign-key columns instead of relying on InnoDB.
      for (const r of Object.values(t.relations)) {
        if (r.owner && !r.many && !t.columns[r.source].unique) {
          defs.push(`INDEX ${quoteMysqlIdentifier(hashedName(internalObjectName(t), r.source, "relidx"))} (${col(r.source)})`);
        }
      }
      tables.push(`CREATE TABLE ${quoteMysqlIdentifier(internalTableName(t))} (${defs.join(", ")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin${t.comment ? ` COMMENT=${literal(t.comment)}` : ""}`);
      for (const r of Object.values(t.relations)) {
        if (r.owner && !r.many && !r.polymorphic) {
          const target = schema.tables[r.target];
          foreign.push(
            `ALTER TABLE ${quoteMysqlIdentifier(internalTableName(t))} ADD CONSTRAINT ${quoteMysqlIdentifier(hashedName(internalObjectName(t), r.name, "fk"))} FOREIGN KEY (${col(r.source)}) REFERENCES ${quoteMysqlIdentifier(internalTableName(target))} (${quoteMysqlIdentifier(internalColumnName(target.columns[r.foreign]))}) ON DELETE ${referentialActions[r.onDelete ?? "Restrict"]} ON UPDATE ${referentialActions[r.onUpdate ?? "Restrict"]}`,
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
            `CREATE TABLE ${quoteMysqlIdentifier(r.junction)} (${quoteMysqlIdentifier("sourceId")} ${this.sqlType(source)} NOT NULL, ${quoteMysqlIdentifier("targetId")} ${this.sqlType(foreignColumn)} NOT NULL, PRIMARY KEY (${quoteMysqlIdentifier("sourceId")},${quoteMysqlIdentifier("targetId")}), INDEX ${quoteMysqlIdentifier(hashedName(r.junction, "relidx"))} (${quoteMysqlIdentifier("targetId")})) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
          );
          foreign.push(
            `ALTER TABLE ${quoteMysqlIdentifier(r.junction)} ADD FOREIGN KEY (${quoteMysqlIdentifier("sourceId")}) REFERENCES ${quoteMysqlIdentifier(internalTableName(t))} (${quoteMysqlIdentifier(internalColumnName(source))}) ON DELETE CASCADE, ADD FOREIGN KEY (${quoteMysqlIdentifier("targetId")}) REFERENCES ${quoteMysqlIdentifier(internalTableName(target))} (${quoteMysqlIdentifier(internalColumnName(foreignColumn))}) ON DELETE CASCADE`,
          );
        }
      }
    }
    return [...tables, ...foreign];
  };

  /** renderDiff SQL rendering: verbatim, every section conditionally pushed. */
  renderDiffSQL = (created: DbTable[], dropped: DbTable[], changed: TableChange[]): Section[] => {
    const sections: Section[] = [];
    const droppedNames = new Set(
      dropped.map((t) => {
        return t.name;
      }),
    );
    pushSection(sections, "DropForeignKey", [
      ...dropped.flatMap((t) => {
        return t.foreignKeys
          .filter((f) => {
            return droppedNames.has(f.table);
          })
          .map((f) => {
            return `ALTER TABLE ${quoteMysqlIdentifier(t.name)} DROP FOREIGN KEY ${quoteMysqlIdentifier(f.name)};`;
          });
      }),
      ...changed.flatMap((c) => {
        return c.droppedForeignKeys.map((f) => {
          return `ALTER TABLE ${quoteMysqlIdentifier(c.name)} DROP FOREIGN KEY ${quoteMysqlIdentifier(f.name)};`;
        });
      }),
    ]);
    pushSection(
      sections,
      "DropIndex",
      changed.flatMap((c) => {
        return c.droppedIndexes.map((i) => {
          return `DROP INDEX ${quoteMysqlIdentifier(i.name)} ON ${quoteMysqlIdentifier(c.name)};`;
        });
      }),
    );
    for (const c of changed) {
      const t = quoteMysqlIdentifier(c.name);
      const statements: string[] = [];
      for (const k of c.droppedChecks) {
        statements.push(`ALTER TABLE ${t} DROP CHECK ${quoteMysqlIdentifier(k.name)};`);
      }
      if (c.primaryKey && c.from.primaryKey) {
        statements.push(`ALTER TABLE ${t} DROP PRIMARY KEY;`);
      }
      for (const col of c.droppedColumns) {
        statements.push(`ALTER TABLE ${t} DROP COLUMN ${quoteMysqlIdentifier(col.name)};`);
      }
      for (const col of c.addedColumns) {
        statements.push(`ALTER TABLE ${t} ADD COLUMN ${col.definition};`);
      }
      for (const { to } of c.alteredColumns) {
        statements.push(`ALTER TABLE ${t} MODIFY ${to.definition};`);
      }
      if (c.primaryKey && c.to.primaryKey) {
        statements.push(`ALTER TABLE ${t} ADD ${c.to.primaryKey.definition};`);
      }
      for (const k of c.addedChecks) {
        statements.push(`ALTER TABLE ${t} ADD CONSTRAINT ${quoteMysqlIdentifier(k.name)} CHECK ${k.expression};`);
      }
      if (c.comment) {
        statements.push(`ALTER TABLE ${t} COMMENT=${c.to.comment ? literal(c.to.comment) : "''"};`);
      }
      pushSection(sections, "AlterTable", statements);
    }
    pushSection(
      sections,
      "DropTable",
      dropped.map((t) => {
        return `DROP TABLE ${quoteMysqlIdentifier(t.name)};`;
      }),
    );
    for (const t of created) {
      pushSection(sections, "CreateTable", [t.definition + ";"]);
    }
    pushSection(
      sections,
      "CreateIndex",
      changed.flatMap((c) => {
        return c.addedIndexes.map((i) => {
          return `ALTER TABLE ${quoteMysqlIdentifier(c.name)} ADD ${i.definition};`;
        });
      }),
    );
    pushSection(sections, "AddForeignKey", [
      ...created.flatMap((t) => {
        return t.foreignKeys.map((f) => {
          return `ALTER TABLE ${quoteMysqlIdentifier(t.name)} ADD ${f.definition};`;
        });
      }),
      ...changed.flatMap((c) => {
        return c.addedForeignKeys.map((f) => {
          return `ALTER TABLE ${quoteMysqlIdentifier(c.name)} ADD ${f.definition};`;
        });
      }),
    ]);
    return sections;
  };

  /** Driver error → OrmError mapping; shared by the adapter and the runtime. */
  translate = (error: any): Error => {
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
  };
}

/**
 * 单一共享实例：适配器工厂与迁移提供者都绑定到它。
 * Single shared instance: the adapter factory and the migration provider both bind to it.
 */
/**
 * @internal 方言单例：内部模块，不属于包公开 API。
 * Dialect singleton: internal module, not part of the package public API.
 */
export const mysqlDialect = new MysqlDialect();

/**
 * 迁移提供者：core 的标准迁移管线 + 本方言的翻译。
 * Migration provider: core's standard migration pipeline plus this dialect's translation.
 */
/**
 * @internal 迁移提供者：内部模块，不属于包公开 API。
 * Migration provider: internal module, not part of the package public API.
 */
export const mysqlProvider: MigrationProvider = createProvider(mysqlDialect);

export interface MySQLOptions {
  /** Connection URL; protocol-critical options are fixed by the adapter. Pool sizing uses the mariadb names directly: `connectionLimit`, `minimumIdle`, `acquireTimeout` and `idleTimeout` (seconds). */
  connection: string;
}

/**
 * 为解析后的 schema 生成 MySQL DDL。
 * Emit MySQL DDL for a parsed schema.
 */
export function mysqlSchemaSQL(schema: Schema): string[] {
  return mysqlDialect.schemaDDL(schema);
}

/** Declarative connection differences; the shared `openRuntime` owns the skeleton. */
const mysqlConnect: ConnectConfig = {
  label: "MySQL",
  parse: (raw: string) => {
    const { url, options: connection } = mysqlConnection(raw);
    return {
      poolArg: {
        ...connection,
        ...mariadbPool(url),
        multipleStatements: false,
        autoJsonMap: false,
        bigIntAsNumber: false,
        insertIdAsNumber: false,
        decimalAsNumber: false,
        // With dateStrings=true in the URL, the driver returns timezone-free date text, but the decoder accepts only Date or ISO text;
        // force date columns to Date by placing this override after the spread options.
        dateStrings: false,
      },
      connection,
    };
  },
  loadDriver: () => import("mariadb").then((m) => m.default),
  createPool: (mariadb: any, poolArg: any) => mariadb.createPool(poolArg),
  acquire: (pool: any) => acquireWithSessionMode(pool),
  release: async (c: MySQLPoolConnection) => await c.release(),
  probe: async (c: MySQLPoolConnection) => {
    const rows = await c.execute("SELECT VERSION() AS version");
    const version = String(rows[0]?.version ?? "");
    const maria = version.includes("MariaDB");
    const match = (maria ? version.replace(/^5\.5\.5-/, "") : version).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) fail("Cannot identify database version");
    const [major, minor, patch] = match!.slice(1).map(Number);
    // MySQL requires 8.0.16: CHECK protects enum/bool columns and earlier versions silently ignore it; expression DEFAULT requires 8.0.13.
    if (maria ? major < 10 || (major === 10 && minor < 6) : major < 8 || (major === 8 && minor === 0 && patch < 16)) {
      throw new OrmError("UNSUPPORTED_SERVER", "Requires MySQL 8.0.16+ or MariaDB 10.6+");
    }
  },
  makeRuntime: (pool: any, mariadb: any, parsed: any) => createPoolRuntime(mysqlDialect, mysqlHooks(mariadb, parsed.connection), pool),
  translate: mysqlDialect.translate,
};

export function mysql(options: MySQLOptions): Adapter {
  return createAdapter(mysqlDialect, () => openRuntime(mysqlConnect, options?.connection));
}
