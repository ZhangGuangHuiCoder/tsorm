import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BaseDialect } from "../../core/dialect.js";
import { createProvider, pushSection } from "../../core/migration.js";
import { createAdapter } from "../../core/transport.js";
import { createSingleRuntime } from "./driver.js";
import { jsonPath, jsonPredicate } from "../../query/json-predicate.js";
import type { Column, Schema } from "../../schema/model.js";
import { internalColumnName, internalObjectName, internalTableName, referentialActions } from "../../schema/model.js";
import { columnChanges, scratchDatabase, type Connection, type Datasource, type MigrationProvider, type Scratch } from "../../migrations/provider.js";
import { historyTable, balanced, checksIn, leadingIdentifier, splitTopLevel, unquote, type DbColumn, type DbIndex, type DbModel, type DbTable } from "../../migrations/diff.js";
import type { TableChange } from "../../migrations/diff.js";
import type { Section } from "../../migrations/provider.js";
import { MigrationError } from "../../migrations/provider.js";
import { OrmError, fail, decodeNormalizedRow, literal, quoteIdentifier as q, historyTableDDL } from "../../shared/index.js";
import type { Adapter, Capabilities, RuntimeAdapter } from "../../core/adapter.js";

/** SQLite datasource: a local file path (or `:memory:`). */
interface SqliteDatasource extends Datasource {
  filename: string;
}

const asSqlite = (ds: Datasource) => {
  return ds as SqliteDatasource;
};

const sqliteTypes: Record<string, string> = {
  int: "INTEGER",
  bigint: "INTEGER",
  boolean: "INTEGER",
  number: "REAL",
  decimal: "NUMERIC",
  text: "TEXT",
  bytes: "BLOB",
};

/**
 * SQLite: 方言翻译的唯一落点。
 *
 * 基类 `BaseDialect` 承担与其它方言一致的标准行为，这里只重写 SQLite 的差异：
 * 归一化解码、ISO 文本 datetime、CAST 取整与 decimal 比较、JSON 谓词与错误码映射，
 * 以及迁移侧的目录查询、清库脚本与影子库语义。
 *
 * SQLite: the single location for dialect translation.
 *
 * `BaseDialect` provides standard behavior shared with other dialects; only SQLite differences
 * are overridden here: normalized decoding, ISO text datetimes, CAST-based integer division and
 * decimal comparison, JSON predicates and error mapping, plus migration catalog queries,
 * database clearing scripts, and scratch database semantics.
 */
/**
 * @internal SQLite 方言实现：内部模块，不属于包公开 API。
 * SQLite dialect implementation: internal module, not part of the package public API.
 */
export class SqliteDialect extends BaseDialect {
  name = "sqlite" as const;
  providerId = "sqlite" as const;
  capabilities: Capabilities = { returning: true, isolationLevels: ["serializable"] };
  unlimited = -1;
  integerDivide = (expr: string) => "CAST(" + expr + " AS INTEGER)";
  decimalComparisonOperand = (operand: string) => "CAST(" + operand + " AS NUMERIC)";
  defaultTransactionIsolation = () => "serializable" as const;

  // Decode normalized values and datetimes in decodeNormalizedRow's single column loop instead of three row passes.
  decode = (table: Parameters<BaseDialect["decode"]>[0], row: any) => decodeNormalizedRow(table, row);

  /** Store UTC ISO timestamps in text columns, matching toISOString on writes. */
  protected encodeTextInstant = (instant: Date) => instant.toISOString();

  json = {
    predicate: jsonPredicate((col, path, bind, falsity) => {
      const extract = () => {
        return `json_extract(${col}, ${bind(jsonPath(path))})`;
      };
      const type = () => {
        return `json_type(${col}, ${bind(jsonPath(path))})`;
      };
      return {
        type,
        text: extract,
        number: extract,
        types: { string: "'text'", number: "'integer','real'" },
        falsity,
        equals: (v: any, guard: any) => {
          if (v === null || typeof v === "boolean") {
            return `COALESCE(${type()} = '${v}', ${falsity})`;
          }
          return guard(typeof v === "string" ? "string" : "number", () => {
            return `${extract()} = ${bind(v)}`;
          });
        },
      };
    }),
  };

