---
description: Create and close the client, configure options, read database capabilities, and handle errors.
---

# Client Overview

The generated `createClient` is an async function. Each client is bound to one adapter, and models are accessed through lower-cased properties, for example `User` becomes `db.user`.

All examples in this chapter build on the models in `examples/schema.orm`, covered by the [full example](../guide/examples.md).

## Creating the Client

```ts
import { createClient } from './generated/client.ts';
import { sqlite } from '@ofis/tsorm/adapters/sqlite';

const db = await createClient({
  adapter: sqlite({ filename: './app.sqlite' }),
  timezone: '+08:00',
});

try {
  // Use db to access the database
} finally {
  await db.$close();
}
```

### Options

| Option     | Type      | Default  | Description                                                                                          |
| ---------- | --------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `adapter`  | `Adapter` | Required | Database adapter, see [Database Adapters](../databases/adapters.md) |
| `timezone` | `string`  | `+08:00` | Fixed-offset timezone, see [Date & Timezone](./datetime.md)                                          |
| `logger`   | `Logger`  | None     | Event callback, see [Event Logging](./logging.md)                                                    |
| `virtuals` | `object`  | None     | Virtual field definitions, see [Virtual Fields](./virtual-fields.md)                                 |
| `omit`     | `object`  | None     | Fields excluded from results by default, configured per model (lower-cased)                          |

`omit` suits fields that should never be returned by default, such as password hashes. It applies to every method that returns records and to nested relations, and the returned types drop those fields accordingly; use `select` or `omit: { field: false }` in a query to bring them back. Filtering, ordering, and unique lookups are unaffected:

```ts
const db = await createClient({
  adapter: sqlite({ filename: './app.sqlite' }),
  omit: { user: { passwordHash: true } },
});
await db.user.findUnique({ where: { id: 1 } }); // without passwordHash
await db.user.findUnique({ where: { id: 1 }, omit: { passwordHash: false } });
```

## Switching Databases

The same models and generated client work with any adapter; switching requires no regeneration:

```ts
import { sqlite, mysql, postgres } from '@ofis/tsorm/adapters';

const adapter = sqlite({ filename: './app.sqlite' });
// const adapter = mysql({ connection: { host: 'localhost', user: 'app', database: 'app' } });
// const adapter = postgres({ connection: { connectionString: process.env.DATABASE_URL } });
```

Swapping the adapter does not migrate existing tables or data.

## Closing the Client

`$close()` waits for started operations to finish, then releases connections. Calls after closing raise `CLIENT_CLOSED`; calling it inside a transaction raises `TRANSACTION_SCOPE`.

## Reading Database Capabilities

`$capabilities` is a read-only object describing the current adapter:

```ts
console.log(db.$capabilities);
// { returning, windowFunctions, transactionalDDL, versionedMigrations, isolationLevels }
```

Per-database values are listed in the [capability matrix](../databases/overview.md#client-capabilities).

## Error Handling

Errors thrown by the ORM are `OrmError`, identified by their `code`:

```ts
import { OrmError } from '@ofis/tsorm';

try {
  await db.user.create({ data: { email: 'alice@example.com' } });
} catch (error) {
  if (error instanceof OrmError && error.code === 'UNIQUE_CONSTRAINT') {
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

## Execution Model

- One API call does not necessarily map to one SQL statement. Relation eager loading and relation counts run in batches of at most 200 parent keys and never query per parent.
- `select` and `omit` on root and included queries prune database columns while keeping relation keys, primary keys, and virtual field dependencies.
- Only columns actually loaded are decoded and validated.
