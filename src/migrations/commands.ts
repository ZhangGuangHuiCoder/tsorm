import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve as resolvePath } from "node:path";
import { historyTableName, ignoredTable, parseSchema, tableName, type Schema } from "../schema/index.js";
import { providerFor } from "../adapters/providers.js";
import type { Connection, Datasource, MigrationProvider, Scratch } from "./provider.js";
import { diffModels, evaluateRisks, type SchemaDiff } from "./diff.js";
import { MigrationError } from "./errors.js";
import { applyMigration, checkLock, ensureHistory, historyExists, isApplied, isFailed, markApplied, markRolledBack, modified, readHistory, readLocalMigrations, runScript, withLock, writeMigration, type LocalMigration } from "./history.js";
import { hasTables, introspect, type DbModel } from "./introspect.js";

/** Asks the user to confirm a step. Without it, confirmations fail unless `force` is set. */
export interface Prompter {
  confirm(message: string): Promise<boolean>;
}
export interface CommandOptions {
  /** Database url, default `file:./dev.db`. Its scheme selects the migration provider; see the CLI usage for the accepted url forms. */
  url?: string;
  /** Dedicated shadow database; it is emptied whenever it is used. */
  shadowDatabaseUrl?: string;
  /** Schema file, default `schema.orm`. Migrations live in `migrations/` next to it. */
  schema?: string;
  /** Base directory for relative paths, default the working directory. */
  cwd?: string;
  /** Skip confirmations and accept data loss. */
  force?: boolean;
  prompt?: Prompter;
  log?: (message: string) => void;
}
interface Settings {
  root: string;
  schema: string;
  /** The parsed schema file, when it exists; it supplies `prefix` and `ignore`. */
  parsed?: Schema;
  migrations: string;
  provider: MigrationProvider;
  url: string;
  shadowDatabaseUrl?: string;
}
const DEFAULT_URL = "file:./dev.db";
async function settings(options: CommandOptions): Promise<Settings> {
  const root = resolvePath(options.cwd ?? process.cwd());
  const url = options.url || DEFAULT_URL;
  if (url === options.shadowDatabaseUrl) {
    throw new MigrationError("INVALID_URL", "The shadow database url must differ from the database url");
  }
  const schema = resolvePath(root, options.schema ?? "schema.orm");
  return {
    root,
    schema,
    parsed: existsSync(schema) ? readSchema(schema) : undefined,
    migrations: join(dirname(schema), "migrations"),
    provider: await providerFor(url),
    url,
    shadowDatabaseUrl: options.shadowDatabaseUrl || undefined,
  };
}

const EMPTY_MIGRATION = "-- This is an empty migration.";

const provider = (config: Settings): MigrationProvider => {
  return config.provider;
};
/** Parses a url and attaches the schema's history table and ignored tables. */
const withSchema = (config: Settings, url: string): Datasource => {
  const ds = config.provider.parseDatasource(url, config.root);
  const historyTable = historyTableName(config.parsed?.prefix);
  if (!config.parsed?.ignore?.length) {
    return { ...ds, historyTable };
  }
  const ignored = ignoredTable(config.parsed.ignore);
  return {
    ...ds,
    historyTable,
    ignore: (name) => {
      return name !== historyTable && ignored(name);
    },
  };
};
const datasource = (config: Settings): Datasource => {
  return withSchema(config, config.url);
};
const shadowDatasource = (config: Settings) => {
  return config.shadowDatabaseUrl ? withSchema(config, config.shadowDatabaseUrl) : undefined;
};
/** The schema for commands that compare against it; a missing file is an error. */
const requireSchema = (config: Settings): Schema => {
  return config.parsed ?? readSchema(config.schema);
};

/** Connects without creating anything; a missing database is an error. */
async function connectExisting(p: MigrationProvider, ds: Datasource): Promise<Connection> {
  let exists: boolean;
  try {
    exists = await p.databaseExists(ds);
  } catch (error) {
    throw new MigrationError("DATABASE_UNREACHABLE", `Cannot reach the ${p.describe(ds)}`, {
      cause: error,
    });
  }
  if (!exists) {
    throw new MigrationError("DATABASE_NOT_FOUND", `The ${p.describe(ds)} does not exist`);
  }
  return p.connect(ds);
}

