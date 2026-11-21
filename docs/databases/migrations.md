---
description: Manage database schema with migrate, deploy, resolve, diff, and push.
---

# Versioned Migrations

Supports SQLite, MySQL / MariaDB, and PostgreSQL; migrations are plain SQL files. Development detects hand-edited databases, and a failed migration blocks later deploys. Flags: [CLI Options](../reference/cli/options.md).

## Quick Start

No configuration needed; defaults are `schema.orm` and the SQLite database `dev.db`:

```bash
tsorm migrate          # Development: generate and apply a migration
tsorm deploy           # Release: apply pending migrations
```

## Defaults

`schema.orm`, `file:./dev.db`, and a `migrations/` directory beside the schema file. Override with `DATABASE_URL` and `--schema`; see [Options & Behavior](../reference/cli/options.md).

## migrate

```bash
tsorm migrate
```

In order: creates the database if missing; checks for [drift](#drift-and-reset) or failed/modified migrations, asking to confirm a reset; applies pending migrations; then diffs models against history and applies the new `migrations/<timestamp>_<name>.sql` (prints `Already in sync` when nothing changed). `--create-only` generates the file without applying it, but still handles drift/reset and applies existing pending migrations; risks are evaluated and printed without blocking creation or prompting. Use `diff` to generate SQL without modifying the business database.

::: danger Development databases only
`migrate` may clear the database. Use `deploy` in production.
:::

### Changes Requiring Confirmation

| Type         | Example                                                                                                                                    | Handling                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Data loss    | Dropping a non-empty table or a populated column, changing the type of a populated column, adding a unique constraint to a table with data | Confirm in the terminal; non-interactive environments need `--force` |
| Unexecutable | Adding a required column without a default to a non-empty table, making a column that holds `NULL` required                                | Raises `UNEXECUTABLE_MIGRATION`                                      |

Rename columns, backfill data, or make other manual edits by generating a file first (a field rename generates drop + add — edit it into a rename to keep the data):

```bash
tsorm migrate --name rename_column --create-only
# Edit migrations/<timestamp>_rename_column.sql
tsorm migrate
```

## deploy

```bash
tsorm deploy --check   # Read-only status check
tsorm deploy           # Apply pending migrations
```

Applies pending migrations in timestamp order without prompting. Creates the database if missing; raises `DATABASE_NOT_EMPTY` without a [baseline](#adopting-an-existing-database), `FAILED_MIGRATIONS` when one failed (handle with `resolve` first), and warns when an applied file was modified. `--check` is read-only: exit 0 when up to date, 1 otherwise — good as a CI pre-deploy check.

## resolve

Repairs history after a failed migration; it never executes migration SQL. Repair the database's actual state first:

| Actual state                                                     | Next step                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Failure was rolled back, or partial changes were manually undone | `tsorm resolve --rolled-back <name>`, then fix the SQL and run `deploy`  |
| All migration changes were completed manually                    | `tsorm resolve --applied <name>`                                         |
| Existing structure matches an initial migration                  | Register the [baseline](#adopting-an-existing-database) with `--applied` |

`--rolled-back` does not undo DDL; `--applied` does not verify that the schema matches the SQL.

| Database        | Failure boundary                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite          | The executor wraps each migration in a transaction and checks foreign keys before commit; leave transaction control to the executor.      |
| PostgreSQL      | A script is sent as one multi-statement query, using an implicit transaction unless the script introduces its own transaction boundaries. |
| MySQL / MariaDB | DDL commits implicitly. Changes made before a failure may remain; inspect and complete or undo them manually.                             |

No snapshots are restored — keep backups and review hand-written SQL before deployment.

## diff

Does not modify the business database; normally uses a [shadow database](#shadow-database). Default output is "migration history → models", i.e. what the next `migrate` would generate:

```bash
tsorm diff                          # Migration history → models
tsorm diff --from database          # Database → models
tsorm diff --from empty > init.sql  # Full table-creation SQL
tsorm diff --check                  # Print only a summary, return 2 on differences
```

`--from empty --to schema` runs offline; other source combinations may use a shadow database — sources are listed in [CLI Options](../reference/cli/options.md). `tsorm diff --check` catches a forgotten migration in CI.

## push

```bash
tsorm push
```

No migration file; syncs the database directly to the models — for prototyping only. `--force` accepts data-loss risks, `--reset` clears data first. For persistent data, use a baseline with `migrate` / `deploy`.

## Drift and Reset

Drift means the dev database diverges from migration history, e.g. a hand-created table. `migrate` lists the differences and confirms before resetting:

```text
Drift detected: Your database schema is not in sync with your migration history.

[+] Added tables
  - manual
```

Deliberate reset: `tsorm migrate --reset` drops all tables and data, re-applies every migration, then checks model changes as usual.

## Ignored Tables

For tables declared with `ignore` (see [Ignoring Tables](../schema/overview.md#ignoring-tables)): drift detection, `diff` and `push` never generate statements that drop them; `--reset` drops only this schema's tables and views (PostgreSQL drops them one by one with `DROP ... CASCADE`); `deploy` does not count them when checking emptiness.

## Adopting an Existing Database

Confirm `tsorm diff --from database --check` exits 0, resolve differences, then register a baseline:

```bash
mkdir -p migrations
tsorm diff --from empty > migrations/00000000000000_init.sql
tsorm resolve --applied 00000000000000_init
tsorm deploy
```

`resolve --applied` registers without executing the migration SQL; review the baseline first and use the same database configuration for both steps.

## Migration Files

```text
schema.orm
migrations/
├── 20261103020000_init.sql
├── 20261103030000_update.sql
└── migration_lock.toml
```

File names are `<timestamp>_<name>.sql`: UTC generation time in `YYYYMMDDHHMMSS`, executed ascending; other characters in the name become `_`. The migration name is the file name without `.sql` (the name `resolve` uses). Not-yet-applied files can be edited by hand; invalid names raise `INVALID_MIGRATION_FILE`. Timestamp conflicts are never fixed automatically; the tool raises `MIGRATION_TIMESTAMP_CONFLICT`:

| Situation                                                                | Cause                                                                                          | Handling                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Two files share a timestamp                                              | Multiple people generated in the same second, or a duplicate manual name                       | Change one file's timestamp                    |
| A new migration's timestamp is not greater than the latest existing file | Consecutive generation within a second, system clock skew, a manually written future timestamp | Retry later, or check the clock and file names |

`migration_lock.toml` records the database type; switching raises `PROVIDER_MISMATCH`. Commit the whole directory to version control. Migration records live in the database's `_tsorm_migrations` table (`<prefix>_tsorm_migrations` with a [table prefix](../schema/overview.md#table-prefix)):

| Column                      | Description                                                  |
| --------------------------- | ------------------------------------------------------------ |
| `migration_name`            | Migration name, the file name without `.sql`                 |
| `checksum`                  | SHA-256 of the migration file, to detect modified migrations |
| `started_at`, `finished_at` | Start and finish times; `finished_at` is `NULL` on failure   |
| `rolled_back_at`            | Time marked by `resolve --rolled-back`                       |
| `logs`                      | Error message on failure                                     |

## Shadow Database

Cleared on every use and must be dedicated to migrations: MySQL / MariaDB need a different database name, PostgreSQL a different name or schema — matching namespaces are rejected even across hosts, so credentials or URL aliases don't count. `migrate` and most `diff` sources need one; on MySQL and PostgreSQL `push` does too.

| Database   | Default behavior                                                         | Permission required                 |
| ---------- | ------------------------------------------------------------------------ | ----------------------------------- |
| SQLite     | Uses an in-memory database                                               | None                                |
| PostgreSQL | Creates `tsorm_shadow_db_<random>` on the same server, dropped after use | `CREATEDB` or superuser             |
| MySQL      | Same as above                                                            | Create and drop database privileges |

Without create-database permission, set `SHADOW_DATABASE_URL` to a dedicated empty database; it is cleared before each use, so never point it at real data.

## Design Notes

- **Target schema**: the models' DDL runs against the shadow database and the schema is read back, so comparisons are normalized by the database itself.
- **SQLite transactions**: each migration runs in a transaction; scripts must not use `BEGIN`/`COMMIT`. Table rebuilds preserve the `AUTOINCREMENT` high-water mark.

## Programmatic API

See [Calling from Code](../reference/cli/programmatic.md) for function counterparts, options, and deployment checks.

## Next Steps

- [CLI](../reference/cli/overview.md#commands): every migration command and its flags
- [Command Examples](../reference/cli/commands.md): common invocations for each command
- [Capability Matrix](./overview.md): the database differences that affect migrations