  // ─── 迁移侧的翻译 ────────────────────────────────────────────────────────
  now = () => "strftime('%Y-%m-%d %H:%M:%f','now')";
  describe = (ds: Datasource) => `SQLite database "${asSqlite(ds).filename}"`;
  indexKey = (item: DbIndex) => item.definition.replace(/\s+/g, " ");
  columnChanges = (a: DbColumn, b: DbColumn) => columnChanges(a, b, false);
  historyDDL = (table: string) => historyTableDDL(table, q, { id: "TEXT", time: "DATETIME", now: "current_timestamp" });
  acquireLock = async () => {};
  releaseLock = async () => {};

  parseDatasource = (url: string, root: string): SqliteDatasource => {
    // Only `file:` URLs are supported: `file:./dev.db` and `file::memory:`.
    if (!url.startsWith("file:") || url.startsWith("file://")) {
      throw new MigrationError("INVALID_URL", "SQLite urls use the form file:./dev.db");
    }
    const path = url.slice(5);
    if (path.includes("?")) {
      throw new MigrationError("INVALID_URL", "SQLite url does not support query parameters");
    }
    if (!path) {
      throw new MigrationError("INVALID_URL", "SQLite url needs a file path");
    }
    return { filename: path === ":memory:" ? path : resolve(root, path) };
  };

  /** Open a SQLite connection; load the driver only when connecting. */
  openConnection = async (ds: SqliteDatasource): Promise<Connection> => {
    const { DatabaseSync } = await import("node:sqlite");
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
  };

  connectMigration = async (ds: Datasource): Promise<Connection> => this.openConnection(asSqlite(ds));

  connectOrCreate = async (ds: Datasource): Promise<{ conn: Connection; created: boolean }> => {
    const source = asSqlite(ds);
    const created = source.filename !== ":memory:" && !existsSync(source.filename);
    if (created) {
      mkdirSync(dirname(source.filename), { recursive: true });
    }
    return { conn: await this.openConnection(source), created };
  };

  databaseExists = async (ds: Datasource): Promise<boolean> => {
    const filename = asSqlite(ds).filename;
    return filename === ":memory:" || existsSync(filename);
  };

  clearDatabase = async (conn: Connection): Promise<void> => {
    const keep = conn.datasource.ignore;
    const objects = await conn.query("SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','view','trigger')");
    await conn.script(
      "PRAGMA foreign_keys=OFF;" +
        objects
          .filter((o) => {
            return o.type !== "trigger" && !keep?.(o.name);
          })
          .map((o) => {
            return `DROP ${o.type === "view" ? "VIEW" : "TABLE"} IF EXISTS ${q(o.name)};`;
          })
          .join("") +
        "PRAGMA foreign_keys=ON;",
    );
    const left: { name: string }[] = await conn.query("SELECT name FROM sqlite_sequence").catch(() => {
      return [];
    });
    const stale = left
      .map((row) => {
        return row.name;
      })
      .filter((name) => {
        return !keep?.(name);
      });
    if (stale.length) {
      await conn.query(
        `DELETE FROM sqlite_sequence WHERE name IN (${stale
          .map(() => {
            return "?";
          })
          .join(",")})`,
        stale,
      );
    }
  };

  createScratch = async (): Promise<Scratch> => {
    return scratchDatabase(() => {
      return this.openConnection({ filename: ":memory:" });
    });
  };

  historyExists = async (conn: Connection): Promise<boolean> => {
    const rows = await conn.query("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?", [historyTable(conn)]);
    return rows.length > 0;
  };

  runScriptAtomically = async (conn: Connection, sql: string): Promise<void> => {
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
  };