async function ask(options: CommandOptions, message: string, reason: string): Promise<void> {
  if (options.force) {
    return;
  }
  const prompt = options.prompt;
  if (!prompt) {
    throw new MigrationError("NON_INTERACTIVE", `${reason}\n\nThis step needs confirmation. Run it in a terminal, or pass --force.`);
  }
  if (!(await prompt.confirm(message))) {
    throw new MigrationError("ABORTED", "Operation cancelled.");
  }
}

function readSchema(path: string): Schema {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    throw new MigrationError("SCHEMA_NOT_FOUND", `Could not read the schema file ${path}`, {
      cause: error,
    });
  }
  return parseSchema(source);
}

/** Materializes a schema in the scratch database and reads back its structure. */
async function targetModel(scratch: Scratch, p: MigrationProvider, schema: Schema): Promise<DbModel> {
  const ddl = p.schemaDDL(schema);
  const conn = await scratch.open();
  for (const statement of ddl) {
    await conn.script(statement);
  }
  return introspect(conn);
}

/** Replays migration scripts in the shadow database; `checkpoint` observes the state after `at` scripts. */
async function replay(scratch: Scratch, migrations: LocalMigration[], checkpoint?: { at: number; observe: (conn: Connection) => Promise<void> }): Promise<Connection> {
  const conn = await scratch.open();
  for (let i = 0; i <= migrations.length; i++) {
    if (checkpoint?.at === i) {
      await checkpoint.observe(conn);
    }
    const m = migrations[i];
    if (!m) {
      break;
    }
    try {
      await runScript(conn, m.sql);
    } catch (error) {
      throw new MigrationError("SHADOW_MIGRATION_FAILED", `Migration \`${m.name}\` failed to apply cleanly to the shadow database.\nError:\n${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }
  return conn;
}

export interface MigrateResult {
  migration?: string;
  applied: string[];
  reset: boolean;
}

/**
 * Development workflow. With `reset`, the database is emptied first and
 * every migration is reapplied.
 */
export async function migrate(options: CommandOptions & { name?: string; createOnly?: boolean; reset?: boolean }): Promise<MigrateResult> {
  const config = await settings(options);
  const { log = () => {} } = options;
  const p = provider(config);
  const schema = requireSchema(config);
  const ds = datasource(config);
  checkLock(config.migrations, p.id);
  const local = readLocalMigrations(config.migrations);
  const { conn, created } = await p.connectOrCreate(ds);
  if (created) {
    log(`${p.describe(ds)} created.`);
  }
  let scratch: Scratch | undefined;
  const result: MigrateResult = { applied: [], reset: false };
  try {
    scratch = await p.createScratch(ds, shadowDatasource(config));
    const workspace = scratch;
    await withLock(conn, async () => {
      if (options.reset) {
        await ask(options, `Are you sure you want to reset the ${p.describe(ds)}? All data will be lost.`, "Pass --force to reset the database without confirmation.");
        await p.clearDatabase(conn);
        result.reset = true;
        log("Database reset successful");
      }
      const rows = await readHistory(conn);
      const reasons: string[] = [];
      for (const row of rows.filter(isFailed)) {
        reasons.push(`The migration \`${row.migration_name}\` failed.`);
      }
      const applied = rows.filter(isApplied);
      for (const row of applied) {
        const m = local.find((x) => {
          return x.name === row.migration_name;
        });
        if (m && modified(row, m)) {
          reasons.push(`The migration \`${row.migration_name}\` was modified after it was applied.`);
        }
      }
      const missing = applied.filter((row) => {
        return !local.some((m) => {
          return m.name === row.migration_name;
        });
      });
      if (missing.length) {
        reasons.push(
          "The following migration(s) are applied to the database but missing from the local migrations directory: " +
            missing
              .map((r) => {
                return r.migration_name;
              })
              .join(", "),
        );
      }
      if (!reasons.length) {
        // Rerun the applied history in the shadow database and compare it with the dev database.
        const history = local.filter((m) => {
          return applied.some((r) => {
            return r.migration_name === m.name;
          });
        });
        const shadow = await replay(workspace, history);
        // Described as changes from the expected schema to what the database actually holds.
        const drift = diffModels(await introspect(shadow), await introspect(conn));
        if (!drift.empty) {
          reasons.push(
            "Drift detected: Your database schema is not in sync with your migration history.\n\n" +
              "The following is a summary of the differences between the expected database schema given your migrations files, and the actual schema of the database.\n\n" +
              drift.summary,
          );
        }
      }
      if (reasons.length) {
        const reason = reasons.join("\n\n");
        await ask(options, `${reason}\n\nWe need to reset the ${p.describe(ds)}.\n\nDo you want to continue? All data will be lost.`, `${reason}\n\nWe need to reset the ${p.describe(ds)}. Run \`tsorm migrate --reset\` to reset it.`);
        await p.clearDatabase(conn);
        result.reset = true;
      }
      await ensureHistory(conn);
      const done = new Set(
        (await readHistory(conn)).filter(isApplied).map((r) => {
          return r.migration_name;
        }),
      );
      for (const m of local.filter((m) => {
        return !done.has(m.name);
      })) {
        log(`Applying migration \`${m.name}\``);
        await applyMigration(conn, m);
        result.applied.push(m.name);
      }
      const from = await introspect(await replay(workspace, local));
      const target = await targetModel(workspace, p, schema);
      const diff = diffModels(from, target);
      if (diff.empty && !options.createOnly) {
        if (!result.applied.length) {
          log("Already in sync, no schema change or pending migration was found.");
        }
        return;
      }
      const risks = await evaluateRisks(conn, diff.risks);
      if (risks.unexecutable.length && !options.createOnly) {
        throw new MigrationError(
          "UNEXECUTABLE_MIGRATION",
          "We found changes that cannot be executed:\n\n" +
            risks.unexecutable
              .map((s) => {
                return `  • ${s}`;
              })
              .join("\n") +
            "\n\nYou can use `tsorm migrate --create-only` to create the migration file, and manually modify it to address the underlying issue(s).",
        );
      }
      if (risks.warnings.length && !options.createOnly) {
        const warning =
          "Warnings for the current datasource:\n\n" +
          risks.warnings
            .map((s) => {
              return `  • ${s}`;
            })
            .join("\n");
        await ask(options, `${warning}\n\nAre you sure you want to create and apply this migration?`, warning);
      } else if (risks.unexecutable.length || risks.warnings.length) {
        log(
          [...risks.warnings, ...risks.unexecutable]
            .map((s) => {
              return `  • ${s}`;
            })
            .join("\n"),
        );
      }
      const name = options.name || (local.length ? "update" : "init");
      const migration = writeMigration(config.migrations, p.id, name, diff.empty ? EMPTY_MIGRATION + "\n" : diff.sql, local);
      result.migration = migration.name;
      const path = relative(process.cwd(), migration.path);
      if (options.createOnly) {
        log(`Migration created at ${path}. Edit it if needed, then run \`tsorm migrate\` to apply it.`);
        return;
      }
      await applyMigration(conn, migration);
      result.applied.push(migration.name);
      log(`The following migration(s) have been created and applied from new schema changes:\n\n${path}\n\nYour database is now in sync with your schema.`);
    });
  } finally {
    try {
      await scratch?.dispose();
    } finally {
      await conn.close();
    }
  }
  return result;
}

