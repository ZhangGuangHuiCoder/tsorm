import pg from "pg";
import { randomBytes } from "node:crypto";
import { MigrationError } from "../../migrations/errors.js";
import type { Connection, Datasource, MigrationProvider, Scratch, Section } from "../../migrations/provider.js";
import { columnChanges, structuralIndexKey } from "../../migrations/provider.js";
import { historyTable, type DbModel, type DbTable } from "../../migrations/introspect.js";
import type { TableChange } from "../../migrations/diff.js";
import { literal, postgresSchemaSQL } from "./index.js";
import { isPostgresUrl } from "../urls.js";
import { quoteIdentifier } from "../../query/identifiers.js";

interface PostgresDatasource extends Datasource {
  connectionString: string;
  database: string;
  schema: string;
}

const quote = quoteIdentifier;
const asPostgres = (ds: Datasource) => {
  return ds as PostgresDatasource;
};
const withDatabase = (ds: PostgresDatasource, database: string): PostgresDatasource => {
  const url = new URL(ds.connectionString);
  url.pathname = "/" + encodeURIComponent(database);
  return { ...ds, connectionString: url.toString(), database };
};

function parseDatasource(url: string): PostgresDatasource {
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
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new MigrationError("INVALID_URL", "PostgreSQL urls start with postgresql://");
  }
  const schema = parsed.searchParams.get("schema") ?? "public";
  if (!schema || schema.startsWith("pg_") || schema === "information_schema" || schema.includes("\0") || Buffer.byteLength(schema) > 63) {
    throw new MigrationError("INVALID_URL", "Invalid PostgreSQL schema name");
  }
  parsed.searchParams.delete("schema");
  return { connectionString: parsed.toString(), database, schema };
}

async function connect(ds: PostgresDatasource): Promise<Connection> {
  const client = new pg.Client({ connectionString: ds.connectionString });
  // Without a listener a dropped idle connection terminates the process.
  client.on("error", () => {});
  await client.connect();
  try {
    const version = await client.query("SELECT current_setting('server_version_num') AS v");
    if (Number(version.rows[0].v) < 140000) {
      throw new MigrationError("UNSUPPORTED_SERVER", "Requires PostgreSQL 14+");
    }
    await client.query("SET TIME ZONE 'UTC'; SET standard_conforming_strings = on");
    await client.query("SELECT set_config('search_path', $1, false)", [quote(ds.schema)]);
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
}

async function adminConnection(ds: PostgresDatasource): Promise<Connection> {
  return connect(withDatabase(ds, "postgres"));
}

async function databaseExists(ds: PostgresDatasource): Promise<boolean> {
  const admin = await adminConnection(ds);
  try {
    const rows = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [ds.database]);
    return rows.length > 0;
  } finally {
    await admin.close();
  }
}

async function createDatabase(ds: PostgresDatasource, database: string) {
  const admin = await adminConnection(ds);
  try {
    await admin.script(`CREATE DATABASE ${quote(database)}`);
  } catch (error) {
    throw new MigrationError("DATABASE_CREATE_FAILED", `Failed to create database ${database}`, {
      cause: error,
    });
  } finally {
    await admin.close();
  }
}

async function dropDatabase(ds: PostgresDatasource, database: string) {
  const admin = await adminConnection(ds);
  try {
    await admin.script(`DROP DATABASE IF EXISTS ${quote(database)} WITH (FORCE)`);
  } finally {
    await admin.close();
  }
}

async function connectOrCreate(ds: PostgresDatasource): Promise<{ conn: Connection; created: boolean }> {
  let created = false;
  if (!(await databaseExists(ds))) {
    await createDatabase(ds, ds.database);
    created = true;
  }
  const conn = await connect(ds);
  try {
    const found = await conn.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [ds.schema]);
    if (!found.length) {
      await conn.script(`CREATE SCHEMA ${quote(ds.schema)}`);
    }
    return { conn, created };
  } catch (error) {
    await conn.close();
    throw error;
  }
}

async function clearDatabase(conn: Connection): Promise<void> {
  const ds = asPostgres(conn.datasource);
  const keep = ds.ignore;
  if (!keep) {
    await conn.script(`DROP SCHEMA IF EXISTS ${quote(ds.schema)} CASCADE; CREATE SCHEMA ${quote(ds.schema)}`);
    return;
  }
  // Dropping the whole schema would take the ignored tables with it.
  await conn.script(`CREATE SCHEMA IF NOT EXISTS ${quote(ds.schema)}`);
  const objects: { name: string; kind: string }[] = await conn.query("SELECT c.relname AS name, c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m') AND NOT c.relispartition", [
    ds.schema,
  ]);
  const statements = objects
    .filter((o) => {
      return !keep(o.name);
    })
    .map((o) => {
      const kind = o.kind === "v" ? "VIEW" : o.kind === "m" ? "MATERIALIZED VIEW" : "TABLE";
      return `DROP ${kind} IF EXISTS ${quote(ds.schema)}.${quote(o.name)} CASCADE;`;
    });
  if (statements.length) {
    await conn.script(statements.join(" "));
  }
}

