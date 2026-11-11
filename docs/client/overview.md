---
description: Create and close the client, configure options, read database capabilities, and handle errors.
---

# Client Overview

The generated `createClient` is an async function. Each client is bound to one adapter, and models are accessed through lower-cased properties, for example `User` becomes `db.user`.

Examples use the [example models](../guide/examples.md) unless a page declares its own schema. Snippets show independent operations, not a single program to run in sequence.

## Creating the Client

```ts
import { createClient } from "./generated/client.ts";
import { sqlite } from "@ofis/tsorm/adapters/sqlite";

const db = await createClient({
  adapter: sqlite({ connection: "file:./app.sqlite" }),
  timezone: "+08:00",
});

try {
  // Use db to access the database
} finally {
  await db.$close();
}
```

### Options

| Option           | Type               | Default  | Description                                                                  |
| ---------------- | ------------------ | -------- | ---------------------------------------------------------------------------- |
| `adapter`        | `Adapter`          | Required | Database adapter, see [Database Adapters](../databases/adapters/overview.md) |
| `timezone`       | `string`           | `+08:00` | Fixed-offset timezone, see [Date & Timezone](./datetime.md)                  |
| `datetimeFormat` | `'local' \| 'utc'` | `local`  | Model date output: local datetime or ISO UTC                                 |
| `logger`         | `Logger`           | None     | Event callback, see [Event Logging](./logging.md)                            |
| `maxAffected`    | `number`           | None     | Row limit for bulk writes, see [Write Safety](#write-safety)                 |

Virtual fields and a global omit are not client options; extend the client with `$extend` to add them, see [Extensions](./extensions.md).

## Switching Databases

The same models and generated client work with any adapter; switching requires no regeneration:

```ts
import { sqlite } from "@ofis/tsorm/adapters/sqlite";
import { mysql } from "@ofis/tsorm/adapters/mysql";
import { postgres } from "@ofis/tsorm/adapters/postgres";

const adapter = sqlite({ connection: "file:./app.sqlite" });
// const adapter = mysql({ connection: 'mysql://app:password@localhost:3306/app' });
// const adapter = postgres({ connection: 'postgresql://app:password@localhost:5432/app' });
```

Swapping the adapter does not migrate existing tables or data. Establish the target database's schema and migration history separately; data transfer is a separate task.

## Closing the Client

`$close()` waits for started operations to finish, then releases connections. Calls after closing raise `CLIENT_CLOSED`; calling it inside a transaction raises `TRANSACTION_SCOPE`.

Clients created through `$extend` share shutdown state. Concurrent `$close()` calls wait for the same resource cleanup and observe the same shutdown error.

## Reading Database Capabilities

`$capabilities` is a read-only object describing the current adapter:

```ts
console.log(db.$capabilities);
// { returning, windowFunctions, transactionalDDL, versionedMigrations, isolationLevels }
```

Per-database values are listed in the [capability matrix](../databases/overview.md#client-capabilities).

## Error Handling

Client validation and mapped database errors use `OrmError`, identified by `code`; other exceptions may propagate unchanged:

```ts
import { OrmError } from "@ofis/tsorm";

try {
  await db.user.create({ data: { email: "alice@example.com" } });
} catch (error) {
  if (error instanceof OrmError && error.code === "UNIQUE_CONSTRAINT") {
    // Handle the duplicate email
  } else {
    throw error;
  }
}
```

The full list is in [Error Codes](../reference/errors.md).

::: warning Sensitive data
Error messages never contain SQL parameters, but the original driver error kept in `cause` may contain input values. Filter them yourself before writing to application logs.
:::

## Write Safety

Top-level bulk update, delete, and restore methods require a non-empty `where`; missing or empty conditions raise `VALIDATION`. `createMany` has no `where`, and nested writes are scoped by the parent relation; see [Relation Writes](./relation-writes.md). Use [`$clear`](./delete.md#clear-a-table) to explicitly empty a table.

`maxAffected` must be a positive safe integer and limits top-level bulk updates, deletes, and restores; it is unset by default. When a write matches more rows than the limit, the ORM raises `MASS_WRITE_BLOCKED` before applying it. The row count and the write are separate statements, so the guard protects against a wrong filter rather than against concurrent writers. `$clear` is exempt, because the call itself is the confirmation.

## Execution Model

- One API call does not necessarily map to one SQL statement. Relation eager loading and relation counts run in batches of at most 200 parent keys and never query per parent.
- `select` and `omit` on root and included queries prune database columns while keeping relation keys, primary keys, and virtual field dependencies.
- Only columns actually loaded are decoded and validated.

## Next Steps

- [Queries](./queries.md): filters, projections, relation loading, and pagination
- [Create](./create.md), [Update](./update.md), and [Delete](./delete.md): the write operations
- [Transactions](./transactions.md): grouping several operations into one transaction
