import { randomBytes } from "node:crypto";
import type pg from "pg";
import { BaseDialect } from "../../core/dialect.js";
import { createDatabaseFlow, createProvider, pushSection } from "../../core/migration.js";
import { createAdapter, createPoolRuntime, openRuntime, type ConnectConfig, type PoolHooks } from "../../core/transport.js";
import { jsonPredicate } from "../../query/json-predicate.js";
import type { Column, Schema } from "../../schema/model.js";
import { internalColumnName, internalObjectName, internalTableName, referentialActions } from "../../schema/model.js";
import { columnChanges, structuralIndexKey, type Connection, type Datasource, type MigrationProvider } from "../../migrations/provider.js";
import { historyTable, type DbColumn, type DbModel, type DbTable } from "../../migrations/diff.js";
import type { TableChange } from "../../migrations/diff.js";
import type { Section } from "../../migrations/provider.js";
import { MigrationError } from "../../migrations/provider.js";
import { OrmError, fail, encode as encodeScalar, hashedName, quoteIdentifier as q, historyTableDDL, connectionURL } from "../../shared/index.js";
import { postgresLiteral, postgresPool } from "./driver.js";
import type { Adapter, Capabilities, TransactionOptions } from "../../core/adapter.js";

/** A client connection from the pool; internal to the adapter, not part of the package public API. */
interface PostgresPoolConnection {
  query(
    text: string | { text: string; values?: any[]; types: pg.CustomTypesConfig; binary?: boolean },
    values?: any[],
  ): Promise<{
    rows: any[];
    rowCount: number | null;
  }>;
  release(error?: Error | boolean): void;
  processID?: number | null;
}

type PgPool = { connect(): Promise<PostgresPoolConnection>; end(): Promise<void> };
type PgModule = typeof pg;

/** PostgreSQL datasource: connection string, target database, and target schema. */
interface PostgresDatasource extends Datasource {
  connectionString: string;
  database: string;
  schema: string;
}

const asPostgres = (ds: Datasource) => {
  return ds as PostgresDatasource;
};

const withDatabase = (ds: PostgresDatasource, database: string): PostgresDatasource => {
  const url = new URL(ds.connectionString);
  url.pathname = "/" + encodeURIComponent(database);
  return { ...ds, connectionString: url.toString(), database };
};

/** Lease a client and set the schema search path, shared by probe and runtime. */
async function acquireWithSearchPath(pool: PgPool, namespace: string): Promise<PostgresPoolConnection> {
  const c = await pool.connect();
  try {
    await c.query("SELECT set_config('search_path', $1, false)", [q(namespace) + ", pg_catalog"]);
    await c.query("SET standard_conforming_strings = on");
    return c;
  } catch (error) {
    c.release(true);
    throw error;
  }
}

/** Standard session capabilities plus PostgreSQL driver differences: type parsing, transaction statements, and cancellation. */
const postgresHooks = (pgModule: PgModule, connection: { connectionString: string }, namespace: string): PoolHooks => ({
  lease: (pool: any) => acquireWithSearchPath(pool, namespace),
  release: (c: PostgresPoolConnection, broken?: boolean) => c.release(broken),
  close: (pool: any) => pool.end(),
  execute: async (c: PostgresPoolConnection, text: string, values: any[]) => {
    const result = await c.query({
      text,
      values,
      binary: false,
      types: {
        getTypeParser: (oid: number, format?: string) => {
          if ([20, 1114, 114, 3802].includes(oid)) {
            return (value: string) => {
              return value;
            };
          }
          return pgModule.types.getTypeParser(oid, format as "text");
        },
      },
    });
    return { rows: result.rows, affectedRows: result.rowCount ?? 0 };
  },
  begin: async (c: PostgresPoolConnection, options?: TransactionOptions & { readOnly?: boolean }) => {
    const parts = ["BEGIN"];
    if (options?.isolationLevel) {
      parts.push("ISOLATION LEVEL " + options.isolationLevel.toUpperCase());
    }
    if (options?.readOnly) {
      parts.push("READ ONLY");
    }
    await c.query(parts.join(" "));
  },
  commit: async (c: PostgresPoolConnection) => {
    await c.query("COMMIT");
  },
  rollback: async (c: PostgresPoolConnection) => {
    await c.query("ROLLBACK");
  },
  cancel: async (c: PostgresPoolConnection) => {
    if (!c.processID) {
      return;
    }
    const admin = new pgModule.Client(connection);
    admin.on("error", () => {});
    try {
      await admin.connect();
      await admin.query("SELECT pg_cancel_backend($1)", [c.processID]);
    } finally {
      await admin.end().catch(() => {});
    }
  },
});

