import { randomBytes } from "node:crypto";
import mariadb, { type ConnectionConfig } from "mariadb";
import { MigrationError } from "../../migrations/errors.js";
import { parameterValue } from "../../shared/connection.js";
import type { Connection, Datasource, MigrationProvider, Scratch, Section } from "../../migrations/provider.js";
import { columnChanges, structuralIndexKey } from "../../migrations/provider.js";
import { HISTORY_TABLE, leadingIdentifier, splitTopLevel, squash, unquote, type DbModel, type DbTable } from "../../migrations/introspect.js";
import type { TableChange } from "../../migrations/diff.js";
import { mysqlSchemaSQL } from "./index.js";
import { isMysqlUrl } from "../urls.js";
import { quoteMysqlIdentifier } from "../../query/identifiers.js";

interface MysqlDatasource extends Datasource {
  options: ConnectionConfig;
  database: string;
}

const quote = quoteMysqlIdentifier;
const asMysql = (ds: Datasource) => {
  return ds as MysqlDatasource;
};
const withDatabase = (ds: MysqlDatasource, database: string): MysqlDatasource => {
  return {
    ...ds,
    database,
  };
};

function parseDatasource(url: string): MysqlDatasource {
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
    options[key] = parameterValue(value);
  }
  return { options: options as ConnectionConfig, database };
}

