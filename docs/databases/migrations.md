---
description: Manage database schema with migrate, deploy, resolve, diff, and push.
---

# Versioned Migrations

The migration tool supports SQLite, MySQL / MariaDB, and PostgreSQL. Migrations are plain SQL files; during development it detects whether the database was changed by hand, and a failed migration blocks later deploys.

This page covers development, deployment, recovery, and baselining. Look up individual flags in [CLI Options](../reference/cli/options.md).

## Quick Start

No configuration is needed; by default it uses `schema.orm` in the current directory and the SQLite database `dev.db`:

```bash
tsorm migrate          # Development: generate and apply a migration
tsorm deploy           # Release: apply pending migrations
```

## Defaults

The CLI defaults to `schema.orm`, `file:./dev.db`, and a `migrations/` directory beside the schema file. Set `DATABASE_URL` to choose a database and `--schema` to choose the model file. Defaults and connection variables are maintained in [Options & Behavior](../reference/cli/options.md).

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

Without model changes, `migrate` prints `Already in sync` and generates no file, except with `--create-only`, which can create an empty migration.

`--create-only` skips applying the newly generated migration and its unexecutable-change/risk checks. It does **not** skip earlier drift/reset handling or application of existing pending migrations. For SQL generation without changing the target database, use `diff`.

::: danger Development databases only
`migrate` may clear the database. Use `deploy` in production.
:::

### Changes Requiring Confirmation

| Type         | Example                                                                                                                                    | Handling                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Data loss    | Dropping a non-empty table or a populated column, changing the type of a populated column, adding a unique constraint to a table with data | Confirm in the terminal; non-interactive environments need `--force` |
| Unexecutable | Adding a required column without a default to a non-empty table, making a column that holds `NULL` required                                | Raises `UNEXECUTABLE_MIGRATION`                                      |

Edit the migration SQL for column renames, data backfills, and changes requiring manual intervention:

```bash
tsorm migrate --name rename_column --create-only
# Edit migrations/<timestamp>_rename_column.sql
tsorm migrate
```

Renaming a field generates SQL that drops the old column and adds a new one; to keep the data, edit it into a rename with the steps above.

## deploy

```bash
tsorm deploy --check   # Read-only status check
tsorm deploy           # Apply pending migrations
```

`deploy` applies pending migrations in timestamp order without prompting, so it fits release pipelines.