/** Maps pg_constraint referential action codes to SQL keywords. */
const pgActions: Record<string, string> = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
};

/** SQL literals for the PostgreSQL dialect: booleans use TRUE/FALSE; other values reuse shared escaping rules. */
/**
 * PostgreSQL: 方言翻译的唯一落点。
 *
 * 基类 `BaseDialect` 承担与其它方言一致的标准行为，这里只重写 PostgreSQL 的差异：
 * `$n` 占位符、TRUE/FALSE 字面量、ILIKE 谓词、NULLS 排序、BOOL_AND/BOOL_OR 聚合与错误码映射，
 * 以及迁移侧的目录查询、schema 管理、建库与影子库规则。
 * `name` 保持 `postgres`，迁移 provider 的 id 则是 `postgresql` —— 这个历史差异是刻意的。
 *
 * PostgreSQL: the single location for dialect translation.
 *
 * `BaseDialect` provides standard behavior shared with other dialects; only PostgreSQL differences
 * are overridden here: `$n` placeholders, TRUE/FALSE literals, ILIKE predicates, NULLS ordering,
 * BOOL_AND/BOOL_OR aggregation and error mapping, plus migration catalog queries, schema management,
 * database creation, and scratch database rules. `name` remains `postgres`, while the migration
 * provider id is `postgresql`; this historical difference is intentional.
 */
/**
 * @internal PostgreSQL 方言实现：内部模块，不属于包公开 API。
 * PostgreSQL dialect implementation: internal module, not part of the package public API.
 */
export class PostgresDialect extends BaseDialect {
  name = "postgres" as const;
  providerId = "postgresql" as const;
  capabilities: Capabilities = { returning: true, isolationLevels: ["read committed", "repeatable read", "serializable"] };
  parameter = (i: number) => "$" + i;
  unlimited = null;
  trueLiteral = "TRUE";
  falseLiteral = "FALSE";
  bigintOperand = (value: any) => String(value);
  integerDivide = (expr: string) => expr;
  containsPredicate = (col: string, placeholder: string, insensitive: boolean) => (insensitive ? `${col} ILIKE ${placeholder} ESCAPE '!'` : `${col} LIKE ${placeholder} ESCAPE '!'`);
  nullsOrder = (first: boolean) => `NULLS ${first ? "FIRST" : "LAST"}`;
  booleanMinMax = (op: "MIN" | "MAX", expr: string) => (op === "MIN" ? "BOOL_AND(" : "BOOL_OR(") + expr + ")";
  defaultTransactionIsolation = (readOnly: boolean) => (readOnly ? ("repeatable read" as const) : ("read committed" as const));

  /** Convert byte columns to Buffer, send big integers as text, and pass booleans to the driver unchanged. */
  protected encodeValue = (column: Column, value: any): any => {
    const validated = encodeScalar(column, value);
    if (column.type === "bytes" && validated !== null) {
      return Buffer.from(validated);
    }
    if (column.type === "bigint" && validated !== null) {
      return String(validated);
    }
    return column.type === "boolean" && value !== null ? value : validated;
  };

  json = {
    predicate: jsonPredicate((col, path, bind, falsity) => {
      const pathParam = () => {
        return bind(path.map(String)) + "::text[]";
      };
      const text = () => {
        return `${col} #>> ${pathParam()}`;
      };
      return {
        type: () => `jsonb_typeof(${col} #> ${pathParam()})`,
        text,
        number: () => `(${text()})::numeric`,
        types: { string: "'string'", number: "'number'" },
        falsity,
        equals: (v: any) => `COALESCE(${col} #> ${pathParam()} = ${bind(JSON.stringify(v))}::jsonb, ${falsity})`,
      };
    }),
  };