async function connect(ds: MysqlDatasource): Promise<Connection> {
  const conn = await mariadb.createConnection({
    ...ds.options,
    database: ds.database,
    multipleStatements: true,
    dateStrings: true,
    bigIntAsNumber: true,
    timezone: "Z",
  });
  try {
    await conn.query("SET SESSION time_zone = '+00:00'");
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
}

async function adminConnection(ds: MysqlDatasource): Promise<Connection> {
  const conn = await mariadb.createConnection({ ...ds.options, multipleStatements: false });
  return {
    provider: mysqlProvider,
    datasource: ds,
    query: async (sql: string, params?: unknown[]) => {
      return conn.query(sql, params);
    },
    script: async (sql: string) => {
      return void (await conn.query(sql));
    },
    close: () => {
      return conn.end();
    },
  };
}

async function databaseExists(ds: MysqlDatasource): Promise<boolean> {
  const admin = await adminConnection(ds);
  try {
    const rows = await admin.query("SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [ds.database]);
    return rows.length > 0;
  } finally {
    await admin.close();
  }
}

async function createDatabase(ds: MysqlDatasource, database: string) {
  const admin = await adminConnection(ds);
  try {
    await admin.script(`CREATE DATABASE ${quote(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  } catch (error) {
    throw new MigrationError("DATABASE_CREATE_FAILED", `Failed to create database ${database}`, {
      cause: error,
    });
  } finally {
    await admin.close();
  }
}

async function dropDatabase(ds: MysqlDatasource, database: string) {
  const admin = await adminConnection(ds);
  try {
    await admin.script(`DROP DATABASE IF EXISTS ${quote(database)}`);
  } finally {
    await admin.close();
  }
}

async function connectOrCreate(ds: MysqlDatasource): Promise<{ conn: Connection; created: boolean }> {
  let created = false;
  if (!(await databaseExists(ds))) {
    await createDatabase(ds, ds.database);
    created = true;
  }
  const conn = await connect(ds);
  return { conn, created };
}

async function clearDatabase(conn: Connection): Promise<void> {
  const objects = await conn.query("SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
  if (!objects.length) {
    return;
  }
  await conn.script(
    "SET FOREIGN_KEY_CHECKS=0;" +
      objects
        .map((o) => {
          return `DROP ${o.type === "VIEW" ? "VIEW" : "TABLE"} IF EXISTS ${quote(o.name)};`;
        })
        .join("") +
      "SET FOREIGN_KEY_CHECKS=1;",
  );
}

async function resetDatabase(ds: MysqlDatasource): Promise<void> {
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

async function createScratch(base: MysqlDatasource, shadow: Datasource | undefined): Promise<Scratch> {
  let current: Connection | undefined;
  if (shadow) {
    const shadowDs = asMysql(shadow);
    // Fail closed for matching database names even across host aliases or proxies.
    if (base.database.toLowerCase() === shadowDs.database.toLowerCase()) {
      throw new MigrationError("INVALID_URL", "The shadow datasource must use a different database name");
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
  const rows = await conn.query("SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [HISTORY_TABLE]);
  return rows.length > 0;
}

async function runScriptAtomically(conn: Connection, sql: string): Promise<void> {
  // MySQL DDL cannot roll back, so the script runs as issued.
  await conn.script(sql);
}

const backtickList = (text: string) => {
  return splitTopLevel(text).map((part) => {
    return unquote(part.replace(/\(\d+\)$/, "").trim());
  });
};

async function introspect(conn: Connection): Promise<DbModel> {
  const tables: Record<string, DbTable> = {};
  const names = await conn.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> ? ORDER BY TABLE_NAME", [HISTORY_TABLE]);
  for (const { name } of names) {
    const [row] = await conn.query(`SHOW CREATE TABLE ${quote(name)}`);
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
          return `ALTER TABLE ${quote(t.name)} DROP FOREIGN KEY ${quote(f.name)};`;
        });
    }),
    ...changed.flatMap((c) => {
      return c.droppedForeignKeys.map((f) => {
        return `ALTER TABLE ${quote(c.name)} DROP FOREIGN KEY ${quote(f.name)};`;
      });
    }),
  ]);
  push(
    "DropIndex",
    changed.flatMap((c) => {
      return c.droppedIndexes.map((i) => {
        return `DROP INDEX ${quote(i.name)} ON ${quote(c.name)};`;
      });
    }),
  );
  for (const c of changed) {
    const t = quote(c.name);
    const statements: string[] = [];
    for (const k of c.droppedChecks) {
      statements.push(`ALTER TABLE ${t} DROP CHECK ${quote(k.name)};`);
    }
    if (c.primaryKey && c.from.primaryKey) {
      statements.push(`ALTER TABLE ${t} DROP PRIMARY KEY;`);
    }
    for (const col of c.droppedColumns) {
      statements.push(`ALTER TABLE ${t} DROP COLUMN ${quote(col.name)};`);
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
      statements.push(`ALTER TABLE ${t} ADD CONSTRAINT ${quote(k.name)} CHECK ${k.expression};`);
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
    push("CreateTable", [t.definition + ";"]);
  }
  push(
    "CreateIndex",
    changed.flatMap((c) => {
      return c.addedIndexes.map((i) => {
        return `ALTER TABLE ${quote(c.name)} ADD ${i.definition};`;
      });
    }),
  );
  push("AddForeignKey", [
    ...created.flatMap((t) => {
      return t.foreignKeys.map((f) => {
        return `ALTER TABLE ${quote(t.name)} ADD ${f.definition};`;
      });
    }),
    ...changed.flatMap((c) => {
      return c.addedForeignKeys.map((f) => {
        return `ALTER TABLE ${quote(c.name)} ADD ${f.definition};`;
      });
    }),
  ]);
  return sections;
}

const historyDDL = `CREATE TABLE IF NOT EXISTS \`${HISTORY_TABLE}\` (
    \`id\`                    VARCHAR(36) PRIMARY KEY NOT NULL,
    \`checksum\`              VARCHAR(64) NOT NULL,
    \`finished_at\`           DATETIME(3),
    \`migration_name\`        VARCHAR(255) NOT NULL,
    \`logs\`                  TEXT,
    \`rolled_back_at\`        DATETIME(3),
    \`started_at\`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`applied_steps_count\`   INTEGER UNSIGNED NOT NULL DEFAULT 0
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

export const mysqlProvider: MigrationProvider = {
  id: "mysql",
  matches: (url) => {
    return isMysqlUrl(url);
  },
  parseDatasource: (url) => {
    return parseDatasource(url);
  },
  describe: (ds) => {
    return `MySQL database "${asMysql(ds).database}"`;
  },
  quote,
  param: () => {
    return "?";
  },
  now: () => {
    return "CURRENT_TIMESTAMP(3)";
  },
  connect: (ds) => {
    return connect(asMysql(ds));
  },
  connectOrCreate: (ds) => {
    return connectOrCreate(asMysql(ds));
  },
  databaseExists: (ds) => {
    return databaseExists(asMysql(ds));
  },
  clearDatabase,
  resetDatabase: (ds) => {
    return resetDatabase(asMysql(ds));
  },
  createScratch: (base, shadow) => {
    return createScratch(asMysql(base), shadow);
  },
  introspect,
  schemaDDL: mysqlSchemaSQL,
  renderDiff,
  indexKey: structuralIndexKey,
  columnChanges: (a, b) => {
    return columnChanges(a, b, true);
  },
  historyDDL,
  historyExists,
  runScriptAtomically,
  acquireLock: async (conn) => {
    const [row] = await conn.query("SELECT GET_LOCK('tsorm_migrate', 10) AS ok");
    if (Number(row.ok) !== 1) {
      throw new MigrationError("MIGRATION_LOCKED", "Timed out waiting for the migration advisory lock");
    }
  },
  releaseLock: async (conn) => {
    await conn.query("SELECT RELEASE_LOCK('tsorm_migrate')");
  },
};
