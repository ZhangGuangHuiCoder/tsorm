---
description: Run the same operations as the tsorm CLI from code, with function counterparts, options, and examples.
---

# Calling from Code

Every command has a function counterpart, so you can run the same operations inside your program: migrate at application startup, reset the database in test setup, or check drift in a deploy script. Migration commands come from `@ofis/tsorm/migrations`; schema validation and generation use `parseSchema` and `generateClient` from `@ofis/tsorm/schema`.

## Functions

| Command          | Function                                            | Returns                                                           |
| ---------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `migrate`        | `migrate({ name, createOnly, reset })`              | `{ migration?, applied, reset }`                                  |
| `deploy`         | `deploy({})`                                        | `{ applied }`                                                     |
| `deploy --check` | `status({})`                                        | `{ exitCode, local, applied, pending, failed, missing, message }` |
| `resolve`        | `resolve({ applied })` or `resolve({ rolledBack })` | Nothing                                                           |
| `diff`           | `diff({ from, to })`                                | `{ diff, sql, summary }`; `diff.empty` matches `--check`          |
| `push`           | `push({ reset })`                                   | `{ changed }`                                                     |
| `validate`       | `parseSchema(source)`                               | The parsed schema; throws `SchemaError` when invalid              |
| `generate`       | `generateClient(schema, runtimeImport)`             | The client source as a string                                     |

## Migration Types

`@ofis/tsorm/migrations` also exports these types for typing your own wrappers:

| Type                | Meaning                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `Prompter`          | Object with `confirm(message): Promise<boolean>`, passed as `prompt` |
| `CommandOptions`    | Options shared by all migration functions                            |
| `MigrateResult`     | Return value of `migrate`: `{ migration?, applied, reset }`          |
| `StatusResult`      | Return value of `status`, including `exitCode`                       |
| `DiffSource`        | Source selector accepted by `diff`                                   |
| `DiffResult`        | Return value of `diff`, including `diff.empty`                       |
| `SchemaDiff`        | Structural difference between two schemas                            |
| `MigrationProvider` | Database-specific provider used by the migration engine              |

## Common Options

Migration functions require an options object; pass `{}` to use defaults. The table above shows awaited results. Common options:

| Option              | Default         | CLI counterpart                                                                |
| ------------------- | --------------- | ------------------------------------------------------------------------------ |
| `url`               | `file:./dev.db` | `DATABASE_URL`                                                                 |
| `shadowDatabaseUrl` | None            | `SHADOW_DATABASE_URL`                                                          |
| `schema`            | `schema.orm`    | `--schema`                                                                     |
| `cwd`               | `process.cwd()` | The current directory; relative paths resolve against it                       |
| `force`             | `false`         | `--force`                                                                      |
| `prompt`            | None            | The terminal confirmation; an object with `confirm(message): Promise<boolean>` |
| `log`               | Silent          | Progress output                                                                |

## Differences from the CLI

- **No environment variables are read.** Pass `url: process.env.DATABASE_URL` yourself; otherwise the function uses `file:./dev.db`.
- **Nothing is printed** unless you pass `log`, for example `log: console.log`.
- **Nothing is asked.** Without `prompt`, a step that needs confirmation throws `NON_INTERACTIVE`; set `force: true` to accept it. `confirm` returning `false` throws `ABORTED`.
- **Errors are thrown, not exit codes.** Migration functions throw `MigrationError` with a `code`, such as `NON_INTERACTIVE` or `DATABASE_NOT_FOUND`. `status` and `diff` report results in their return value, so read `exitCode` or `diff.empty` instead.

## Examples

### Migrate at Startup

```ts
import { deploy } from "@ofis/tsorm/migrations";

await deploy({ url: process.env.DATABASE_URL, log: console.log });
```

### Check in a Deploy Script

```ts
import { diff, status } from "@ofis/tsorm/migrations";

const url = process.env.DATABASE_URL;
const state = await status({ url });
if (state.exitCode !== 0) {
  throw new Error(state.message);
}

const drift = await diff({ url, from: "migrations", to: "database" });
if (!drift.diff.empty) {
  throw new Error(drift.summary);
}
```

### Reset a Test Database

```ts
import { push } from "@ofis/tsorm/migrations";

await push({ url: "file:./test.db", reset: true, force: true });
```

### Generate the Client

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateClient, parseSchema } from "@ofis/tsorm/schema";

const schema = parseSchema(readFileSync("schema.orm", "utf8"));
mkdirSync("generated", { recursive: true });
writeFileSync("generated/client.ts", generateClient(schema));
```

`runtimeImport` defaults to `'@ofis/tsorm'`, so the generated file resolves the runtime through the package's `exports` regardless of where it lives. `generateClient` only returns the source, so create the target directory first.

### Confirm in Your Own UI

```ts
import { migrate, MigrationError } from "@ofis/tsorm/migrations";

try {
  await migrate({
    url: process.env.DATABASE_URL,
    name: "add_profile",
    prompt: { confirm: async (message) => askUser(message) },
  });
} catch (error) {
  if (error instanceof MigrationError && error.code === "ABORTED") {
    console.log("Cancelled");
  } else {
    throw error;
  }
}
```

`askUser` stands for your own confirmation dialog; return `true` to continue.

## Next Steps

- [Client API](../client-api.md): the generated client's full API
- [Error Codes](../errors.md): the `MigrationError` codes these functions can throw
