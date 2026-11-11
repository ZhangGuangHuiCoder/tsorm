import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MigrationError } from "../../migrations/errors.js";
import type { Connection, Datasource, MigrationProvider, Scratch, Section } from "../../migrations/provider.js";
import { columnChanges } from "../../migrations/provider.js";
import { HISTORY_TABLE, balanced, checksIn, leadingIdentifier, splitTopLevel, unquote, type DbColumn, type DbIndex, type DbModel, type DbTable } from "../../migrations/introspect.js";
import type { TableChange } from "../../migrations/diff.js";
import { sqliteSchemaSQL } from "./index.js";
import { isSqliteUrl } from "../urls.js";
import { quoteIdentifier } from "../../query/identifiers.js";

interface SqliteDatasource extends Datasource {
  filename: string;
}

const quote = quoteIdentifier;
const asSqlite = (ds: Datasource) => {
  return ds as SqliteDatasource;
};

function parseDatasource(url: string, root: string): SqliteDatasource {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    throw new MigrationError("INVALID_URL", "SQLite urls use the form file:./dev.db");
  }
  const path = url.startsWith("file:") ? url.slice(5) : url;
  if (path.includes("?")) {
    throw new MigrationError("INVALID_URL", "SQLite url does not support query parameters");
  }
  if (!path) {
    throw new MigrationError("INVALID_URL", "SQLite url needs a file path");
  }
  return { filename: path === ":memory:" ? path : resolve(root, path) };
}

async function connect(ds: SqliteDatasource): Promise<Connection> {
  const db = new DatabaseSync(ds.filename);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  return {
    provider: sqliteProvider,
    datasource: ds,
    async query(sql, params = []) {
      return db.prepare(sql).all(...(params as any[])) as any[];
    },
    async script(sql) {
      db.exec(sql);
    },
    async close() {
      if (db.isOpen) {
        db.close();
      }
    },
  };
}

async function connectOrCreate(ds: SqliteDatasource): Promise<{ conn: Connection; created: boolean }> {
  const created = ds.filename !== ":memory:" && !existsSync(ds.filename);
  if (created) {
    mkdirSync(dirname(ds.filename), { recursive: true });
  }
  return { conn: await connect(ds), created };
}

async function databaseExists(ds: SqliteDatasource): Promise<boolean> {
  return ds.filename === ":memory:" || existsSync(ds.filename);
}

async function clearDatabase(conn: Connection): Promise<void> {
  const objects = await conn.query("SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','view','trigger')");
  await conn.script(
    "PRAGMA foreign_keys=OFF;" +
      objects
        .filter((o) => {
          return o.type !== "trigger";
        })
        .map((o) => {
          return `DROP ${o.type === "view" ? "VIEW" : "TABLE"} IF EXISTS ${quote(o.name)};`;
        })
        .join("") +
      "PRAGMA foreign_keys=ON;",
  );
  const left = await conn.query("SELECT 1 FROM sqlite_sequence LIMIT 1").catch(() => {
    return [];
  });
  if (left.length) {
    await conn.script("DELETE FROM sqlite_sequence");
  }
}

async function resetDatabase(ds: SqliteDatasource): Promise<void> {
  if (ds.filename === ":memory:") {
    return;
  }
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    rmSync(ds.filename + suffix, { force: true });
  }
}

async function createScratch(): Promise<Scratch> {
  let current: Connection | undefined;
  return {
    async open() {
      await current?.close();
      current = await connect({ filename: ":memory:" });
      return current;
    },
    async dispose() {
      await current?.close();
    },
  };
}

async function historyExists(conn: Connection): Promise<boolean> {
  const rows = await conn.query("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?", [HISTORY_TABLE]);
  return rows.length > 0;
}

async function runScriptAtomically(conn: Connection, sql: string): Promise<void> {
  // Table redefinition needs foreign keys off, which SQLite only honours outside a transaction.
  await conn.script("PRAGMA foreign_keys=OFF; BEGIN;");
  try {
    await conn.script(sql);
    const violations = await conn.query("PRAGMA foreign_key_check");
    if (violations.length) {
      throw new MigrationError("FOREIGN_KEY_CHECK", `The script would leave ${violations.length} foreign key violation(s), first in table ${violations[0].table}`);
    }
    await conn.script("COMMIT;");
  } catch (error) {
    try {
      await conn.script("ROLLBACK;");
    } catch {
      // The failed statement may already have ended the transaction.
    }
    throw error;
  } finally {
    await conn.script("PRAGMA foreign_keys=ON;");
  }
}