async function resetDatabase(ds: PostgresDatasource): Promise<void> {
  if (!(await databaseExists(ds))) {
    return;
  }
  const conn = await connect(ds);
  try {
    await clearDatabase(conn);
  } finally {
    await conn.close();
  }
}

async function createScratch(base: PostgresDatasource, shadow: Datasource | undefined): Promise<Scratch> {
  let current: Connection | undefined;
  if (shadow) {
    const shadowDs = asPostgres(shadow);
    // Fail closed for matching database names even across host aliases or proxies.
    // PostgreSQL schemas are independent migration namespaces.
    if (base.database === shadowDs.database && base.schema === shadowDs.schema) {
      throw new MigrationError("INVALID_URL", "The shadow datasource must use a different database name or schema");
    }
    return {
      async open() {
        await current?.close();
        const { conn } = await connectOrCreate(shadowDs);
        current = conn;
        await clearDatabase(conn);
        return conn;
      },
      async dispose() {
        await current?.close();
      },
    };
  }
  const name = "tsorm_shadow_db_" + randomBytes(8).toString("hex");
  const temp = withDatabase(base, name);
  try {
    await createDatabase(base, name);
  } catch (error) {
    throw new MigrationError("SHADOW_DATABASE_CREATE_FAILED", "Could not create the shadow database. Grant the database user permission to create databases, or set SHADOW_DATABASE_URL", { cause: error });
  }
  return {
    async open() {
      await current?.close();
      const conn = await connect(temp);
      current = conn;
      await clearDatabase(conn);
      return conn;
    },
    async dispose() {
      try {
        await current?.close();
      } finally {
        await dropDatabase(base, name);
      }
    },
  };
}

async function historyExists(conn: Connection): Promise<boolean> {
  const ds = asPostgres(conn.datasource);
  const rows = await conn.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2", [ds.schema, historyTable(conn)]);
  return rows.length > 0;
}

async function runScriptAtomically(conn: Connection, sql: string): Promise<void> {
  // A multi-statement simple query already runs as one implicit transaction.
  await conn.script(sql);
}

const pgActions: Record<string, string> = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
};

async function introspect(conn: Connection): Promise<DbModel> {
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
      definition: `${quote(c.name)} ${c.type}${identity}${c.notnull ? " NOT NULL" : ""}` + (c.default !== null ? " DEFAULT " + c.default : ""),
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
        definition: `FOREIGN KEY (${con.columns.map(quote).join(", ")}) REFERENCES ${quote(con.ref_table)}(${con.ref_columns.map(quote).join(", ")}) ON DELETE ${pgActions[con.on_delete]} ON UPDATE ${pgActions[con.on_update]}`,
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
      definition: `CREATE ${ix.unique ? "UNIQUE " : ""}INDEX ${quote(ix.name)} ON ${quote(ix.table)}(${ix.columns.map(quote).join(", ")})`,
    });
  }
  return { provider: postgresProvider, tables };
}