/** Applies pending migrations without prompts. */
export async function deploy(options: CommandOptions): Promise<{ applied: string[] }> {
  const config = await settings(options);
  const { log = () => {} } = options;
  const p = provider(config);
  const ds = datasource(config);
  checkLock(config.migrations, p.id);
  const local = readLocalMigrations(config.migrations);
  log(`${local.length} migration${local.length === 1 ? "" : "s"} found in ${relative(process.cwd(), config.migrations) || "."}`);
  const { conn, created } = await p.connectOrCreate(ds);
  if (created) {
    log(`${p.describe(ds)} created.`);
  }
  const applied: string[] = [];
  try {
    await withLock(conn, async () => {
      if (!(await historyExists(conn)) && (await hasTables(conn))) {
        throw new MigrationError("DATABASE_NOT_EMPTY", "The database schema is not empty. Baseline the existing database before running deploy: create an initial migration and mark it applied with `tsorm resolve --applied <name>`.");
      }
      await ensureHistory(conn);
      const rows = await readHistory(conn);
      const failed = rows.filter(isFailed);
      if (failed.length) {
        throw new MigrationError(
          "FAILED_MIGRATIONS",
          "Migrate found failed migrations in the target database, new migrations will not be applied. Resolve them with `tsorm resolve`.\n\n" +
            failed
              .map((r) => {
                return `The \`${r.migration_name}\` migration started at ${r.started_at} failed`;
              })
              .join("\n"),
        );
      }
      const done = rows.filter(isApplied);
      const changed = done.filter((row) => {
        const m = local.find((x) => {
          return x.name === row.migration_name;
        });
        return m && modified(row, m);
      });
      if (changed.length) {
        log(
          "WARNING The following migrations have been modified since they were applied:\n" +
            changed
              .map((r) => {
                return r.migration_name;
              })
              .join("\n"),
        );
      }
      const pending = local.filter((m) => {
        return !done.some((r) => {
          return r.migration_name === m.name;
        });
      });
      if (!pending.length) {
        log("No pending migrations to apply.");
        return;
      }
      for (const m of pending) {
        log(`Applying migration \`${m.name}\``);
        await applyMigration(conn, m);
        applied.push(m.name);
      }
      log(
        "The following migration(s) have been applied:\n\n" +
          applied
            .map((name) => {
              return `  └─ ${name}.sql`;
            })
            .join("\n") +
          "\n\nAll migrations have been successfully applied.",
      );
    });
  } finally {
    await conn.close();
  }
  return { applied };
}

