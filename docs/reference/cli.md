---
description: All commands, options, environment variables, and exit codes of the tsorm command-line tool.
---

# CLI

Installing `@ofis/tsorm` provides the `tsorm` command:

```bash
tsorm <command> [options]
```

- With a project install, write `tsorm` directly in the `scripts` of `package.json`, for example `"db:migrate": "tsorm migrate"`.
- With a global install (`npm install -g @ofis/tsorm`), run it from any terminal.
- To run it once without installing, use the full package name: `npx @ofis/tsorm <command>`.

Every command has defaults, so most cases need no arguments. Paths are relative to the current directory. On failure, the error is written to standard error and the exit code is 1.

## Commands

| Command    | Description                              | Options                                       |
| ---------- | ---------------------------------------- | --------------------------------------------- |
| `migrate`  | Generate and apply migrations from models (development) | `--name`, `-n`, `--create-only`, `--reset`, `--force` |
| `deploy`   | Apply pending migrations (release)       | `--check`                                     |
| `resolve`  | Handle a failed migration                | `--applied <name>` or `--rolled-back <name>`  |
| `diff`     | Output SQL between two schemas           | `--from`, `--to`, `--check`                   |
| `push`     | Sync the schema directly, without migrations | `--reset`, `--force`                        |
| `validate` | Validate the schema file                 | None                                          |
| `generate` | Generate the TypeScript client           | `--out <file>`, defaults to `generated/client.ts` |

Migration command details are in [Versioned Migrations](../databases/migrations.md).

## Common Options

| Option            | Default      | Description                                       |
| ----------------- | ------------ | ------------------------------------------------- |
| `--schema <file>` | `schema.orm` | Schema file; the migrations directory is fixed at `migrations/` beside it |
| `--force`         | Off          | Skip confirmations, accept data loss              |
| `--help`, `-h`    |              | Show help                                         |

Unknown options raise an error immediately.

## Environment Variables

| Variable              | Default         | Description                                      |
| --------------------- | --------------- | ------------------------------------------------ |
| `DATABASE_URL`        | `file:./dev.db` | Database connection; `file:`, `postgresql://`, or `mysql://` |
| `SHADOW_DATABASE_URL` | None            | A dedicated shadow database, for when you lack create-database permission |
| `CI`                  | None            | When set, nothing is asked; steps needing confirmation must add `--force` |

## Exit Codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| `0`  | Success                                                |
| `1`  | Error; also returned when `deploy --check` finds the database is not up to date |
| `2`  | `diff --check` found differences                       |

## Interactivity

Reset and data-loss confirmations are prompted only in an interactive terminal. In non-interactive environments (stdin or stdout is not a terminal, or `CI` is set), steps needing confirmation raise `NON_INTERACTIVE`, and `--force` skips the confirmation.

## Calling from Code

Every command has a function counterpart, so you can run the same operations inside your program: migrate at application startup, reset the database in test setup, or check for drift in a deploy script. The migration commands come from `@ofis/tsorm/migrations`, and `validate` and `generate` come from `@ofis/tsorm/schema`.

| Command          | Function                                 | Returns                                                   |
| ---------------- | ---------------------------------------- | --------------------------------------------------------- |
| `migrate`        | `migrate({ name, createOnly, reset })`   | `{ migration?, applied, reset }`                          |
| `deploy`         | `deploy()`                               | `{ applied }`                                             |
| `deploy --check` | `status()`                               | `{ exitCode, local, applied, pending, failed, missing, message }` |
| `resolve`        | `resolve({ applied })` or `resolve({ rolledBack })` | Nothing                                        |
| `diff`           | `diff({ from, to })`                     | `{ diff, sql, summary }`; `diff.empty` matches `--check`  |
| `push`           | `push({ reset })`                        | `{ changed }`                                             |
| `validate`       | `parseSchema(source)`                    | The parsed schema; throws `SchemaError` when invalid      |
| `generate`       | `generateClient(schema, runtimeImport)`  | The client source as a string                             |

Every migration function also takes these options:

| Option              | Default         | CLI counterpart                    |
| ------------------- | --------------- | ---------------------------------- |
| `url`               | `file:./dev.db` | `DATABASE_URL`                     |
| `shadowDatabaseUrl` | None            | `SHADOW_DATABASE_URL`              |
| `schema`            | `schema.orm`    | `--schema`                         |
| `cwd`               | `process.cwd()` | The current directory; relative paths resolve against it |
| `force`             | `false`         | `--force`                          |
| `prompt`            | None            | The terminal confirmation; an object with `confirm(message): Promise<boolean>` |
| `log`               | Silent          | Progress output                    |

Differences from the CLI:

- **No environment variables are read.** Pass `url: process.env.DATABASE_URL` yourself; otherwise the function uses `file:./dev.db`.
- **Nothing is printed** unless you pass `log`, for example `log: console.log`.
- **Nothing is asked.** Without `prompt`, a step that needs confirmation throws `NON_INTERACTIVE`; set `force: true` to accept it. When `confirm` returns `false`, the function throws `ABORTED`.
- **Errors are thrown, not turned into exit codes.** Migration functions throw `MigrationError` with a `code`, such as `NON_INTERACTIVE` or `DATABASE_NOT_FOUND`. `status` and `diff` report their result in the return value, so read `exitCode` or `diff.empty` instead.

### Migrate at Startup

```ts
import { deploy } from '@ofis/tsorm/migrations';

await deploy({ url: process.env.DATABASE_URL, log: console.log });
```

### Check in a Deploy Script

```ts
import { diff, status } from '@ofis/tsorm/migrations';

const url = process.env.DATABASE_URL;
const state = await status({ url });
if (state.exitCode !== 0) throw new Error(state.message);

const drift = await diff({ url, from: 'migrations', to: 'database' });
if (!drift.diff.empty) throw new Error(drift.summary);
```

### Reset a Test Database

```ts
import { push } from '@ofis/tsorm/migrations';

await push({ url: 'file:./test.db', reset: true, force: true });
```

### Generate the Client

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { generateClient, parseSchema } from '@ofis/tsorm/schema';

const schema = parseSchema(readFileSync('schema.orm', 'utf8'));
writeFileSync('generated/client.ts', generateClient(schema, '@ofis/tsorm'));
```

`runtimeImport` is the module that the generated file imports `createClient` and the types from. Use `'@ofis/tsorm'` in an application. `generateClient` only returns the source, so create the target directory first.

### Confirm in Your Own UI

```ts
import { migrate, MigrationError } from '@ofis/tsorm/migrations';

try {
  await migrate({
    url: process.env.DATABASE_URL,
    name: 'add_profile',
    prompt: { confirm: async (message) => askUser(message) },
  });
} catch (error) {
  if (error instanceof MigrationError && error.code === 'ABORTED') console.log('Cancelled');
  else throw error;
}
```

`askUser` stands for your own dialog and returns `true` to continue.