function renderDiff(created: DbTable[], dropped: DbTable[], changed: TableChange[]): Section[] {
  const sections: Section[] = [];
  const push = (comment: string, statements: string[]) => {
    if (statements.length) {
      sections.push([comment, statements]);
    }
  };
  const droppedNames = new Set(
    dropped.map((t) => {
      return t.name;
    }),
  );
  push("DropForeignKey", [
    ...dropped.flatMap((t) => {
      return t.foreignKeys
        .filter((f) => {
          return droppedNames.has(f.table);
        })
        .map((f) => {
          return `ALTER TABLE ${quote(t.name)} DROP CONSTRAINT ${quote(f.name)};`;
        });
    }),
    ...changed.flatMap((c) => {
      return c.droppedForeignKeys.map((f) => {
        return `ALTER TABLE ${quote(c.name)} DROP CONSTRAINT ${quote(f.name)};`;
      });
    }),
  ]);
  push(
    "DropIndex",
    changed.flatMap((c) => {
      return c.droppedIndexes.map((i) => {
        return `DROP INDEX ${quote(i.name)};`;
      });
    }),
  );
  for (const c of changed) {
    const t = quote(c.name);
    const statements: string[] = [];
    if (c.primaryKey && c.from.primaryKey) {
      statements.push(`ALTER TABLE ${t} DROP CONSTRAINT ${quote(c.from.primaryKey.name)};`);
    }
    for (const u of c.droppedUniques) {
      statements.push(`ALTER TABLE ${t} DROP CONSTRAINT ${quote(u.name)};`);
    }
    for (const k of c.droppedChecks) {
      statements.push(`ALTER TABLE ${t} DROP CONSTRAINT ${quote(k.name)};`);
    }
    for (const col of c.droppedColumns) {
      statements.push(`ALTER TABLE ${t} DROP COLUMN ${quote(col.name)};`);
    }
    for (const col of c.addedColumns) {
      statements.push(`ALTER TABLE ${t} ADD COLUMN ${col.definition};`);
      if (col.comment) {
        statements.push(`COMMENT ON COLUMN ${t}.${quote(col.name)} IS ${literal(col.comment)};`);
      }
    }
    for (const { from, to, changes } of c.alteredColumns) {
      const column = `ALTER TABLE ${t} ALTER COLUMN ${quote(to.name)}`;
      if (from.auto && !to.auto) {
        statements.push(`${column} DROP IDENTITY;`);
      }
      if (changes.includes("default") && to.default === null) {
        statements.push(`${column} DROP DEFAULT;`);
      }
      if (changes.includes("type")) {
        statements.push(`${column} SET DATA TYPE ${to.type} USING ${quote(to.name)}::${to.type};`);
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
        statements.push(`COMMENT ON COLUMN ${t}.${quote(to.name)} IS ${to.comment ? literal(to.comment) : "NULL"};`);
      }
    }
    if (c.primaryKey && c.to.primaryKey) {
      statements.push(`ALTER TABLE ${t} ADD CONSTRAINT ${quote(c.to.primaryKey.name)} ${c.to.primaryKey.definition};`);
    }
    for (const u of c.addedUniques) {
      statements.push(`ALTER TABLE ${t} ADD CONSTRAINT ${quote(u.name)} ${u.definition};`);
    }
    for (const k of c.addedChecks) {
      statements.push(`ALTER TABLE ${t} ADD CONSTRAINT ${quote(k.name)} ${k.expression};`);
    }
    if (c.comment) {
      statements.push(`COMMENT ON TABLE ${t} IS ${c.to.comment ? literal(c.to.comment) : "NULL"};`);
    }
    push("AlterTable", statements);
  }
  push(
    "DropTable",
    dropped.map((t) => {
      return `DROP TABLE ${quote(t.name)};`;
    }),
  );
  for (const t of created) {
    const parts = t.columns.map((c) => {
      return "    " + c.definition;
    });
    const constraints = [...(t.primaryKey ? [t.primaryKey] : []), ...t.uniques].map((c) => {
      return `    CONSTRAINT ${quote(c.name)} ${c.definition}`;
    });
    constraints.push(
      ...t.checks.map((k) => {
        return `    CONSTRAINT ${quote(k.name)} ${k.expression}`;
      }),
    );
    const body = parts.join(",\n") + (constraints.length ? ",\n\n" + constraints.join(",\n") : "");
    const statements = [`CREATE TABLE ${quote(t.name)} (\n${body}\n);`];
    if (t.comment) {
      statements.push(`COMMENT ON TABLE ${quote(t.name)} IS ${literal(t.comment)};`);
    }
    for (const col of t.columns) {
      if (col.comment) {
        statements.push(`COMMENT ON COLUMN ${quote(t.name)}.${quote(col.name)} IS ${literal(col.comment)};`);
      }
    }
    push("CreateTable", statements);
  }
  push("CreateIndex", [
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
  push("AddForeignKey", [
    ...created.flatMap((t) => {
      return t.foreignKeys.map((f) => {
        return `ALTER TABLE ${quote(t.name)} ADD CONSTRAINT ${quote(f.name)} ${f.definition};`;
      });
    }),
    ...changed.flatMap((c) => {
      return c.addedForeignKeys.map((f) => {
        return `ALTER TABLE ${quote(c.name)} ADD CONSTRAINT ${quote(f.name)} ${f.definition};`;
      });
    }),
  ]);
  return sections;
}

const historyDDL = (table: string) => {
  return `CREATE TABLE IF NOT EXISTS ${quote(table)} (
    "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
)`;
};

export const postgresProvider: MigrationProvider = {
  id: "postgresql",
  matches: (url) => {
    return isPostgresUrl(url);
  },
  parseDatasource: (url) => {
    return parseDatasource(url);
  },
  describe: (ds) => {
    return `PostgreSQL schema "${asPostgres(ds).schema}" in database "${asPostgres(ds).database}"`;
  },
  quote,
  param: (index) => {
    return "$" + index;
  },
  now: () => {
    return "now()";
  },
  connect: (ds) => {
    return connect(asPostgres(ds));
  },
  connectOrCreate: (ds) => {
    return connectOrCreate(asPostgres(ds));
  },
  databaseExists: (ds) => {
    return databaseExists(asPostgres(ds));
  },
  clearDatabase,
  resetDatabase: (ds) => {
    return resetDatabase(asPostgres(ds));
  },
  createScratch: (base, shadow) => {
    return createScratch(asPostgres(base), shadow);
  },
  introspect,
  schemaDDL: postgresSchemaSQL,
  renderDiff,
  indexKey: structuralIndexKey,
  columnChanges: (a, b) => {
    return columnChanges(a, b, true);
  },
  historyDDL,
  historyExists,
  runScriptAtomically,
  acquireLock: async (conn) => {
    await conn.query("SELECT pg_advisory_lock(72707369)");
  },
  releaseLock: async (conn) => {
    await conn.query("SELECT pg_advisory_unlock(72707369)");
  },
};
