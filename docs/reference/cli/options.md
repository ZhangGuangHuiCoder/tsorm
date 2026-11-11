---
description: Every tsorm CLI option, environment variable, exit code, and confirmation behavior, explained one by one.
---

# Options & Behavior

Each command accepts the options listed in the [Commands](./overview.md#commands) table. Every option is explained below.

## Options

| Option                 | Commands          | Values / default                      | Description                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--schema <file>`      | all               | `schema.orm`                          | Schema file. The migrations directory is fixed at `migrations/` beside it; paths are relative to the current directory.                                                                                                                                                                                                                                             |
| `--name <name>`        | `migrate`         | `init` or `update`                    | Migration slug. Non-alphanumeric characters become `_`, and it is prefixed with the UTC timestamp `YYYYMMDDHHMMSS_`. Defaults to `init` for the first migration and `update` afterwards.                                                                                                                                                                            |
| `--create-only`        | `migrate`         | Off                                   | Generate a new migration without applying that new file; also skips its unexecutable-change and risk checks. Earlier drift/reset handling and existing pending migrations still run. Can create an empty migration. Use `diff` to avoid target database writes.                                                                                                     |
| `--reset`              | `migrate`, `push` | Off                                   | Drop all data and rebuild from an empty database before applying or syncing. Asks for confirmation unless `--force` is set.                                                                                                                                                                                                                                         |
| `--force`              | `migrate`, `push` | Off                                   | Skip confirmations and accept data loss.                                                                                                                                                                                                                                                                                                                            |
| `--check`              | `deploy`          | Off                                   | Read-only check. Exits `0` when the database is up to date and `1` otherwise: the database is missing, or there are pending or failed migrations, or a migration in the database is missing locally.                                                                                                                                                                |
| `--check`              | `diff`            | Off                                   | Print only the summary. Exits `0` when there are no differences and `2` when there are.                                                                                                                                                                                                                                                                             |
| `--applied <name>`     | `resolve`         | —                                     | Record a local migration as applied after manual completion or for an existing-database baseline. Does not execute the migration SQL or verify actual structure. The name excludes `.sql`; choose exactly one of `--applied` and `--rolled-back`.                                                                                                                   |
| `--rolled-back <name>` | `resolve`         | —                                     | Mark an existing failed migration as rolled back so `deploy` can retry it. First undo any partial changes; this flag only updates history and does not roll back DDL. The name excludes `.sql`.                                                                                                                                                                     |
| `--from <source>`      | `diff`            | `migrations` \| `database` \| `empty` | The source to compare from. Defaults to `migrations`.                                                                                                                                                                                                                                                                                                               |
| `--to <source>`        | `diff`            | `schema` \| `database`                | The source to compare to. Defaults to `schema`.                                                                                                                                                                                                                                                                                                                     |
| `--out <file>`         | `generate`        | `generated/client.ts`                 | Output path for the generated client.                                                                                                                                                                                                                                                                                                                               |
| `--help`, `-h`         | all               | —                                     | Show usage; after a command (for example `tsorm migrate --help`), show that command's usage and options. The help text follows the system language: Chinese when `LC_ALL`, `LC_MESSAGES`, or `LANG` starts with `zh`; when they are unset or `C`/`POSIX`, it falls back to the operating system's UI language. All other output and error codes are always English. |

Unknown options raise an error immediately.

Boolean flags (`--create-only`, `--reset`, `--force`, `--check`) only accept their bare form; assigned forms such as `--force=false` and `--reset=false` are rejected. Omit the flag to leave it disabled.

## Environment Variables

| Variable                        | Default         | Description                                                                                                                                                                                                                                                         |
| ------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | `file:./dev.db` | Database connection; `file:`, `postgresql://`, or `mysql://`                                                                                                                                                                                                        |
| `SHADOW_DATABASE_URL`           | None            | A dedicated shadow database, for when you lack create-database permission                                                                                                                                                                                           |
| `CI`                            | None            | When set, nothing is asked; steps needing confirmation must add `--force`                                                                                                                                                                                           |
| `LC_ALL`, `LC_MESSAGES`, `LANG` | None            | System language, checked in this order; when it starts with `zh` the help text is Chinese, and when unset or `C`/`POSIX`, it falls back to the operating system's UI language (Linux has no desktop language setting and stays English). Other output is unaffected |

## Exit Codes

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| `0`  | Success                                                                         |
| `1`  | Error; also returned when `deploy --check` finds the database is not up to date |
| `2`  | `diff --check` found differences                                                |

## Interactivity

Reset and data-loss confirmations are prompted only in an interactive terminal. In non-interactive environments (stdin or stdout is not a terminal, or `CI` is set), steps needing confirmation raise `NON_INTERACTIVE`, and `--force` skips the confirmation.

## Next Steps

- [Command Examples](./commands.md): common invocations for each command
- [Error Codes](../errors.md): the errors every command can report
