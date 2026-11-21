---
description: Every tsorm CLI option, environment variable, exit code, and confirmation behavior.
---

# Options & Behavior

Each command accepts the options listed in the [Commands](./overview.md#commands) table.

## Options

| Option                 | Commands          | Values / default                      | Description                                                                                                                                                                                                                                                                                                |
| ---------------------- | ----------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--schema <file>`      | all               | `schema.orm`                          | Schema file; the migrations directory is fixed at `migrations/` beside it. Paths are relative to the current directory.                                                                                                                                                                                    |
| `--name <name>`        | `migrate`         | `init` or `update`                    | Migration slug; non-alphanumeric characters become `_`, prefixed with the UTC timestamp `YYYYMMDDHHMMSS_`. Defaults to `init` for the first migration, `update` afterwards.                                                                                                                                |
| `--create-only`        | `migrate`         | Off                                   | Generate a new migration without applying it; unexecutable-change/risk findings are reported without blocking or prompting. Earlier drift/reset handling and existing pending migrations still run; can create an empty migration. Use `diff` to avoid target DB writes.                                   |
| `--reset`              | `migrate`, `push` | Off                                   | Drop all data and rebuild from an empty database first. `migrate` asks for confirmation unless `--force` is set; `push` does not prompt.                                                                                                                                                                   |
| `--force`              | `migrate`, `push` | Off                                   | Skip confirmations and accept data loss.                                                                                                                                                                                                                                                                   |
| `--check`              | `deploy`          | Off                                   | Read-only check. Exits `0` when up to date and `1` otherwise: database missing, pending or failed migrations, or a database migration missing locally.                                                                                                                                                     |
| `--check`              | `diff`            | Off                                   | Print only the summary. Exits `0` when there are no differences and `2` when there are.                                                                                                                                                                                                                    |
| `--applied <name>`     | `resolve`         | —                                     | Record a local migration as applied after manual completion or for a baseline. Does not execute SQL or verify structure. The name excludes `.sql`; choose exactly one of `--applied` and `--rolled-back`.                                                                                                  |
| `--rolled-back <name>` | `resolve`         | —                                     | Mark an existing failed migration as rolled back so `deploy` can retry. Undo partial changes first; this only updates history, it does not roll back DDL. The name excludes `.sql`.                                                                                                                        |
| `--from <source>`      | `diff`            | `migrations` \| `database` \| `empty` | The source to compare from. Defaults to `migrations`.                                                                                                                                                                                                                                                      |
| `--to <source>`        | `diff`            | `schema` \| `database`                | The source to compare to. Defaults to `schema`.                                                                                                                                                                                                                                                            |
| `--out <file>`         | `generate`        | `generated/client.ts`                 | Output path for the generated client.                                                                                                                                                                                                                                                                      |
| `--help`, `-h`         | all               | —                                     | Show usage; after a command (e.g. `tsorm migrate --help`), show that command's usage and options. Help text follows the system language: Chinese when `LC_ALL`, `LC_MESSAGES`, or `LANG` starts with `zh`; when unset or `C`/`POSIX`, the OS UI language. Other output and error codes are always English. |

Unknown options raise an error immediately. Boolean flags (`--create-only`, `--reset`, `--force`, `--check`) only accept their bare form; `--force=false` etc. are rejected. Omit the flag to leave it disabled.

## Environment Variables

| Variable                        | Default         | Description                                                                                                                                                                                                                                        |
| ------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | `file:./dev.db` | Database connection; `file:`, `postgresql://`, or `mysql://`                                                                                                                                                                                       |
| `SHADOW_DATABASE_URL`           | None            | A dedicated shadow database, for when you lack create-database permission                                                                                                                                                                          |
| `CI`                            | None            | When set, nothing is asked; steps needing confirmation must add `--force`                                                                                                                                                                          |
| `LC_ALL`, `LC_MESSAGES`, `LANG` | None            | System language, checked in this order; when it starts with `zh` the help text is Chinese, and when unset or `C`/`POSIX` it falls back to the OS UI language (Linux has no desktop language setting and stays English). Other output is unaffected |

## Exit Codes

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| `0`  | Success                                                                         |
| `1`  | Error; also returned when `deploy --check` finds the database is not up to date |
| `2`  | `diff --check` found differences                                                |

## Interactivity

Reset and data-loss confirmations are prompted only in an interactive terminal. In non-interactive environments (stdin or stdout is not a terminal, or `CI` is set), confirmations raise `NON_INTERACTIVE`; `--force` skips them.

## Next Steps

- [Command Examples](./commands.md): common invocations for each command
- [Error Codes](../errors.md): the errors every command can report