export interface StatusResult {
  /** 0 when the database is up to date, 1 otherwise. */
  exitCode: 0 | 1;
  local: string[];
  applied: string[];
  pending: string[];
  failed: string[];
  missing: string[];
  message: string;
}

/** Compares the migrations directory with the database history. */
export async function status(options: CommandOptions): Promise<StatusResult> {
  const config = await settings(options);
  const p = provider(config);
  const ds = datasource(config);
  checkLock(config.migrations, p.id);
  const local = readLocalMigrations(config.migrations);
  const lines = [`${local.length} migration${local.length === 1 ? "" : "s"} found in ${relative(process.cwd(), config.migrations) || "."}`];
  const conn = await connectExisting(p, ds);
  try {
    const exists = await historyExists(conn);
    const rows = await readHistory(conn);
    const applied = rows.filter(isApplied).map((r) => {
      return r.migration_name;
    });
    const failed = rows.filter(isFailed).map((r) => {
      return r.migration_name;
    });
    const pending = local
      .map((m) => {
        return m.name;
      })
      .filter((n) => {
        return !applied.includes(n) && !failed.includes(n);
      });
    const missing = applied.filter((n) => {
      return !local.some((m) => {
        return m.name === n;
      });
    });
    if (!exists && local.length) {
      lines.push("No migration table found.");
    }
    if (missing.length) {
      const common = local
        .filter((m) => {
          return applied.includes(m.name);
        })
        .at(-1);
      lines.push(
        "Your local migration history and the migrations table from your database are different:",
        common ? `The last common migration is: ${common.name}` : "There is no common migration.",
        "The migrations from the database are not found locally in the migrations directory:\n" + missing.join("\n"),
      );
    }
    if (failed.length) {
      lines.push("Following migration have failed:\n" + failed.join("\n") + "\n\nResolve them with `tsorm resolve --applied <name>` or `--rolled-back <name>`.");
    }
    if (pending.length) {
      lines.push("Following migration have not yet been applied:\n" + pending.join("\n"));
    }
    const ok = !missing.length && !failed.length && !pending.length && (exists || !local.length);
    if (ok) {
      lines.push("Database schema is up to date!");
    }
    return {
      exitCode: ok ? 0 : 1,
      local: local.map((m) => {
        return m.name;
      }),
      applied,
      pending,
      failed,
      missing,
      message: lines.join("\n\n"),
    };
  } finally {
    await conn.close();
  }
}