async function introspect(conn: Connection): Promise<DbModel> {
  const rows = await conn.query("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != ? ORDER BY name", [HISTORY_TABLE]);
  const tables: Record<string, DbTable> = {};
  for (const row of rows) {
    const sql: string = row.sql;
    const open = sql.indexOf("(");
    const body = balanced(sql, open).slice(1, -1);
    const items = splitTopLevel(body);
    const columnText = new Map<string, string>();
    const checks: { name: string; column?: string; expression: string }[] = [];
    for (const item of items) {
      if (/^(constraint|primary|unique|check|foreign)\b/i.test(item)) {
        for (const expression of checksIn(item)) {
          checks.push({ name: "", expression });
        }
        continue;
      }
      const name = unquote(leadingIdentifier(item));
      columnText.set(name, item);
      for (const expression of checksIn(item)) {
        checks.push({ name: "", column: name, expression });
      }
    }
    const info = await conn.query(`PRAGMA table_info(${quote(row.name)})`);
    const auto = /\bAUTOINCREMENT\b/i.test(sql);
    const columns: DbColumn[] = info.map((c) => {
      return {
        name: c.name,
        type: String(c.type).toUpperCase(),
        nullable: !c.notnull && !c.pk,
        default: c.dflt_value ?? null,
        auto: auto && c.pk > 0,
        definition: columnText.get(c.name) ?? `${quote(c.name)} ${c.type}`,
      };
    });
    const pk = info
      .filter((c) => {
        return c.pk > 0;
      })
      .sort((a, b) => {
        return a.pk - b.pk;
      })
      .map((c) => {
        return c.name;
      });
    const uniques: { name: string; columns: string[]; definition: string }[] = [];
    const indexes: DbIndex[] = [];
    for (const index of await conn.query(`PRAGMA index_list(${quote(row.name)})`)) {
      if (index.origin === "pk") {
        continue;
      }
      const indexColumns = (await conn.query(`PRAGMA index_info(${quote(index.name)})`))
        .sort((a, b) => {
          return a.seqno - b.seqno;
        })
        .map((c) => {
          return c.name;
        });
      if (index.origin === "u") {
        uniques.push({
          name: index.name,
          columns: indexColumns,
          definition: "UNIQUE (" + indexColumns.join(",") + ")",
        });
      } else {
        const [{ sql: definition } = { sql: "" }] = await conn.query("SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?", [index.name]);
        indexes.push({
          name: index.name,
          columns: indexColumns,
          unique: !!index.unique,
          definition,
        });
      }
    }
    const fks = new Map<number, DbTable["foreignKeys"][number]>();
    for (const fk of await conn.query(`PRAGMA foreign_key_list(${quote(row.name)})`)) {
      const entry =
        fks.get(fk.id) ??
        fks
          .set(fk.id, {
            name: "",
            columns: [],
            table: fk.table,
            references: [],
            definition: `ON DELETE ${fk.on_delete} ON UPDATE ${fk.on_update}`,
          })
          .get(fk.id)!;
      entry.columns.push(fk.from);
      entry.references.push(fk.to ?? "");
    }
    tables[row.name] = {
      name: row.name,
      columns,
      primaryKey: pk.length ? { name: "", columns: pk, definition: "" } : undefined,
      uniques,
      indexes,
      checks,
      foreignKeys: [...fks.values()],
      definition: sql,
    };
  }
  return { provider: sqliteProvider, tables };
}

