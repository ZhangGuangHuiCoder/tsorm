---
description: The PostgreSQL adapter runs on pg with a connection pool, a configurable schema, native RETURNING and BOOLEAN types, and full isolation-level support.
---

# PostgreSQL

## Overview

Built on `pg` (node-postgres). Supports PostgreSQL 14+; the adapter checks the server version at startup.

- Driver: `pg`
- Connections: a pool; every root request gets its own connection
- Write results: native `RETURNING`
- Transactions: writes are wrapped automatically, plain reads are not
- Isolation levels: all three, set via `BEGIN ISOLATION LEVEL`
- Schema: `dbSchema` selects the target schema, `public` by default

Physical type mappings are in [Type Mapping](../overview.md#type-mapping).

## Definition

### Connection Options

| Option       | Type      | Default  | Description                                         |
| ------------ | --------- | -------- | --------------------------------------------------- |
| `connection` | `string`  | Required | PostgreSQL URL; driver options use query parameters |
| `dbSchema`   | `string`  | `public` | Existing application schema                         |
| `initialize` | `boolean` | `false`  | Create all tables in an empty schema, see below     |

::: warning Type parsers
The adapter uses local type parsers to preserve bigint precision and validate its range.
:::

### Session Settings

The adapter sets `search_path`, the UTC timezone, and `standard_conforming_strings` on every connection it checks out.

### Type Details

- Driver `int8` values arrive as strings. Model `int` and ORM counts are converted to safe `number` values; model `bigint` values remain decimal strings.
- `string` and `text` both use PostgreSQL's `TEXT`-family storage; `string(n)` becomes `VARCHAR(n)` for the length check and `text` becomes an unbounded `TEXT`.
- Booleans use the native `BOOLEAN`, with no extra value `CHECK`.
- Auto keys use `GENERATED ALWAYS AS IDENTITY`, and the database also rejects explicit writes.
- All identifiers are limited to 63 UTF-8 bytes to avoid silent truncation causing name collisions.
- Index size is still bound by PostgreSQL's actual index entry size limit.
- Non-unique relation columns are indexed explicitly: foreign keys and polymorphic id columns alike.
- `//` comments render as `COMMENT ON COLUMN` / `COMMENT ON TABLE` statements; migrations track comment changes.
- Ordering explicitly uses `ASC NULLS FIRST` and `DESC NULLS LAST`.
- `LIKE` follows PostgreSQL's case semantics.

## Example

### Creating a Client

```ts
import { createClient } from "./generated/client.ts";
import { postgres } from "@ofis/tsorm/adapters/postgres";

const db = await createClient({
  adapter: postgres({
    connection: "postgresql://app:password@localhost:5432/app",
    dbSchema: "public",
  }),
});
```

### Initialization

`initialize: true` requires the target schema to have no tables, views, or sequences, otherwise `DATABASE_NOT_EMPTY` is raised. If the target schema does not exist, `SCHEMA_NOT_FOUND` is raised.

Initialization runs in one transaction and rolls back all DDL on failure. It holds an advisory lock scoped to the database and schema: under concurrent initialization, the later arrival waits for the lock to release, then is rejected because the schema is not empty.

Export the table-creation SQL without connecting (`DATABASE_URL` only determines the database type):

```bash
DATABASE_URL=postgresql://user:pass@host:5432/app tsorm diff --from empty
```

When running it manually, set the correct `search_path` and enable `standard_conforming_strings`.

### Writes

- `INSERT` and `UPDATE` use `RETURNING` to obtain the record actually written.
- Bulk write returning and native `ON CONFLICT DO UPDATE` are supported; conditions are in [upsert](../../client/update.md#upsert).

## Notes

### Transactions and Connections

Each root request acquires its own connection from the pool, and the whole nested query tree or write graph uses that one connection. Writes are wrapped in a transaction automatically; plain reads execute directly.

- All three isolation levels are supported, set via `BEGIN ISOLATION LEVEL`.
- When the level is omitted, the session default applies (`READ COMMITTED` on PostgreSQL), and calling `findManyAndCount` inside a transaction then raises `TRANSACTION_ISOLATION`.
- A failed `ROLLBACK` discards the connection instead of returning it to the pool.
- `$close()` closes the connection pool the adapter created.
- The adapter registers `error` listeners on the pool so that idle connection failures do not become unhandled exceptions. These errors are not logged separately.

Common behavior is in [Transactions](../../client/transactions.md).

### Migration Caveats

The `schema` parameter of `DATABASE_URL` corresponds to `dbSchema`. Migrations need `CREATEDB` permission to create the shadow database, or set `SHADOW_DATABASE_URL`.

### Error Mapping

| SQLSTATE | Error code               |
| -------- | ------------------------ |
| `23505`  | `UNIQUE_CONSTRAINT`      |
| `23503`  | `FOREIGN_KEY_CONSTRAINT` |
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
