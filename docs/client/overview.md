---
description: Create, configure, and close the client; read capabilities; handle errors.
---

# Client Overview

`createClient` is synchronous — it opens no connection, so no `await`. Each client is bound to one adapter; models are lower-cased properties (`User` → `db.user`). Examples use the [example models](../guide/examples.md) unless a page declares its own schema.

## Creating the Client

```ts
import { createClient } from "./generated/client.ts";

const db = createClient({
  connection: "file:./app.sqlite",
});

try {
  // Use db to access the database
} finally {
  await db.$close();
}
```

### Options

| Option        | Type     | Default  | Description                                                                                                       |
| ------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `connection`  | `string` | Required | Connection URL; the adapter is chosen from the scheme, see [Database Adapters](../databases/adapters/overview.md) |
| `logger`      | `Logger` | None     | Event callback, see [Event Logging](./logging.md)                                                                 |
| `maxAffected` | `number` | None     | Row limit for bulk writes, see [Write Safety](#write-safety)                                                      |

The adapter connects on the first database operation, where connection errors surface; `$close()` on an unused client returns without connecting. Virtual fields and global omit are added with `$extend`, see [Extensions](./extensions.md).

## Switching Databases

The same models and generated client work with any adapter; switching requires no regeneration:

```ts
import { createClient } from "./generated/client.ts";

const db = createClient({ connection: "file:./app.sqlite" });
// const db = createClient({ connection: "mysql://app:password@localhost:3306/app" });
// const db = createClient({ connection: "postgresql://app:password@localhost:5432/app" });
```

Swapping the adapter does not migrate tables or data.

## Closing the Client

`$close()` waits for started operations to finish, then releases connections. Calls after closing raise `CLIENT_CLOSED`; inside a transaction it raises `TRANSACTION_SCOPE`. Clients from `$extend` share shutdown state.

## Reading Database Capabilities

`$capabilities` describes the current adapter and is readable right after `createClient`:

```ts
console.log(db.$capabilities);
// { returning, isolationLevels }
```

Per-database values are listed in the [capability matrix](../databases/overview.md#client-capabilities).

## Error Handling

Client validation and mapped database errors use `OrmError`, identified by `code`:

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
Error messages never contain SQL parameters, but `cause` keeps the original driver error, which may contain input values. Filter them before writing to application logs.
:::

## Write Safety

Top-level bulk update, delete, and restore methods require a non-empty `where`; empty conditions raise `VALIDATION`. Nested writes are scoped by the parent relation, see [Relation Writes](./relation-writes.md). Use [`$clear`](./delete.md#clear-a-table) to empty a table explicitly. `maxAffected` (positive safe integer, unset by default) caps rows for those bulk operations; exceeding it raises `MASS_WRITE_BLOCKED` before the write — the count and write are separate statements, so it guards against a wrong filter, not concurrent writers. `$clear` is exempt, because the call itself is the confirmation.

## Execution Model

- One API call does not necessarily map to one SQL statement; relation loading and counts run in batches of at most 200 parent keys, never per parent. `select` and `omit` prune database columns while keeping relation keys, primary keys, and virtual field dependencies, and only loaded columns are decoded and validated.

## Next Steps

- [Queries](./queries.md): filters, projections, relation loading, and pagination
- [Create](./create.md), [Update](./update.md), and [Delete](./delete.md): the write operations
- [Transactions](./transactions.md): grouping several operations into one transaction
