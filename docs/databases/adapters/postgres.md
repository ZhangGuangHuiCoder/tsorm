---
description: The PostgreSQL adapter runs on pg with a connection pool, a configurable schema, native RETURNING and BOOLEAN types, and full isolation-level support.
---

# PostgreSQL

## Overview

Built on `pg` (node-postgres). Supports PostgreSQL 14+; server version and target schema are checked on the first operation, not at client creation.

- Driver: `pg`
- Connections: a pool; every root request gets its own connection
- Write results: native `RETURNING`
- Transactions: writes are wrapped automatically, plain reads are not
- Isolation levels: all three, set via `BEGIN ISOLATION LEVEL`
- Schema: the `schema` query parameter selects the target schema, `public` by default

Physical type mappings are in [Type Mapping](../overview.md#type-mapping).

## Definition

### Connection Options

| Option       | Type     | Default  | Description                                                                 |
| ------------ | -------- | -------- | --------------------------------------------------------------------------- |
| `connection` | `string` | Required | PostgreSQL URL; driver options and the target `schema` use query parameters |

### Connection Pool

The pool is configured in the connection URL using the node-postgres pool names; times are milliseconds:

| URL parameter             | Description                                                | Default                          |
| ------------------------- | ---------------------------------------------------------- | -------------------------------- |
| `max`                     | Maximum connections in the pool                            | `2 × availableParallelism() + 1` |
| `min`                     | Connections kept idle once opened                          | `0`                              |
| `connectionTimeoutMillis` | How long an acquire waits for a free connection            | no limit                         |
| `idleTimeoutMillis`       | Idle time before a connection is closed; `0` keeps it open | 10000 ms                         |

node-postgres ignores unknown URL parameters, so the adapter reads these four, passes them to the pool and removes them from the connection string. Only `postgresql://…` URLs are accepted.

```ts
const db = createClient({
  connection: "postgresql://app:password@localhost:5432/app?max=20&min=2&connectionTimeoutMillis=5000&idleTimeoutMillis=60000",
});
```

### Session Settings

The adapter sets `search_path` and `standard_conforming_strings` on every connection it checks out. It never changes the session timezone.

### Type Details

- Driver `int8` values arrive as strings; model `int` and ORM counts are converted to safe `number` values, model `bigint` stays a decimal string.
- `string` and `text` both use PostgreSQL's `TEXT`-family storage; `string(n)` becomes `VARCHAR(n)` for the length check, `text` an unbounded `TEXT`.
- Booleans use the native `BOOLEAN`; auto keys use `GENERATED ALWAYS AS IDENTITY`, which also rejects explicit writes.
- Identifiers are limited to 63 UTF-8 bytes to avoid silent truncation collisions; index size is bound by PostgreSQL's index entry size limit. Non-unique relation columns are indexed explicitly, foreign keys and polymorphic id columns alike.
- `//` comments render as `COMMENT ON COLUMN` / `COMMENT ON TABLE`; migrations track comment changes.
- Ordering explicitly uses `ASC NULLS FIRST` and `DESC NULLS LAST`; `LIKE` follows PostgreSQL's case semantics.

## Example

### Creating a Client

```ts
import { createClient } from "./generated/client.ts";

const db = createClient({
  connection: "postgresql://app:password@localhost:5432/app?schema=public",
});
```

### Initialization

Create the tables with [`tsorm push`](../migrations.md#push) or versioned migrations; the adapter itself never creates tables. To export the table-creation SQL without connecting (`DATABASE_URL` only determines the database type):

```bash
DATABASE_URL=postgresql://user:pass@host:5432/app tsorm diff --from empty
```

Run it manually with the correct `search_path` and `standard_conforming_strings`.

### Writes

- `INSERT` and `UPDATE` use `RETURNING` to obtain the record actually written.
- Bulk write returning and native `ON CONFLICT DO UPDATE` are supported; conditions are in [upsert](../../client/update.md#upsert).

## Notes

### Transactions and Connections

Each root request acquires one connection from the pool for its whole nested query tree or write graph; writes are wrapped in a transaction, plain reads execute directly.

- All three isolation levels, set via `BEGIN ISOLATION LEVEL`; the session default applies when omitted (`READ COMMITTED`), and `findManyAndCount` inside a transaction then raises `TRANSACTION_ISOLATION`. Common behavior is in [Transactions](../../client/transactions.md).
- A failed `ROLLBACK` discards the connection instead of returning it to the pool. `$close()` closes the pool; idle connection failures are caught by pool `error` listeners and do not become unhandled exceptions.

### Migration Caveats

The connection URL's `schema` query parameter (and `DATABASE_URL`'s) selects the target schema for both queries and migrations. Migrations need `CREATEDB` permission to create the shadow database, or set `SHADOW_DATABASE_URL`.

### Error Mapping

| SQLSTATE | Error code               |
| -------- | ------------------------ |
| `23505`  | `UNIQUE_CONSTRAINT`      |
| `23503`  | `FOREIGN_KEY_CONSTRAINT` |
| `23001`  | `FOREIGN_KEY_CONSTRAINT` |
| `23502`  | `NOT_NULL_CONSTRAINT`    |
| `23514`  | `CHECK_CONSTRAINT`       |
| `40001`  | `SERIALIZATION_FAILURE`  |
| `40P01`  | `TRANSACTION_DEADLOCK`   |
| `55P03`  | `LOCK_TIMEOUT`           |
| `57014`  | `QUERY_CANCELLED`        |
| `25P02`  | `TRANSACTION_ABORTED`    |
| Other    | `DATABASE_ERROR`         |

### Related Links

- [node-postgres: queries](https://node-postgres.com/features/queries)
- [node-postgres: transactions](https://node-postgres.com/features/transactions)
- [node-postgres: pooling](https://node-postgres.com/features/pooling)

## Next Steps

- [SQLite](./sqlite.md): the single-connection adapter
- [MySQL / MariaDB](./mysql.md): the pooled adapter without `RETURNING`
- [Versioned Migrations](../migrations.md): schema diffing and shadow databases