  introspect = async (conn: Connection): Promise<DbModel> => {
    const ignore = conn.datasource.ignore;
    const rows = (await conn.query("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != ? ORDER BY name", [historyTable(conn)])).filter((row) => {
      return !ignore?.(row.name);
    });
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
      const info = await conn.query(`PRAGMA table_info(${q(row.name)})`);
      const auto = /\bAUTOINCREMENT\b/i.test(sql);
      const columns: DbColumn[] = info.map((c) => {
        return {
          name: c.name,
          type: String(c.type).toUpperCase(),
          nullable: !c.notnull && !c.pk,
          default: c.dflt_value ?? null,
          auto: auto && c.pk > 0,
          definition: columnText.get(c.name) ?? `${q(c.name)} ${c.type}`,
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
      for (const index of await conn.query(`PRAGMA index_list(${q(row.name)})`)) {
        if (index.origin === "pk") {
          continue;
        }
        const indexColumns = (await conn.query(`PRAGMA index_info(${q(index.name)})`))
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
      for (const fk of await conn.query(`PRAGMA foreign_key_list(${q(row.name)})`)) {
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
  };

  /** Column type text; was the module-level `sqliteType`. */
  private sqlType = (c: Column): string => {
    if (c.type === "datetime" && c.dateStorage === "timestamp") {
      return "INTEGER";
    }
    return sqliteTypes[c.type] ?? "TEXT";
  };

  /** DDL generation: verbatim table + junction SQL, now owned by this class. */
  schemaDDL = (schema: Schema): string[] => {
    const statements: string[] = [];
    for (const t of Object.values(schema.tables)) {
      const col = (key: string) => {
        return q(internalColumnName(t.columns[key]));
      };
      const definitions = Object.values(t.columns).map((c) => {
        const name = q(internalColumnName(c));
        let sql = `${name} ${this.sqlType(c)}`;
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
          sql += ` CHECK (${name} IN (${c.enum.map(literal).join(",")}))`;
        }
        if (c.type === "boolean") {
          sql += ` CHECK (${name} IN (0,1))`;
        }
        if (c.default !== undefined) {
          const d = c.default;
          if (d && typeof d === "object") {
            if (d.fn === "now") {
              // Store UTC ISO timestamps in text columns, matching toISOString on writes.
              sql += c.dateStorage === "timestamp" ? " DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))" : " DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
            }
          } else {
            sql += " DEFAULT " + literal(d);
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
            `FOREIGN KEY (${col(r.source)}) REFERENCES ${q(internalTableName(target))} (${q(internalColumnName(target.columns[r.foreign]))}) ON DELETE ${referentialActions[r.onDelete ?? "Restrict"]}${r.onUpdate ? " ON UPDATE " + referentialActions[r.onUpdate] : ""}`,
          );
        }
      }
      for (const keys of t.unique) {
        definitions.push(`UNIQUE (${keys.map(col).join(",")})`);
      }
      statements.push(`CREATE TABLE ${q(internalTableName(t))} (${definitions.join(", ")});`);
      for (const keys of t.indexes) {
        statements.push(`CREATE INDEX ${q(`${internalObjectName(t)}_${keys.join("_")}_idx`)} ON ${q(internalTableName(t))} (${keys.map(col).join(",")});`);
      }
      // Decouple relationship-column indexes from foreign keys: index morph and regular foreign-key columns, naming only the relationship column.
      for (const r of Object.values(t.relations)) {
        if (r.owner && !r.many && !t.columns[r.source].unique) {
          statements.push(`CREATE INDEX ${q(`${internalObjectName(t)}_${r.source}_rel_idx`)} ON ${q(internalTableName(t))} (${col(r.source)});`);
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
            `CREATE TABLE ${q(r.junction)} ("sourceId" ${this.sqlType(source)} NOT NULL REFERENCES ${q(internalTableName(t))} (${q(internalColumnName(source))}) ON DELETE CASCADE, "targetId" ${this.sqlType(foreign)} NOT NULL REFERENCES ${q(internalTableName(target))} (${q(internalColumnName(foreign))}) ON DELETE CASCADE, PRIMARY KEY ("sourceId", "targetId"));`,
          );
          statements.push(`CREATE INDEX ${q(r.junction + "_rel_idx")} ON ${q(r.junction)} ("targetId");`);
        }
      }
    }
    return statements;
  };

  /** renderDiff SQL rendering: verbatim, including the unconditional RedefineTables push. */
  renderDiffSQL = (created: DbTable[], dropped: DbTable[], changed: TableChange[]): Section[] => {
    const sections: Section[] = [];
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
    pushSection(
      sections,
      "DropIndex",
      simple.flatMap((c) => {
        return c.droppedIndexes.map((i) => {
          return `DROP INDEX ${q(i.name)};`;
        });
      }),
    );
    for (const c of simple) {
      pushSection(
        sections,
        "AlterTable",
        c.addedColumns.map((col) => {
          return `ALTER TABLE ${q(c.name)} ADD COLUMN ${col.definition};`;
        }),
      );
    }
    if (dropped.length) {
      pushSection(sections, "DropTable", [
        "PRAGMA foreign_keys=off;",
        ...dropped.map((t) => {
          return `DROP TABLE ${q(t.name)};`;
        }),
        "PRAGMA foreign_keys=on;",
      ]);
    }
    for (const t of created) {
      pushSection(sections, "CreateTable", [t.definition + ";"]);
    }
    if (redefined.length) {
      const statements = ["PRAGMA defer_foreign_keys=ON;", "PRAGMA foreign_keys=OFF;"];
      for (const c of redefined) {
        const temp = "new_" + c.name;
        statements.push(c.to.definition.replace(/^CREATE TABLE\s+("(?:[^"]|"")*"|\S+)/i, `CREATE TABLE ${q(temp)}`) + ";");
        const common = c.to.columns.filter((col) => {
          return c.from.columns.some((x) => {
            return x.name === col.name;
          });
        });
        if (common.length) {
          const names = common
            .map((col) => {
              return q(col.name);
            })
            .join(", ");
          statements.push(`INSERT INTO ${q(temp)} (${names}) SELECT ${names} FROM ${q(c.name)};`);
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
        statements.push(`DROP TABLE ${q(c.name)};`, `ALTER TABLE ${q(temp)} RENAME TO ${q(c.name)};`);
        for (const i of c.to.indexes) {
          statements.push(i.definition + ";");
        }
      }
      statements.push("PRAGMA foreign_keys=ON;", "PRAGMA defer_foreign_keys=OFF;");
      // Historical QA requirement: this push is unconditional; do not replace it with conditional pushSection.
      sections.push(["RedefineTables", statements]);
    }
    pushSection(sections, "CreateIndex", [
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
  };

  /** Driver error → OrmError mapping; shared by the adapter and the runtime. */
  translate = (error: any): Error => {
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
export const sqliteDialect = new SqliteDialect();

/**
 * 迁移提供者：core 的标准迁移管线 + 本方言的翻译。
 * Migration provider: core's standard migration pipeline plus this dialect's translation.
 */
/**
 * @internal 迁移提供者：内部模块，不属于包公开 API。
 * Migration provider: internal module, not part of the package public API.
 */
export const sqliteProvider: MigrationProvider = createProvider(sqliteDialect);

export interface SQLiteOptions {
  connection?: string;
}

/**
 * 为解析后的 schema 生成 SQLite DDL。
 * Emit SQLite DDL for a parsed schema.
 */
export function sqliteSchemaSQL(schema: Schema): string[] {
  return sqliteDialect.schemaDDL(schema);
}

export function sqlite(options: SQLiteOptions = {}): Adapter {
  return createAdapter(sqliteDialect, () => connectSQLite(options));
}

/** SQLite keeps one synchronous connection, so pool sizing is rejected instead of silently ignored. */
async function connectSQLite(options: SQLiteOptions): Promise<RuntimeAdapter> {
  if (Object.hasOwn(options, "filename")) {
    fail("Use a file: connection URL");
  }
  if (Object.hasOwn(options, "pool")) {
    fail("SQLite uses a single connection; pool options are not supported");
  }
  const source = options.connection ?? "file::memory:";
  const connection = typeof source === "string" ? source : source;
  if (typeof connection !== "string" || !connection.startsWith("file:") || !connection.slice(5)) {
    fail("SQLite connection requires a file: URL string");
  }
  if (connection.includes("?")) {
    fail("SQLite connection URL does not support query parameters");
  }
  // Load the driver only on first use, so creating a client does not import node:sqlite.
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(connection.slice(5));
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  // Parameterized SQL text is reusable; preparing costs more than execution, so caching avoids repeated parsing.
  return createSingleRuntime(sqliteDialect, db, "SQLite connection is unusable");
}