/** Marks a failed migration as applied or rolled back. */
export async function resolve(options: CommandOptions & { applied?: string; rolledBack?: string }): Promise<void> {
  const config = await settings(options);
  const { log = () => {} } = options;
  if (!!options.applied === !!options.rolledBack) {
    throw new MigrationError("VALIDATION", "Pass exactly one of --applied or --rolled-back");
  }
  const p = provider(config);
  const ds = datasource(config);
  checkLock(config.migrations, p.id);
  const local = readLocalMigrations(config.migrations);
  const conn = await connectExisting(p, ds);
  try {
    await withLock(conn, async () => {
      await ensureHistory(conn);
      const rows = await readHistory(conn);
      if (options.applied) {
        const name = options.applied;
        const m = local.find((x) => {
          return x.name === name;
        });
        if (!m) {
          throw new MigrationError("MIGRATION_NOT_FOUND", `Migration \`${name}\` cannot be found. Use the file name without .sql.`);
        }
        if (
          rows.some((r) => {
            return r.migration_name === name && isApplied(r);
          })
        ) {
          throw new MigrationError("MIGRATION_ALREADY_APPLIED", `Migration \`${name}\` is already recorded as applied in the database.`);
        }
        await markApplied(
          conn,
          m,
          rows.find((r) => {
            return r.migration_name === name && isFailed(r);
          }),
        );
        log(`Migration ${name} marked as applied.`);
        return;
      }
      const name = options.rolledBack!;
      const records = rows.filter((r) => {
        return r.migration_name === name;
      });
      if (!records.length) {
        throw new MigrationError("MIGRATION_NOT_APPLIED", `Migration \`${name}\` cannot be rolled back because it was never applied to the database.`);
      }
      const failed = records.find(isFailed);
      if (!failed) {
        throw new MigrationError("MIGRATION_NOT_FAILED", `Migration \`${name}\` cannot be rolled back because it is not in a failed state.`);
      }
      await markRolledBack(conn, failed);
      log(`Migration ${name} marked as rolled back.`);
    });
  } finally {
    await conn.close();
  }
}

/** What `diff` compares: migration history, the live database, nothing, or the schema file. */
export type DiffSource = "migrations" | "database" | "empty" | "schema";

export interface DiffResult {
  diff: SchemaDiff;
  /** Migration SQL, or `-- This is an empty migration.` when nothing differs. */
  sql: string;
  /** Human-readable summary. */
  summary: string;
}

/** Compares two schema sources, by default the migration history with the schema file. */
export async function diff(options: CommandOptions & { from?: DiffSource; to?: DiffSource }): Promise<DiffResult> {
  const config = await settings(options);
  const p = provider(config);
  const from = options.from ?? "migrations";
  const to = options.to ?? "schema";
  if (from === "empty" && to === "schema") {
    return initialDDL(p, requireSchema(config));
  }
  let scratch: Scratch | undefined;
  const load = async (source: DiffSource): Promise<DbModel> => {
    if (source === "empty") {
      return { provider: p, tables: {} };
    }
    if (source === "database") {
      const conn = await connectExisting(p, datasource(config));
      try {
        return await introspect(conn);
      } finally {
        await conn.close();
      }
    }
    scratch ??= await p.createScratch(datasource(config), shadowDatasource(config));
    if (source === "schema") {
      return targetModel(scratch, p, requireSchema(config));
    }
    checkLock(config.migrations, p.id);
    return introspect(await replay(scratch, readLocalMigrations(config.migrations)));
  };
  try {
    const changes = diffModels(await load(from), await load(to));
    return {
      diff: changes,
      sql: changes.empty ? EMPTY_MIGRATION + "\n" : changes.sql,
      summary: changes.summary + "\n",
    };
  } finally {
    await scratch?.dispose();
  }
}

