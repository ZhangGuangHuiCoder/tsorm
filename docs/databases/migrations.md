---
description: Manage database schema with migrate, deploy, resolve, diff, and push.
---

# Versioned Migrations

The migration tool supports SQLite, MySQL / MariaDB, and PostgreSQL. Migrations are plain SQL files; during development it detects whether the database was changed by hand, and a failed migration blocks later deploys.

| Command   | Purpose                                    | When to use          |
| --------- | ------------------------------------------ | -------------------- |
| `migrate` | Generate and apply migrations from models  | Development, after editing models |
| `deploy`  | Apply pending migrations                   | Release, CI          |
| `resolve` | Handle a failed migration                  | After a production migration fails |
| `diff`    | Emit SQL between two schemas               | Review, establish a baseline |
| `push`    | Sync the schema directly, without migrations | Prototyping        |

## Quick Start

No configuration is needed; by default it uses `schema.orm` in the current directory and the SQLite database `dev.db`:

```bash
tsorm migrate          # Development: generate and apply a migration
tsorm deploy           # Release: apply pending migrations
```

## Defaults

| Item           | Default                        | How to change                  |
| -------------- | ------------------------------ | ------------------------------ |
| Database       | `file:./dev.db` (SQLite)       | Environment variable `DATABASE_URL` |
| Schema file    | `schema.orm`                   | `--schema <file>`              |
| Migrations dir | `migrations/` beside the schema file | Follows the schema file location |
| Migration name | `init` for the first, then `update` | `--name <name>`           |
| Shadow DB      | Creates a temporary database automatically | Environment variable `SHADOW_DATABASE_URL` |

The database type is inferred from the URL:

| Database   | `DATABASE_URL` example                                |
| ---------- | ----------------------------------------------------- |
| SQLite     | `file:./dev.db`, path relative to the current directory |
| PostgreSQL | `postgresql://user:password@host:5432/db?schema=public`, `schema` defaults to `public` |
| MySQL      | `mysql://user:password@host:3306/db`, query parameters become `mariadb` connection options |

## migrate

After editing `schema.orm`, run:

```bash
tsorm migrate
```

It does the following in order:

