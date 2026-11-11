---
description: The SQLite adapter runs on Node.js's bundled node:sqlite with one synchronous connection, serializable transactions, and native RETURNING.
---

# SQLite

## Overview

Built on Node.js's bundled `node:sqlite` (`DatabaseSync`), with no separate server or extra driver.

- Driver: `node:sqlite`, shipped with Node.js itself
- Connections: one synchronous connection shared by every request
- Write results: native `RETURNING`
- Transactions: `BEGIN IMMEDIATE` for writes, `BEGIN` for read-only transactions
- Isolation levels: `serializable` only

Physical type mappings are in [Type Mapping](../overview.md#type-mapping).

## Definition

### Connection Options

| Option       | Type      | Default         | Description                                               |
| ------------ | --------- | --------------- | --------------------------------------------------------- |
| `connection` | `string`  | `file::memory:` | Database file; an in-memory database is used when omitted |
| `initialize` | `boolean` | `false`         | Create all tables, see below                              |

On connect, `PRAGMA foreign_keys=ON` is enabled and `busy_timeout` is set to 5000 milliseconds.

### Type Details

- In the generated schema, `string`, `datetime`, and JSON share `TEXT`, and `boolean` and integers share `INTEGER`. Length, enum, boolean value, and JSON validity are enforced by `CHECK` constraints.
- Bigint results use decimal strings. Model `int` fields are converted after a safe-integer range check.
- `datetime` stores local time as text; `timestamp` stores Unix milliseconds as an integer. Both are decoded according to `datetimeFormat`, see [Date & Timezone](../../client/datetime.md).
- `string` columns are length-checked by a `CHECK` constraint, 191 characters when the length is omitted, and can be indexed. `text` columns are plain `TEXT` with no length check, and cannot be keys or indexed. Every non-unique relation column, foreign keys and polymorphic id columns alike, gets an index automatically.

## Example

### Creating a Client

```ts
import { createClient } from "./generated/client.ts";
import { sqlite } from "@ofis/tsorm/adapters/sqlite";

const db = await createClient({
  adapter: sqlite({ connection: "file:./app.sqlite" }),
});
```

### Initialization

`initialize: true` runs all DDL within one transaction, rolling back entirely and closing the connection on failure.

::: warning
`initialize` requires an empty database: existing user tables or views raise `DATABASE_NOT_EMPTY`; use [versioned migrations](../migrations.md) for schema upgrades. Omit it when reconnecting to an existing database, and initialize a database from one process only.
:::

Export the table-creation SQL without connecting (`DATABASE_URL` only determines the database type):

```bash
DATABASE_URL=file:./app.sqlite tsorm diff --from empty
```

The DDL uses inline `CHECK` and in-table `FOREIGN KEY`. When running it manually, enable foreign key checks the same way.

### Writes

- `INSERT` and `UPDATE` use `RETURNING` to obtain the record actually written.
- Bulk write returning and native `ON CONFLICT DO UPDATE` are supported; conditions are in [upsert](../../client/update.md#upsert).

## Notes

### Transactions and Connections

All requests share one synchronous connection and run in arrival order. Concurrent promises on the same client never execute SQL simultaneously, and there is no multi-connection parallel read.

| Scenario              | Statement         |
| --------------------- | ----------------- |
| Write transaction     | `BEGIN IMMEDIATE` |
| Read-only transaction | `BEGIN`           |

- The only declarable isolation level is `serializable`.
- After a `ROLLBACK` failure, the connection is marked unusable and later requests raise `CLIENT_CLOSED`.
- The synchronous API blocks the event loop. Under high concurrency or large data, validate against your real workload.

Common behavior is in [Transactions](../../client/transactions.md).

### Error Mapping

Based on SQLite's constraint messages, errors map to `UNIQUE_CONSTRAINT`, `FOREIGN_KEY_CONSTRAINT`, `NOT_NULL_CONSTRAINT`, and `CHECK_CONSTRAINT`; the rest become `DATABASE_ERROR`.

### Related Links

- [Node.js `node:sqlite` documentation](https://nodejs.org/api/sqlite.html)

## Next Steps

- [MySQL / MariaDB](./mysql.md): a pooled adapter with three isolation levels and implicit DDL commits
- [PostgreSQL](./postgres.md): a pooled adapter with schema support and native `BOOLEAN`
- [Versioned Migrations](../migrations.md): upgrading an existing SQLite database