- Creates the database automatically if it does not exist.
- When the database already has tables but no migration history, raises `DATABASE_NOT_EMPTY`; establish a [baseline](#adopting-an-existing-database) first.
- When a migration failed, raises `FAILED_MIGRATIONS`; handle it with `resolve` first.
- When an applied migration file was modified, it only prints a warning.

`--check` performs a read-only check. It returns 0 when the database is up to date and 1 otherwise: the database does not exist, there are pending or failed migrations, or a migration in the database is missing locally. Good as a pre-deploy check in CI.

## resolve

A failed migration blocks later deploys. Inspect the database and repair its actual state before using `resolve`, which updates history without executing the migration file's SQL.

| Actual state                                                     | Next step                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Failure was rolled back, or partial changes were manually undone | `tsorm resolve --rolled-back <name>`, then fix the SQL and run `deploy`  |
| All migration changes were completed manually                    | `tsorm resolve --applied <name>`                                         |
| Existing structure matches an initial migration                  | Register the [baseline](#adopting-an-existing-database) with `--applied` |

`--rolled-back` does not undo DDL, and `--applied` does not check that the schema matches the SQL.

| Database        | Failure boundary                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite          | The executor wraps each migration in a transaction and checks foreign keys before commit; leave transaction control to the executor.      |
| PostgreSQL      | A script is sent as one multi-statement query, using an implicit transaction unless the script introduces its own transaction boundaries. |
| MySQL / MariaDB | DDL commits implicitly. Changes made before a failure may remain; inspect and complete or undo them manually.                             |

The tool does not restore a database snapshot. Keep backups and review hand-written SQL before deployment.

## diff

`diff` does not modify the target business database, but normally uses a [shadow database](#shadow-database). By default it outputs the SQL from "migration history → models", i.e. what the next `migrate` would generate:

```bash
tsorm diff                          # Migration history → models
tsorm diff --from database          # Database → models
tsorm diff --from empty > init.sql  # Full table-creation SQL
tsorm diff --check                  # Print only a summary, return 2 on differences
```

`--from empty --to schema` generates DDL offline without a connection or shadow database. Other source combinations may create, clear, and write a shadow database. Source choices are listed in [CLI Options](../reference/cli/options.md).

`tsorm diff --check` can catch a forgotten migration in CI.

## push

`push` generates no migration file and brings the database in line with the models directly, which suits prototyping:

```bash
tsorm push
```

`--force` accepts data-loss risks; `--reset` clears data before synchronization. For persistent application data, adopt a baseline and use `migrate` / `deploy` instead.

## Drift and Reset

Drift means the dev database diverges from the migration history, for example a table created by hand. `migrate` lists the differences and asks to confirm before resetting:

```text
Drift detected: Your database schema is not in sync with your migration history.

[+] Added tables
  - manual
```

To reset deliberately, use `tsorm migrate --reset`: it drops all tables and data, re-applies every migration, then checks for model changes as usual.

## Adopting an Existing Database

First run `tsorm diff --from database --check` and confirm exit code 0. Resolve any differences before registering a baseline for the existing database:

```bash
mkdir -p migrations
tsorm diff --from empty > migrations/00000000000000_init.sql
tsorm resolve --applied 00000000000000_init
tsorm deploy
```

`resolve --applied` registers the local migration without executing its SQL. Review the baseline file before registration; use the same database configuration for the check and registration.

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

| Situation                                                                | Cause                                                                                          | Handling                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Two files share a timestamp                                              | Multiple people generated in the same second, or a duplicate manual name                       | Change one file's timestamp                    |
| A new migration's timestamp is not greater than the latest existing file | Consecutive generation within a second, system clock skew, a manually written future timestamp | Retry later, or check the clock and file names |

- `migration_lock.toml` records the database type; switching to a different type raises `PROVIDER_MISMATCH`.
- The whole directory should be committed to version control.

Migration records are stored in the database's `_tsorm_migrations` table:

| Column                      | Description                                                  |
| --------------------------- | ------------------------------------------------------------ |
| `migration_name`            | Migration name, the file name without `.sql`                 |
| `checksum`                  | SHA-256 of the migration file, to detect modified migrations |
| `started_at`, `finished_at` | Start and finish times; `finished_at` is `NULL` on failure   |
| `rolled_back_at`            | Time marked by `resolve --rolled-back`                       |
| `logs`                      | Error message on failure                                     |

## Shadow Database

A shadow datasource is cleared whenever it is used and must be dedicated to migrations. MySQL / MariaDB requires a different database name. PostgreSQL requires a different database name or schema. Matching namespaces are conservatively rejected even across different hosts to prevent host-alias bypasses. Different credentials, default-port spelling, or URL scheme aliases do not provide isolation.

`migrate` and most `diff` source combinations need a temporary database to replay migrations and compute the target schema; on MySQL and PostgreSQL `push` needs one too.

| Database   | Default behavior                                                         | Permission required                 |
| ---------- | ------------------------------------------------------------------------ | ----------------------------------- |
| SQLite     | Uses an in-memory database                                               | None                                |
| PostgreSQL | Creates `tsorm_shadow_db_<random>` on the same server, dropped after use | `CREATEDB` or superuser             |
| MySQL      | Same as above                                                            | Create and drop database privileges |

Without create-database permission, set `SHADOW_DATABASE_URL` to a dedicated empty database. It is cleared before each use, so never point it at real data.

## Design Notes

- **Target schema**: the models' DDL is actually executed against the shadow database, then the schema is read; comparison results are normalized by the database itself, which is stable and reliable. The cost is that MySQL and PostgreSQL need create-database permission or `SHADOW_DATABASE_URL`.
- **SQLite transactions**: each migration runs in a transaction, so a migration script must not use `BEGIN` and `COMMIT` itself. When rebuilding a table, the `AUTOINCREMENT` high-water mark is preserved.

## Programmatic API

See [Calling from Code](../reference/cli/programmatic.md) for function counterparts, options, and deployment checks.

## Next Steps

- [CLI](../reference/cli/overview.md#commands): every migration command and its flags
- [Command Examples](../reference/cli/commands.md): common invocations for each command
- [Capability Matrix](./overview.md): the database differences that affect migrations