1. Creates the database if it does not exist.
2. Checks whether the dev database was changed by hand ([drift](#drift-and-reset)), or a migration failed or was modified. If so, it asks to confirm before resetting the dev database.
3. Applies migrations not yet run.
4. Compares the migration history with the models, generates `migrations/<timestamp>_<name>.sql`, and applies it.

When the models have not changed, it prints `Already in sync` and generates no file.

| Argument        | Description                                          |
| --------------- | ---------------------------------------------------- |
| `--name <name>` | Migration name                                       |
| `--create-only` | Only generate the file without running it, for editing the SQL by hand |
| `--reset`       | Clear the database first, then re-apply all migrations |
| `--force`       | Skip all confirmations, accepting data loss          |

::: danger Development databases only
`migrate` may clear the database. Use `deploy` in production.
:::

### Changes Requiring Confirmation

| Type         | Example                                                      | Handling                             |
| ------------ | ------------------------------------------------------------ | ------------------------------------ |
| Data loss    | Dropping a non-empty table or a populated column, changing the type of a populated column, adding a unique constraint to a table with data | Confirm in the terminal; non-interactive environments need `--force` |
| Unexecutable | Adding a required column without a default to a non-empty table, making a column that holds `NULL` required | Raises `UNEXECUTABLE_MIGRATION`      |

Unexecutable changes, and changes that cannot be inferred automatically such as renaming a column or backfilling data, are done by editing the SQL by hand:

```bash
tsorm migrate --name rename_column --create-only
# Edit migrations/<timestamp>_rename_column.sql
tsorm migrate
```

Renaming a field generates SQL that drops the old column and adds a new one; to keep the data, edit it into a rename with the steps above.

## deploy

```bash
tsorm deploy --check   # Only check, do not run
tsorm deploy           # Apply pending migrations
```

`deploy` applies pending migrations in timestamp order without prompting, so it fits release pipelines.

- Creates the database automatically if it does not exist.
- When the database already has tables but no migration history, raises `DATABASE_NOT_EMPTY`; establish a [baseline](#adopting-an-existing-database) first.
- When a migration failed, raises `FAILED_MIGRATIONS`; handle it with `resolve` first.
- When an applied migration file was modified, it only prints a warning.

`--check` makes no changes. It returns 0 when the database is up to date and 1 otherwise: the database does not exist, there are pending or failed migrations, or a migration in the database is missing locally. Good as a pre-deploy check in CI.

## resolve

After a migration fails, later deploys are blocked. `resolve` only changes migration records; it runs no SQL:

| Situation                          | Command                                  |
| ---------------------------------- | ---------------------------------------- |
| The migration did not take effect; fix the SQL and retry | `tsorm resolve --rolled-back <name>`, then `deploy` |
| The remaining steps were applied by hand | `tsorm resolve --applied <name>`   |

| Database   | On migration failure                                          |
| ---------- | ------------------------------------------------------------- |
| SQLite     | The whole migration runs in a transaction, foreign keys checked before commit, fully rolled back on failure |
| PostgreSQL | The whole script runs as one multi-statement query, fully rolled back on failure |
| MySQL      | DDL cannot roll back; statements run before the failure remain, inspect manually then `resolve` |

## diff

`diff` changes no database. By default it outputs the SQL from "migration history → models", i.e. what the next `migrate` would generate:

```bash
tsorm diff                          # Migration history → models
tsorm diff --from database          # Database → models
tsorm diff --from empty > init.sql  # Full table-creation SQL
tsorm diff --check                  # Print only a summary, return 2 on differences
```

| Argument  | Allowed values                        | Default      |
| --------- | ------------------------------------- | ------------ |
| `--from`  | `migrations`, `database`, `empty`     | `migrations` |
| `--to`    | `schema`, `database`                  | `schema`     |
| `--check` | None                                  | Off          |

`tsorm diff --check` can catch a forgotten migration in CI.

## push

`push` generates no migration file and brings the database in line with the models directly, which suits prototyping:

```bash
tsorm push
```

| Argument  | Description                          |
| --------- | ------------------------------------ |
| `--force` | Accept data loss                     |
| `--reset` | Clear the database first, to handle unexecutable changes |

When the project needs to ship, switch to `migrate` and `deploy`.

## Drift and Reset

Drift means the dev database diverges from the migration history, for example a table created by hand. `migrate` lists the differences and asks to confirm before resetting:

```text
Drift detected: Your database schema is not in sync with your migration history.

[+] Added tables
  - manual
```

To reset deliberately, use `tsorm migrate --reset`: it drops all tables and data, re-applies every migration, then checks for model changes as usual.

::: danger AI agent protection
The CLI refuses to run `migrate --reset`, `push --reset`, or `push --force` when it detects it is being driven by an AI coding agent (Claude Code, Gemini CLI, Qwen Code, Cursor, Aider, Replit). The agent must first obtain explicit user consent, then retry with the verbatim consent written into `TSORM_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`.
:::

## Adopting an Existing Database

When an existing database joins migrations for the first time, establish a baseline:

```bash
mkdir -p migrations
tsorm diff --from empty > migrations/00000000000000_init.sql
tsorm resolve --applied 00000000000000_init
tsorm deploy
```

`resolve --applied` only records, never runs. First confirm the models match the existing structure: `tsorm diff --from database --check` should return 0.

## Migration Files

```text
schema.orm
migrations/
├── 20261103020000_init.sql
├── 20261103030000_update.sql
└── migration_lock.toml
```

- File names are `<timestamp>_<name>.sql`, where the timestamp is the UTC generation time in `YYYYMMDDHHMMSS` (14 digits), executed in ascending order. In the name, any character other than letters, digits, and underscore is replaced with `_`.
- A migration's name is the file name without `.sql`; `resolve` uses this name.
- Migration files not yet applied can be edited by hand.
- A `.sql` file in the migrations directory that does not match the naming rule raises `INVALID_MIGRATION_FILE`.

When the timestamps have the following problems, the tool never adjusts them automatically but raises `MIGRATION_TIMESTAMP_CONFLICT` for manual handling:

| Situation | Cause | Handling |
| --------- | ----- | -------- |
| Two files share a timestamp | Multiple people generated in the same second, or a duplicate manual name | Change one file's timestamp |
| A new migration's timestamp is not greater than the latest existing file | Consecutive generation within a second, system clock skew, a manually written future timestamp | Retry later, or check the clock and file names |
- `migration_lock.toml` records the database type; switching to a different type raises `PROVIDER_MISMATCH`.
- The whole directory should be committed to version control.

Migration records are stored in the database's `_tsorm_migrations` table:

| Column                | Description                                      |
| --------------------- | ------------------------------------------------ |
| `migration_name`      | Migration name, the file name without `.sql`     |
| `checksum`            | SHA-256 of the migration file, to detect modified migrations |
| `started_at`, `finished_at` | Start and finish times; `finished_at` is `NULL` on failure |
| `rolled_back_at`      | Time marked by `resolve --rolled-back`           |
| `logs`                | Error message on failure                         |

## Shadow Database

`migrate` and `diff` need a temporary database to replay migrations and compute the target schema; on MySQL and PostgreSQL `push` needs one too.

| Database   | Default behavior                                     | Permission required       |
| ---------- | ---------------------------------------------------- | ------------------------- |
| SQLite     | Uses an in-memory database                           | None                      |
| PostgreSQL | Creates `tsorm_shadow_db_<random>` on the same server, dropped after use | `CREATEDB` or superuser |
| MySQL      | Same as above                                        | Create and drop database privileges |

Without create-database permission, set `SHADOW_DATABASE_URL` to a dedicated empty database. It is cleared before each use, so never point it at real data.

## Design Notes

- **Target schema**: the models' DDL is actually executed against the shadow database, then the schema is read; comparison results are normalized by the database itself, which is stable and reliable. The cost is that MySQL and PostgreSQL need create-database permission or `SHADOW_DATABASE_URL`.
- **SQLite transactions**: each migration runs in a transaction, so a migration script must not use `BEGIN` and `COMMIT` itself. When rebuilding a table, the `AUTOINCREMENT` high-water mark is preserved.

## Programmatic API

```ts
import { deploy, status } from '@ofis/tsorm/migrations';

const options = { url: process.env.DATABASE_URL };
if ((await status(options)).pending.length) await deploy({ ...options, log: console.log });
```

Every command has a function counterpart. See [Calling from Code](../reference/cli.md#calling-from-code) for the full mapping, options, and differences from the CLI.