/** Creation DDL straight from the schema, so `diff --from empty` needs no database. */
function initialDDL(p: MigrationProvider, schema: Schema): DiffResult {
  const statements = p.schemaDDL(schema).map((sql) => {
    return sql.endsWith(";") ? sql : sql + ";";
  });
  const sections: string[] = [];
  let current = "";
  for (const sql of statements) {
    let comment = "AddForeignKey";
    if (sql.startsWith("CREATE TABLE")) {
      comment = "CreateTable";
    } else if (sql.startsWith("CREATE INDEX")) {
      comment = "CreateIndex";
    } else if (sql.startsWith("COMMENT ON")) {
      comment = "Comment";
    }
    const head = sections.length ? "\n" : "";
    sections.push(comment === current ? sql : `${head}-- ${comment}\n${sql}`);
    current = comment;
  }
  const tables = Object.values(schema.tables)
    .map((t) => {
      return tableName(t);
    })
    .concat(
      Object.values(schema.tables).flatMap((t) => {
        return Object.values(t.relations).flatMap((r) => {
          return r.owner && r.junction ? [r.junction] : [];
        });
      }),
    )
    .sort();
  const empty = !tables.length;
  const summary = empty
    ? "No difference detected."
    : "[+] Added tables\n" +
      tables
        .map((name) => {
          return `  - ${name}`;
        })
        .join("\n");
  const sql = sections.join("\n") + "\n";
  return {
    diff: { empty, sql: empty ? "" : sql, summary, risks: [] },
    sql: empty ? EMPTY_MIGRATION + "\n" : sql,
    summary: summary + "\n",
  };
}

/** Syncs the database with the schema without migrations. */
export async function push(options: CommandOptions & { reset?: boolean }): Promise<{ changed: boolean }> {
  const config = await settings(options);
  const { log = () => {} } = options;
  const p = provider(config);
  const schema = requireSchema(config);
  const ds = datasource(config);
  if (options.reset) {
    await p.resetDatabase(ds);
  }
  const { conn, created } = await p.connectOrCreate(ds);
  if (created) {
    log(`${p.describe(ds)} created.`);
  }
  let scratch: Scratch | undefined;
  try {
    scratch = await p.createScratch(ds, shadowDatasource(config));
    const workspace = scratch;
    return await withLock(conn, async () => {
      const target = await targetModel(workspace, p, schema);
      const diff = diffModels(await introspect(conn), target);
      if (diff.empty) {
        log("The database is already in sync with the schema.");
        return { changed: false };
      }
      const risks = await evaluateRisks(conn, diff.risks);
      if (risks.unexecutable.length) {
        throw new MigrationError(
          "UNEXECUTABLE_MIGRATION",
          "We found changes that cannot be executed:\n\n" +
            risks.unexecutable
              .map((s) => {
                return `  • ${s}`;
              })
              .join("\n") +
            "\n\nPass --reset to empty the database before pushing.",
        );
      }
      if (risks.warnings.length && !options.force) {
        throw new MigrationError(
          "DATA_LOSS",
          "There might be data loss when applying the changes:\n\n" +
            risks.warnings
              .map((s) => {
                return `  • ${s}`;
              })
              .join("\n") +
            "\n\nPass --force to accept the data loss.",
        );
      }
      await runScript(conn, diff.sql);
      log("Your database is now in sync with your schema.");
      return { changed: true };
    });
  } finally {
    try {
      await scratch?.dispose();
    } finally {
      await conn.close();
    }
  }
}
