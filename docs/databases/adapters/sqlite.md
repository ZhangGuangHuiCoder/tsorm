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

| Option       | Type     | Default                                     | Description                                                                                                       |
| ------------ | -------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `connection` | `string` | Required (adapter default: `file::memory:`) | Database file as a `file:` URL; `createClient` requires it, the adapter alone falls back to an in-memory database |

On the first operation, when the client connects, `PRAGMA foreign_keys=ON` is enabled and `busy_timeout` is set to 5000 milliseconds. SQLite runs requests serially in-process on one connection, so it has no pool settings and its URL accepts no parameters; pool sizing belongs to [MySQL](./mysql.md#connection-pool) and [PostgreSQL](./postgres.md#connection-pool).

### Type Details

- In the generated schema, `string`, `datetime`, and JSON share `TEXT`, and `boolean` and integers share `INTEGER`. Length, enum, boolean value, and JSON validity are enforced by `CHECK` constraints.
- Bigint results use decimal strings; model `int` fields are converted after a safe-integer range check.
- `datetime` stores UTC ISO text; `timestamp` stores Unix milliseconds as an integer. Both are read back as `Date`, see [Date & Timezone](../../client/datetime.md).
- `string` columns are length-checked by a `CHECK` constraint (191 characters when omitted) and can be indexed; `text` is plain `TEXT`, cannot be keys or indexed. Every non-unique relation column gets an index automatically.
- SQLite has no comment storage; `//` comments are accepted but ignored.

## Example

### Creating a Client

```ts
import { createClient } from "./generated/client.ts";

const db = createClient({
  connection: "file:./app.sqlite",
});
```

### Initialization

Create the tables with [`tsorm push`](../migrations.md#push) or versioned migrations; the adapter itself never creates tables. To export the table-creation SQL without connecting (`DATABASE_URL` only determines the database type):

```bash
DATABASE_URL=file:./app.sqlite tsorm diff --from empty
```

Run it manually with foreign key checks enabled the same way.

### Writes

- `INSERT` and `UPDATE` use `RETURNING` to obtain the record actually written.
- Bulk write returning and native `ON CONFLICT DO UPDATE` are supported; conditions are in [upsert](../../client/update.md#upsert).

## Notes

### Transactions and Connections

All requests share one synchronous connection and run in arrival order; concurrent promises never execute SQL simultaneously, and there is no multi-connection parallel read.

| Scenario              | Statement         |
| --------------------- | ----------------- |
| Write transaction     | `BEGIN IMMEDIATE` |
| Read-only transaction | `BEGIN`           |

- The only declarable isolation level is `serializable`; after a `ROLLBACK` failure the connection is unusable and later requests raise `CLIENT_CLOSED`. The synchronous API blocks the event loop; validate against your real workload under high concurrency or large data. Common behavior is in [Transactions](../../client/transactions.md).

### Error Mapping

Based on SQLite's constraint messages, errors map to `UNIQUE_CONSTRAINT`, `FOREIGN_KEY_CONSTRAINT`, `NOT_NULL_CONSTRAINT`, and `CHECK_CONSTRAINT`; the rest become `DATABASE_ERROR`.

### Related Links

- [Node.js `node:sqlite` documentation](https://nodejs.org/api/sqlite.html)

## Next Steps

- [MySQL / MariaDB](./mysql.md): a pooled adapter with three isolation levels and implicit DDL commits
- [PostgreSQL](./postgres.md): a pooled adapter with schema support and native `BOOLEAN`
- [Versioned Migrations](../migrations.md): upgrading an existing SQLite database