function renderDiff(created: DbTable[], dropped: DbTable[], changed: TableChange[]): Section[] {
  const literal = (s: string) => {
    return "'" + s.replaceAll("'", "''") + "'";
  };
  const sections: Section[] = [];
  const push = (comment: string, statements: string[]) => {
    if (statements.length) {
      sections.push([comment, statements]);
    }
  };
  // SQLite can only add plain columns in place; anything else redefines the table.
  const addable = (c: DbColumn) => {
    return !/\b(PRIMARY|UNIQUE|REFERENCES)\b/i.test(c.definition) && !(c.default ?? "").startsWith("(") && (c.nullable || (c.default !== null && c.default.toUpperCase() !== "NULL"));
  };
  const inPlace = (c: TableChange) => {
    return (
      !c.droppedColumns.length &&
      !c.alteredColumns.length &&
      !c.primaryKey &&
      !c.addedUniques.length &&
      !c.droppedUniques.length &&
      !c.droppedChecks.length &&
      !c.addedForeignKeys.length &&
      !c.droppedForeignKeys.length &&
      c.addedColumns.every(addable) &&
      c.addedChecks.every((k) => {
        return (
          k.column &&
          c.addedColumns.some((col) => {
            return col.name === k.column;
          })
        );
      })
    );
  };
  const simple = changed.filter(inPlace);
  const redefined = changed.filter((c) => {
    return !inPlace(c);
  });
  push(
    "DropIndex",
    simple.flatMap((c) => {
      return c.droppedIndexes.map((i) => {
        return `DROP INDEX ${quote(i.name)};`;
      });
    }),
  );
  for (const c of simple) {
    push(
      "AlterTable",
      c.addedColumns.map((col) => {
        return `ALTER TABLE ${quote(c.name)} ADD COLUMN ${col.definition};`;
      }),
    );
  }
  if (dropped.length) {
    push("DropTable", [
      "PRAGMA foreign_keys=off;",
      ...dropped.map((t) => {
        return `DROP TABLE ${quote(t.name)};`;
      }),
      "PRAGMA foreign_keys=on;",
    ]);
  }
  for (const t of created) {
    push("CreateTable", [t.definition + ";"]);
  }
  if (redefined.length) {
    const statements = ["PRAGMA defer_foreign_keys=ON;", "PRAGMA foreign_keys=OFF;"];
    for (const c of redefined) {
      const temp = "new_" + c.name;
      statements.push(c.to.definition.replace(/^CREATE TABLE\s+("(?:[^"]|"")*"|\S+)/i, `CREATE TABLE ${quote(temp)}`) + ";");
      const common = c.to.columns.filter((col) => {
        return c.from.columns.some((x) => {
          return x.name === col.name;
        });
      });
      if (common.length) {
        const names = common
          .map((col) => {
            return quote(col.name);
          })
          .join(", ");
        statements.push(`INSERT INTO ${quote(temp)} (${names}) SELECT ${names} FROM ${quote(c.name)};`);
      }
      if (
        c.from.columns.some((col) => {
          return col.auto;
        }) &&
        c.to.columns.some((col) => {
          return col.auto;
        })
      ) {
        // Keep the AUTOINCREMENT high-water mark so deleted ids are never reused.
        statements.push(
          `UPDATE "sqlite_sequence" SET "seq" = MAX("seq", COALESCE((SELECT "seq" FROM "sqlite_sequence" WHERE "name" = ${literal(c.name)}), 0)) WHERE "name" = ${literal(temp)};`,
          `INSERT INTO "sqlite_sequence" ("name", "seq") SELECT ${literal(temp)}, "seq" FROM "sqlite_sequence" WHERE "name" = ${literal(c.name)} AND NOT EXISTS (SELECT 1 FROM "sqlite_sequence" WHERE "name" = ${literal(temp)});`,
        );
      }
      statements.push(`DROP TABLE ${quote(c.name)};`, `ALTER TABLE ${quote(temp)} RENAME TO ${quote(c.name)};`);
      for (const i of c.to.indexes) {
        statements.push(i.definition + ";");
      }
    }
    statements.push("PRAGMA foreign_keys=ON;", "PRAGMA defer_foreign_keys=OFF;");
    sections.push(["RedefineTables", statements]);
  }
  push("CreateIndex", [
    ...created.flatMap((t) => {
      return t.indexes.map((i) => {
        return i.definition + ";";
      });
    }),
    ...simple.flatMap((c) => {
      return c.addedIndexes.map((i) => {
        return i.definition + ";";
      });
    }),
  ]);
  return sections;
}

const historyDDL = `CREATE TABLE IF NOT EXISTS "${HISTORY_TABLE}" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

export const sqliteProvider: MigrationProvider = {
  id: "sqlite",
  matches: (url) => {
    return isSqliteUrl(url);
  },
  parseDatasource,
  describe: (ds) => {
    return `SQLite database "${asSqlite(ds).filename}"`;
  },
  quote,
  param: () => {
    return "?";
  },
  now: () => {
    return "strftime('%Y-%m-%d %H:%M:%f','now')";
  },
  connect: (ds) => {
    return connect(asSqlite(ds));
  },
  connectOrCreate: (ds) => {
    return connectOrCreate(asSqlite(ds));
  },
  databaseExists: (ds) => {
    return databaseExists(asSqlite(ds));
  },
  clearDatabase,
  resetDatabase: (ds) => {
    return resetDatabase(asSqlite(ds));
  },
  createScratch: () => {
    return createScratch();
  },
  introspect,
  schemaDDL: sqliteSchemaSQL,
  renderDiff,
  indexKey: (item) => {
    return item.definition.replace(/\s+/g, " ");
  },
  columnChanges: (a, b) => {
    return columnChanges(a, b, false);
  },
  historyDDL,
  historyExists,
  runScriptAtomically,
  acquireLock: async () => {},
  releaseLock: async () => {},
};
