---
description: How to run the tsorm command-line tool and what each command does.
---

# CLI

Installing `@ofis/tsorm` provides the `tsorm` command:

```bash
tsorm <command> [options]
```

- With a project install, write `tsorm` directly in the `scripts` of `package.json`, for example `"db:migrate": "tsorm migrate"`.
- With a global install (`npm install -g @ofis/tsorm`), run it from any terminal.
- To run it once without installing, use the full package name: `npx @ofis/tsorm <command>`.

Most commands can use defaults; `resolve` requires exactly one of `--applied` or `--rolled-back`. Paths are relative to the current directory. On failure, the error is written to standard error and the exit code is 1.

## Commands

All commands fall into three groups by purpose.

### Migration Commands

Generate, apply, and repair versioned migrations:

| Command   | Description                                             | Options                                         |
| --------- | ------------------------------------------------------- | ----------------------------------------------- |
| `migrate` | Generate and apply migrations from models (development) | `--name`, `--create-only`, `--reset`, `--force` |
| `deploy`  | Apply pending migrations (release)                      | `--check`                                       |
| `resolve` | Record recovery or register a baseline                  | `--applied <name>` or `--rolled-back <name>`    |

Migration command details are in [Versioned Migrations](../../databases/migrations.md).

### Sync Commands

Compare structure (`diff`, using migration history by default), or synchronize directly without recording a migration (`push`):

| Command | Description                                  | Options                     |
| ------- | -------------------------------------------- | --------------------------- |
| `diff`  | Output SQL between two schemas               | `--from`, `--to`, `--check` |
| `push`  | Sync the schema directly, without migrations | `--reset`, `--force`        |

### Schema Tooling Commands

Check the schema file and generate the client:

| Command    | Description                    | Options                                           |
| ---------- | ------------------------------ | ------------------------------------------------- |
| `validate` | Validate the schema file       | None                                              |
| `generate` | Generate the TypeScript client | `--out <file>`, defaults to `generated/client.ts` |

## Next Steps

- [Options & Behavior](./options.md): every option, environment variable, exit code, and confirmation prompt
- [Command Examples](./commands.md): common invocations for each command
- [Calling from Code](./programmatic.md): the function counterpart of every command