  // ─── 迁移侧的翻译 ────────────────────────────────────────────────────────
  now = () => "now()";
  describe = (ds: Datasource) => `PostgreSQL schema "${asPostgres(ds).schema}" in database "${asPostgres(ds).database}"`;
  indexKey = structuralIndexKey;
  columnChanges = (a: DbColumn, b: DbColumn) => columnChanges(a, b, true);
  historyDDL = (table: string) => historyTableDDL(table, q, { id: "VARCHAR(36)", time: "TIMESTAMPTZ", now: "now()" });
  runScriptAtomically = async (conn: Connection, sql: string) => conn.script(sql);
  acquireLock = async (conn: Connection) => void (await conn.query("SELECT pg_advisory_lock(72707369)"));
  releaseLock = async (conn: Connection) => void (await conn.query("SELECT pg_advisory_unlock(72707369)"));

  parseDatasource = (url: string): PostgresDatasource => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new MigrationError("INVALID_URL", "Invalid postgresql url");
    }
    const database = decodeURIComponent(parsed.pathname.slice(1));
    if (!database) {
      throw new MigrationError("INVALID_URL", "The postgresql url must name a database");
    }
    if (!["postgresql:"].includes(parsed.protocol)) {
      throw new MigrationError("INVALID_URL", "PostgreSQL urls start with postgresql://");
    }
    const schema = parsed.searchParams.get("schema") ?? "public";
    if (!schema || schema.startsWith("pg_") || schema === "information_schema" || schema.includes("\0") || Buffer.byteLength(schema) > 63) {
      throw new MigrationError("INVALID_URL", "Invalid PostgreSQL schema name");
    }
    parsed.searchParams.delete("schema");
    // Pool settings size the adapter's pool, not the single migration connection.
    for (const key of ["max", "min", "connectionTimeoutMillis", "idleTimeoutMillis"]) {
      parsed.searchParams.delete(key);
    }
    return { connectionString: parsed.toString(), database, schema };
  };

  /** Open a migration connection; load the pg driver only when connecting. */
  openConnection = async (ds: PostgresDatasource): Promise<Connection> => {
    const pgModule = (await import("pg")).default;
    const client = new pgModule.Client({ connectionString: ds.connectionString });
    // Without a listener a dropped idle connection terminates the process.
    client.on("error", () => {});
    await client.connect();
    try {
      const version = await client.query("SELECT current_setting('server_version_num') AS v");
      if (Number(version.rows[0].v) < 140000) {
        throw new MigrationError("UNSUPPORTED_SERVER", "Requires PostgreSQL 14+");
      }
      await client.query("SET standard_conforming_strings = on");
      await client.query("SELECT set_config('search_path', $1, false)", [q(ds.schema)]);
    } catch (error) {
      await client.end();
      throw error;
    }
    return {
      provider: postgresProvider,
      datasource: ds,
      async query(sql, params) {
        return (await client.query(sql, params as any[])).rows;
      },
      async script(sql) {
        // A multi-statement simple query runs as one implicit transaction.
        await client.query(sql);
      },
      async close() {
        await client.end();
      },
    };
  };

  connectMigration = async (ds: Datasource): Promise<Connection> => this.openConnection(asPostgres(ds));

  /** Administrative connection to the postgres maintenance database for creating and dropping databases. */
  adminConnection = async (ds: PostgresDatasource): Promise<Connection> => {
    return this.openConnection(withDatabase(ds, "postgres"));
  };

  clearDatabase = async (conn: Connection): Promise<void> => {
    const ds = asPostgres(conn.datasource);
    const keep = ds.ignore;
    if (!keep) {
      await conn.script(`DROP SCHEMA IF EXISTS ${q(ds.schema)} CASCADE; CREATE SCHEMA ${q(ds.schema)}`);
      return;
    }
    // Dropping the whole schema would take the ignored tables with it.
    await conn.script(`CREATE SCHEMA IF NOT EXISTS ${q(ds.schema)}`);
    const objects: { name: string; kind: string }[] = await conn.query(
      "SELECT c.relname AS name, c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m') AND NOT c.relispartition",
      [ds.schema],
    );
    const statements = objects
      .filter((o) => {
        return !keep(o.name);
      })
      .map((o) => {
        const kind = o.kind === "v" ? "VIEW" : o.kind === "m" ? "MATERIALIZED VIEW" : "TABLE";
        return `DROP ${kind} IF EXISTS ${q(ds.schema)}.${q(o.name)} CASCADE;`;
      });
    if (statements.length) {
      await conn.script(statements.join(" "));
    }
  };

  historyExists = async (conn: Connection): Promise<boolean> => {
    const ds = asPostgres(conn.datasource);
    const rows = await conn.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2", [ds.schema, historyTable(conn)]);
    return rows.length > 0;
  };

  introspect = async (conn: Connection): Promise<DbModel> => {
    const ds = asPostgres(conn.datasource);
    const tables: Record<string, DbTable> = {};
    const relations = (
      await conn.query("SELECT c.relname AS name, obj_description(c.oid, 'pg_class') AS comment FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r','p') AND c.relname <> $2 ORDER BY c.relname", [
        ds.schema,
        historyTable(conn),
      ])
    ).filter((r) => {
      return !ds.ignore?.(r.name);
    });
    for (const r of relations) {
      tables[r.name] = {
        name: r.name,
        columns: [],
        uniques: [],
        indexes: [],
        checks: [],
        foreignKeys: [],
        definition: "",
        comment: r.comment ?? undefined,
      };
    }
    const columns = await conn.query(
      `SELECT c.relname AS "table", a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
       a.attnotnull AS notnull, pg_get_expr(d.adbin, d.adrelid) AS "default", a.attidentity AS identity,
       col_description(c.oid, a.attnum) AS comment
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid
     LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE n.nspname = $1 AND c.relkind IN ('r','p') AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum`,
      [ds.schema],
    );
    for (const c of columns) {
      const table = tables[c.table];
      if (!table) {
        continue;
      }
      let identity = "";
      if (c.identity === "a") {
        identity = " GENERATED ALWAYS AS IDENTITY";
      } else if (c.identity === "d") {
        identity = " GENERATED BY DEFAULT AS IDENTITY";
      }
      table.columns.push({
        name: c.name,
        type: c.type,
        nullable: !c.notnull,
        default: c.default,
        auto: !!identity,
        definition: `${q(c.name)} ${c.type}${identity}${c.notnull ? " NOT NULL" : ""}` + (c.default !== null ? " DEFAULT " + c.default : ""),
        comment: c.comment ?? undefined,
      });
    }
    const constraints = await conn.query(
      `SELECT c.relname AS "table", con.conname AS name, con.contype AS type,
       pg_get_constraintdef(con.oid) AS definition, f.relname AS ref_table,
       con.confdeltype AS on_delete, con.confupdtype AS on_update,
       to_json(ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(n, o)
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n ORDER BY k.o)) AS columns,
       to_json(ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(n, o)
         JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n ORDER BY k.o)) AS ref_columns
     FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_class f ON f.oid = con.confrelid
     WHERE n.nspname = $1 AND con.contype IN ('p','u','c','f') ORDER BY c.relname, con.conname`,
      [ds.schema],
    );
    for (const con of constraints) {
      const table = tables[con.table];
      if (!table) {
        continue;
      }
      if (con.type === "p") {
        table.primaryKey = { name: con.name, columns: con.columns, definition: con.definition };
      } else if (con.type === "u") {
        table.uniques.push({ name: con.name, columns: con.columns, definition: con.definition });
      } else if (con.type === "c") {
        table.checks.push({
          name: con.name,
          column: con.columns.length === 1 ? con.columns[0] : undefined,
          expression: con.definition,
        });
      } else {
        table.foreignKeys.push({
          name: con.name,
          columns: con.columns,
          table: con.ref_table,
          references: con.ref_columns,
          definition: `FOREIGN KEY (${con.columns.map(q).join(", ")}) REFERENCES ${q(con.ref_table)}(${con.ref_columns.map(q).join(", ")}) ON DELETE ${pgActions[con.on_delete]} ON UPDATE ${pgActions[con.on_update]}`,
        });
      }
    }
    const indexes = await conn.query(
      `SELECT t.relname AS "table", i.relname AS name, ix.indisunique AS "unique",
       to_json(ARRAY(SELECT a.attname::text FROM unnest(ix.indkey::int2[]) WITH ORDINALITY k(n, o)
         JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.n ORDER BY k.o)) AS columns
     FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND NOT EXISTS (
       SELECT 1 FROM pg_constraint con WHERE con.conindid = ix.indexrelid AND con.contype IN ('p','u','x'))
     ORDER BY t.relname, i.relname`,
      [ds.schema],
    );
    for (const ix of indexes) {
      const table = tables[ix.table];
      if (!table) {
        continue;
      }
      table.indexes.push({
        name: ix.name,
        columns: ix.columns,
        unique: ix.unique,
        definition: `CREATE ${ix.unique ? "UNIQUE " : ""}INDEX ${q(ix.name)} ON ${q(ix.table)}(${ix.columns.map(q).join(", ")})`,
      });
    }
    return { provider: postgresProvider, tables };
  };

  /** Database/shadow lifecycle: `adminConnection`/`withDatabase`/`afterConnect` stay as hooks. */
  databaseFlow = createDatabaseFlow<PostgresDatasource>({
    quote: q,
    adminConnection: (ds) => this.adminConnection(ds),
    existsSQL: (ds) => ["SELECT 1 FROM pg_database WHERE datname = $1", [ds.database]],
    createSQL: (database) => `CREATE DATABASE ${q(database)}`,
    dropSQL: (database) => `DROP DATABASE IF EXISTS ${q(database)} WITH (FORCE)`,
    shadowName: () => "tsorm_shadow_db_" + randomBytes(8).toString("hex"),
    sameDatabase: (base, shadow) => base.database === shadow.database && base.schema === shadow.schema,
    shadowMismatchMessage: "The shadow datasource must use a different database name or schema",
    connect: (ds) => this.openConnection(ds),
    withDatabase,
    afterConnect: async (conn, ds) => {
      const found = await conn.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [ds.schema]);
      if (!found.length) {
        await conn.script(`CREATE SCHEMA ${q(ds.schema)}`);
      }
    },
  });

  connectOrCreate = async (ds: Datasource) => this.databaseFlow.connectOrCreate(asPostgres(ds));
  databaseExists = async (ds: Datasource) => this.databaseFlow.databaseExists(asPostgres(ds));
  createScratch = async (base: Datasource, shadow?: Datasource) => this.databaseFlow.createScratch(asPostgres(base), shadow);

  /** Column type text; was the module-level `sqlType`. */
  private sqlType = (c: Column): string => {
    return {
      int: "BIGINT",
      bigint: "BIGINT",
      number: "DOUBLE PRECISION",
      decimal: c.precision !== undefined ? `NUMERIC(${c.precision},${c.scale})` : "NUMERIC",
      string: c.maxLength ? `VARCHAR(${c.maxLength})` : "TEXT",
      text: "TEXT",
      boolean: "BOOLEAN",
      json: "JSONB",
      datetime: c.dateStorage === "timestamp" ? "BIGINT" : "TIMESTAMP(3) WITH TIME ZONE",
      bytes: "BYTEA",
    }[c.type];
  };

  private validateName = (s: string): void => {
    if (Buffer.byteLength(s, "utf8") > 63) {
      fail("PostgreSQL identifiers must fit in 63 UTF-8 bytes");
    }
  };

  /** DDL generation: verbatim table/comment/constraint/index SQL with the original bucket order. */
  schemaDDL = (schema: Schema): string[] => {
    const tables: string[] = [];
    const comments: string[] = [];
    const constraints: string[] = [];
    const indexes: string[] = [];
    for (const t of Object.values(schema.tables)) {
      this.validateName(internalTableName(t));
      const col = (key: string) => {
        return q(internalColumnName(t.columns[key]));
      };
      const defs = Object.values(t.columns).map((c) => {
        this.validateName(internalColumnName(c));
        const name = q(internalColumnName(c));
        let sql = `${name} ${this.sqlType(c)}${c.auto ? " GENERATED ALWAYS AS IDENTITY" : ""}${c.nullable ? "" : " NOT NULL"}${c.primary ? " PRIMARY KEY" : ""}${c.unique ? " UNIQUE" : ""}`;
        if (c.default !== undefined) {
          const d = c.default;
          if (d && typeof d === "object") {
            if (d.fn === "now") {
              sql += c.dateStorage === "timestamp" ? " DEFAULT ((EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)*1000)::BIGINT)" : " DEFAULT CURRENT_TIMESTAMP";
            }
          } else {
            this.encode(c, d);
            sql += " DEFAULT " + postgresLiteral(d);
          }
        }
        if (c.enum) {
          sql += ` CHECK (${name} IN (${c.enum.map(postgresLiteral).join(",")}))`;
        }
        return sql;
      });
      if (t.primaryKey?.length) {
        defs.push(`PRIMARY KEY (${t.primaryKey.map(col).join(",")})`);
      }
      for (const keys of t.unique) {
        defs.push(`UNIQUE (${keys.map(col).join(",")})`);
      }
      tables.push(`CREATE TABLE ${q(internalTableName(t))} (${defs.join(", ")})`);
      // PostgreSQL comments are separate statements emitted after table creation.
      if (t.comment) {
        comments.push(`COMMENT ON TABLE ${q(internalTableName(t))} IS ${postgresLiteral(t.comment)}`);
      }
      for (const c of Object.values(t.columns)) {
        if (c.comment) {
          comments.push(`COMMENT ON COLUMN ${q(internalTableName(t))}.${q(internalColumnName(c))} IS ${postgresLiteral(c.comment)}`);
        }
      }
      for (const keys of t.indexes) {
        indexes.push(`CREATE INDEX ${q(hashedName(internalObjectName(t), ...keys))} ON ${q(internalTableName(t))} (${keys.map(col).join(",")})`);
      }
      for (const r of Object.values(t.relations)) {
        if (r.owner && !r.many && !r.polymorphic) {
          const target = schema.tables[r.target];
          constraints.push(
            `ALTER TABLE ${q(internalTableName(t))} ADD CONSTRAINT ${q(hashedName(internalObjectName(t), r.name, "fk"))} FOREIGN KEY (${col(r.source)}) REFERENCES ${q(internalTableName(target))} (${q(internalColumnName(target.columns[r.foreign]))}) ON DELETE ${referentialActions[r.onDelete ?? "Restrict"]} ON UPDATE ${referentialActions[r.onUpdate ?? "Restrict"]}`,
          );
        }
      }
      // Decouple relationship-column indexes from foreign keys: index morph and regular foreign-key columns, naming only the relationship column.
      for (const r of Object.values(t.relations)) {
        if (r.owner && !r.many && !t.columns[r.source].unique) {
          indexes.push(`CREATE INDEX ${q(hashedName(internalObjectName(t), r.source, "relidx"))} ON ${q(internalTableName(t))} (${col(r.source)})`);
        }
      }
    }
    for (const t of Object.values(schema.tables)) {
      for (const r of Object.values(t.relations)) {
        if (r.owner && r.junction) {
          this.validateName(r.junction);
          const target = schema.tables[r.target];
          const source = t.columns[r.source];
          const foreign = target.columns[r.foreign];
          tables.push(`CREATE TABLE ${q(r.junction)} (${q("sourceId")} ${this.sqlType(source)} NOT NULL, ${q("targetId")} ${this.sqlType(foreign)} NOT NULL, PRIMARY KEY (${q("sourceId")},${q("targetId")}))`);
          constraints.push(
            `ALTER TABLE ${q(r.junction)} ADD FOREIGN KEY (${q("sourceId")}) REFERENCES ${q(internalTableName(t))} (${q(internalColumnName(source))}) ON DELETE CASCADE, ADD FOREIGN KEY (${q("targetId")}) REFERENCES ${q(internalTableName(target))} (${q(internalColumnName(foreign))}) ON DELETE CASCADE`,
          );
          indexes.push(`CREATE INDEX ${q(hashedName(r.junction, "relidx"))} ON ${q(r.junction)} (${q("targetId")})`);
        }
      }
    }
    return [...tables, ...comments, ...constraints, ...indexes];
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
            return `ALTER TABLE ${q(t.name)} DROP CONSTRAINT ${q(f.name)};`;
          });
      }),
      ...changed.flatMap((c) => {
        return c.droppedForeignKeys.map((f) => {
          return `ALTER TABLE ${q(c.name)} DROP CONSTRAINT ${q(f.name)};`;
        });
      }),
    ]);
    pushSection(
      sections,
      "DropIndex",
      changed.flatMap((c) => {
        return c.droppedIndexes.map((i) => {
          return `DROP INDEX ${q(i.name)};`;
        });
      }),
    );
    for (const c of changed) {
      const t = q(c.name);
      const statements: string[] = [];
      if (c.primaryKey && c.from.primaryKey) {
        statements.push(`ALTER TABLE ${t} DROP CONSTRAINT ${q(c.from.primaryKey.name)};`);
      }
      for (const u of c.droppedUniques) {
        statements.push(`ALTER TABLE ${t} DROP CONSTRAINT ${q(u.name)};`);
      }
      for (const k of c.droppedChecks) {
        statements.push(`ALTER TABLE ${t} DROP CONSTRAINT ${q(k.name)};`);
      }
      for (const col of c.droppedColumns) {
        statements.push(`ALTER TABLE ${t} DROP COLUMN ${q(col.name)};`);
      }
      for (const col of c.addedColumns) {
        statements.push(`ALTER TABLE ${t} ADD COLUMN ${col.definition};`);
        if (col.comment) {
          statements.push(`COMMENT ON COLUMN ${t}.${q(col.name)} IS ${postgresLiteral(col.comment)};`);
        }
      }
      for (const { from, to, changes } of c.alteredColumns) {
        const column = `ALTER TABLE ${t} ALTER COLUMN ${q(to.name)}`;
        if (from.auto && !to.auto) {
          statements.push(`${column} DROP IDENTITY;`);
        }
        if (changes.includes("default") && to.default === null) {
          statements.push(`${column} DROP DEFAULT;`);
        }
        if (changes.includes("type")) {
          statements.push(`${column} SET DATA TYPE ${to.type} USING ${q(to.name)}::${to.type};`);
        }
        if (changes.includes("default") && to.default !== null) {
          statements.push(`${column} SET DEFAULT ${to.default};`);
        }
        if (from.nullable !== to.nullable) {
          statements.push(`${column} ${to.nullable ? "DROP" : "SET"} NOT NULL;`);
        }
        if (!from.auto && to.auto) {
          const identity = /GENERATED (ALWAYS|BY DEFAULT) AS IDENTITY/.exec(to.definition)![1];
          statements.push(`${column} ADD GENERATED ${identity} AS IDENTITY;`);
        }
        if (changes.includes("comment")) {
          statements.push(`COMMENT ON COLUMN ${t}.${q(to.name)} IS ${to.comment ? postgresLiteral(to.comment) : "NULL"};`);
        }
      }
      if (c.primaryKey && c.to.primaryKey) {
        statements.push(`ALTER TABLE ${t} ADD CONSTRAINT ${q(c.to.primaryKey.name)} ${c.to.primaryKey.definition};`);
      }
      for (const u of c.addedUniques) {
        statements.push(`ALTER TABLE ${t} ADD CONSTRAINT ${q(u.name)} ${u.definition};`);
      }
      for (const k of c.addedChecks) {
        statements.push(`ALTER TABLE ${t} ADD CONSTRAINT ${q(k.name)} ${k.expression};`);
      }
      if (c.comment) {
        statements.push(`COMMENT ON TABLE ${t} IS ${c.to.comment ? postgresLiteral(c.to.comment) : "NULL"};`);
      }
      pushSection(sections, "AlterTable", statements);
    }
    pushSection(
      sections,
      "DropTable",
      dropped.map((t) => {
        return `DROP TABLE ${q(t.name)};`;
      }),
    );
    for (const t of created) {
      const parts = t.columns.map((c) => {
        return "    " + c.definition;
      });
      const constraints = [...(t.primaryKey ? [t.primaryKey] : []), ...t.uniques].map((c) => {
        return `    CONSTRAINT ${q(c.name)} ${c.definition}`;
      });
      constraints.push(
        ...t.checks.map((k) => {
          return `    CONSTRAINT ${q(k.name)} ${k.expression}`;
        }),
      );
      const body = parts.join(",\n") + (constraints.length ? ",\n\n" + constraints.join(",\n") : "");
      const statements = [`CREATE TABLE ${q(t.name)} (\n${body}\n);`];
      if (t.comment) {
        statements.push(`COMMENT ON TABLE ${q(t.name)} IS ${postgresLiteral(t.comment)};`);
      }
      for (const col of t.columns) {
        if (col.comment) {
          statements.push(`COMMENT ON COLUMN ${q(t.name)}.${q(col.name)} IS ${postgresLiteral(col.comment)};`);
        }
      }
      pushSection(sections, "CreateTable", statements);
    }
    pushSection(sections, "CreateIndex", [
      ...created.flatMap((t) => {
        return t.indexes.map((i) => {
          return i.definition + ";";
        });
      }),
      ...changed.flatMap((c) => {
        return c.addedIndexes.map((i) => {
          return i.definition + ";";
        });
      }),
    ]);
    pushSection(sections, "AddForeignKey", [
      ...created.flatMap((t) => {
        return t.foreignKeys.map((f) => {
          return `ALTER TABLE ${q(t.name)} ADD CONSTRAINT ${q(f.name)} ${f.definition};`;
        });
      }),
      ...changed.flatMap((c) => {
        return c.addedForeignKeys.map((f) => {
          return `ALTER TABLE ${q(c.name)} ADD CONSTRAINT ${q(f.name)} ${f.definition};`;
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
    if (error instanceof Error && !Object.hasOwn(error, "code")) {
      return error;
    }
    const codes: Record<string, string> = {
      "23505": "UNIQUE_CONSTRAINT",
      "23503": "FOREIGN_KEY_CONSTRAINT",
      "23001": "FOREIGN_KEY_CONSTRAINT",
      "23502": "NOT_NULL_CONSTRAINT",
      "23514": "CHECK_CONSTRAINT",
      "40001": "SERIALIZATION_FAILURE",
      "40P01": "TRANSACTION_DEADLOCK",
      "55P03": "LOCK_TIMEOUT",
      "57014": "QUERY_CANCELLED",
      "25P02": "TRANSACTION_ABORTED",
    };
    return new OrmError(codes[error?.code] ?? "DATABASE_ERROR", `PostgreSQL operation failed (${error?.code ?? "unknown"})`, { cause: error });
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
export const postgresDialect = new PostgresDialect();

/**
 * 迁移提供者：core 的标准迁移管线 + 本方言的翻译。
 * Migration provider: core's standard migration pipeline plus this dialect's translation.
 */
/**
 * @internal 迁移提供者：内部模块，不属于包公开 API。
 * Migration provider: internal module, not part of the package public API.
 */
export const postgresProvider: MigrationProvider = createProvider(postgresDialect);

export interface PostgresOptions {
  /**
   * PostgreSQL connection URL. Pool sizing uses the pg names directly: `max`, `min`,
   * `connectionTimeoutMillis` and `idleTimeoutMillis` (milliseconds). The `schema`
   * query parameter selects the target schema, `public` by default.
   */
  connection: string;
}

/**
 * 为解析后的 schema 生成 PostgreSQL DDL。
 * Emit PostgreSQL DDL for a parsed schema.
 */
export function postgresSchemaSQL(schema: Schema): string[] {
  return postgresDialect.schemaDDL(schema);
}

/** Declarative connection differences; the shared `openRuntime` owns the skeleton. */
const postgresConnect: ConnectConfig = {
  label: "PostgreSQL",
  parse: (raw: string) => {
    const url = connectionURL(raw, ["postgresql:"]);
    const sizing = postgresPool(url);
    const namespace = url.searchParams.get("schema") ?? "public";
    url.searchParams.delete("schema");
    const connection = { connectionString: url.toString() };
    if (!namespace || namespace.startsWith("pg_") || namespace === "information_schema" || namespace.includes("\0") || Buffer.byteLength(namespace) > 63) {
      fail("Invalid PostgreSQL schema name");
    }
    return { poolArg: { ...sizing, ...connection }, connection, namespace };
  },
  loadDriver: () => import("pg").then((m) => m.default),
  createPool: (pgModule: typeof pg, poolArg: any) => {
    const created = new pgModule.Pool(poolArg);
    // pg reports idle connection failures on the pool; without a listener they surface as
    // unhandled errors and terminate the process.
    created.on("error", () => {});
    return created;
  },
  acquire: (pool: PgPool, parsed: { namespace: string }) => acquireWithSearchPath(pool, parsed.namespace),
  release: (c: PostgresPoolConnection) => c.release(),
  probe: async (c: PostgresPoolConnection, parsed: { namespace: string }) => {
    const version = await c.query("SELECT current_setting('server_version_num') AS version");
    if (Number(version.rows[0]?.version) < 140000 || !Number.isFinite(Number(version.rows[0]?.version))) throw new OrmError("UNSUPPORTED_SERVER", "Requires PostgreSQL 14+");
    const found = await c.query("SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = $1", [parsed.namespace]);
    if (!found.rows.length) throw new OrmError("SCHEMA_NOT_FOUND", "Create the PostgreSQL schema before connecting");
  },
  makeRuntime: (pool: PgPool, pgModule: PgModule, parsed: any) => createPoolRuntime(postgresDialect, postgresHooks(pgModule, parsed.connection, parsed.namespace), pool),
  translate: postgresDialect.translate,
};

export function postgres(options: PostgresOptions): Adapter {
  return createAdapter(postgresDialect, () => openRuntime(postgresConnect, options?.connection));
}
