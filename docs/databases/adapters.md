---
description: Configuration, type details, initialization, transaction model, and error mapping for the SQLite, MySQL / MariaDB, and PostgreSQL adapters.
---

# Database Adapters

The three adapters share one model syntax and one client API; switching databases needs no regeneration. Physical type mappings are in [Type Mapping](./overview.md#type-mapping). Each adapter pins driver options and session settings so decoded results stay correct.

## SQLite

Built on Node.js's bundled `node:sqlite` (`DatabaseSync`), with no separate server or extra driver.

### Connection

```ts
import { createClient } from './generated/client.ts';
import { sqlite } from '@ofis/tsorm/adapters/sqlite';

const db = await createClient({
  adapter: sqlite({ filename: './app.sqlite' }),
});
```

| Option       | Type      | Default      | Description                                        |
| ------------ | --------- | ------------ | -------------------------------------------------- |
| `filename`   | `string`  | `:memory:`   | Database file; an in-memory database is used when omitted |
| `initialize` | `boolean` | `false`      | Create all tables, see below                       |

On connect, `PRAGMA foreign_keys=ON` is enabled and `busy_timeout` is set to 5000 milliseconds.

### Type Details

- SQLite has only numeric and text affinity: `string`, `date`, and JSON share `TEXT`, and `boolean` and integers share `INTEGER`. Length, enum, boolean value, and JSON validity are enforced by `CHECK` constraints.
- Integers are read as `bigint`, then checked against the safe-integer range.
- Dates are written as text in the client timezone and returned as-is on read.
- Unbounded strings can be indexed. Non-unique foreign key columns get an index automatically.

### Initialization

`initialize: true` runs all DDL within one transaction, rolling back entirely and closing the connection on failure.

::: warning
`initialize` is only for new databases. It never drops existing tables; use [versioned migrations](./migrations.md) for schema upgrades. Omit it when reconnecting to an existing database, and initialize a database from one process only.
:::

Export the table-creation SQL without connecting (`DATABASE_URL` only determines the database type):

```bash
DATABASE_URL=file:./app.sqlite tsorm diff --from empty
```

The DDL uses inline `CHECK` and in-table `FOREIGN KEY`. When running it manually, enable foreign key checks the same way. For schema upgrades of an existing database, use [versioned migrations](./migrations.md).

### Writes

- `INSERT` and `UPDATE` use `RETURNING` to obtain the record actually written.
- Bulk write returning and native `ON CONFLICT DO UPDATE` are supported; conditions are in [upsert](../client/writes.md#upsert).

### Transactions and Connections

All requests share one synchronous connection and run in arrival order. Concurrent promises on the same client never execute SQL simultaneously, and there is no multi-connection parallel read.

| Scenario              | Statement         |
| --------------------- | ----------------- |
| Write transaction     | `BEGIN IMMEDIATE` |
| Read-only transaction | `BEGIN`           |

- The only declarable isolation level is `serializable`.
- After a `ROLLBACK` failure, the connection is marked unusable and later requests raise `CLIENT_CLOSED`.
- The synchronous API blocks the event loop. Under high concurrency or large data, validate against your real workload.

Common behavior is in [Transactions](../client/transactions.md).

### Error Mapping

Based on SQLite's constraint messages, errors map to `UNIQUE_CONSTRAINT`, `FOREIGN_KEY_CONSTRAINT`, `NOT_NULL_CONSTRAINT`, and `CHECK_CONSTRAINT`; the rest become `DATABASE_ERROR`.

### Related Links

- [Node.js `node:sqlite` documentation](https://nodejs.org/api/sqlite.html)

## MySQL / MariaDB

Built on the `mariadb` Node.js Promise client. Supports MySQL 8.0+ and MariaDB 10.6+; managed tables must use InnoDB. The adapter checks the server version and the storage engine of existing tables at startup.

### Connection

```ts
import { createClient } from './generated/client.ts';
import { mysql } from '@ofis/tsorm/adapters/mysql';

const db = await createClient({
  adapter: mysql({
    connection: {
      host: process.env.MYSQL_HOST,
      port: 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      connectionLimit: 10,
    },
  }),
});
```

| Option       | Type         | Default  | Description                                       |
| ------------ | ------------ | -------- | ------------------------------------------------- |
| `connection` | `PoolConfig` | Required | `mariadb` connection pool config, including SSL and timeouts |
| `initialize` | `boolean`    | `false`  | Create all tables in an empty database, see below |

#### Pinned Driver Options

To guarantee results decode correctly, the adapter pins the following options; the same-named settings in `connection` are overridden:

`dateStrings`, `timezone`, `autoJsonMap`, `bigIntAsNumber`, `insertIdAsNumber`, `multipleStatements`, `decimalAsNumber`

#### Session Settings

The adapter sets a UTC session timezone, strict write mode, and `NO_BACKSLASH_ESCAPES` on every connection it checks out.

#### Authentication

MySQL 8.4 defaults to `caching_sha2_password`. Production should configure TLS or a trusted server public key (`cachingRsaPublicKey`). The adapter never enables `allowPublicKeyRetrieval` by default.

### Type Details

- An unbounded `string` uses `LONGTEXT`. When it needs an index, a unique constraint, or a string primary key, you must use `string(n)`, otherwise `UNSUPPORTED_CAPABILITY` is raised. The ORM never generates prefix indexes.
- Table creation pins `utf8mb4_bin`. This collation's comparison semantics include `PAD SPACE`, and application-level relation grouping treats trailing spaces the same way.
- An existing database should adopt the types and collation from the generated DDL; the ORM does not guarantee equivalent query behavior on arbitrary external table structures.
- `date` years must be between 1000 and 9999.
- Integers and `insertId` keep the driver's default `bigint`, converted only after a range check.

### Initialization

`initialize: true` requires the selected database to be empty, otherwise `DATABASE_NOT_EMPTY` is raised. The adapter creates all tables and indexes first, then adds foreign keys, so cyclic model references are supported.

::: danger DDL cannot roll back
MySQL's DDL commits implicitly, so a failed initialization may leave some tables behind, requiring manual inspection and cleanup. Initialize a database from one process only.
:::

Export the table-creation SQL without connecting (`DATABASE_URL` only determines the database type):

```bash
DATABASE_URL=mysql://user:pass@host:3306/app tsorm diff --from empty
```

When running it manually, configure `NO_BACKSLASH_ESCAPES`, strict write mode, and the UTC timezone yourself.

For schema upgrades of an existing database, use [versioned migrations](./migrations.md). Because MySQL's DDL cannot roll back, statements already executed by a failed migration remain, see [Failure and Repair](./migrations.md#resolve). Migrations need permission to create the shadow database, or set `SHADOW_DATABASE_URL`.

### Writes

- With no `RETURNING`, single writes obtain the result through `insertId` and a primary-key read-back within a transaction.
- `upsert` uses `ON DUPLICATE KEY UPDATE` when the inserted record can only conflict on the `where` unique key; otherwise it reads then writes in one transaction, see [upsert](../client/writes.md#upsert).
- `createManyAndReturn` inserts row by row in a transaction and reads back by `insertId`; `updateManyAndReturn` first selects matching primary keys, then updates and reads back row by row.
- `skipDuplicates` runs row by row catching only unique conflicts, to keep the count accurate.
- Arithmetic updates read back row by row to check whether results stay within the safe-integer range.

### Transactions and Connections

Each root request acquires its own connection from the pool, and the whole nested query tree or write graph uses that one connection. Writes are wrapped in a transaction automatically; plain reads do not open one.

- All three isolation levels are supported, set via `SET TRANSACTION ISOLATION LEVEL`.
- When the level is omitted, the session default applies (`REPEATABLE READ` on MySQL).
- A failed `ROLLBACK` destroys the connection instead of returning it to the pool.
- `$close()` closes the connection pool the adapter created.

Common behavior is in [Transactions](../client/transactions.md).

### Error Mapping

| MySQL error number   | Error code               |
| -------------------- | ------------------------ |
| 1062                 | `UNIQUE_CONSTRAINT`      |
| 1451, 1452           | `FOREIGN_KEY_CONSTRAINT` |
| 1048                 | `NOT_NULL_CONSTRAINT`    |
| 3819, 4025           | `CHECK_CONSTRAINT`       |
| 1213                 | `TRANSACTION_DEADLOCK`   |
| 1205                 | `LOCK_TIMEOUT`           |
| Other                | `DATABASE_ERROR`         |

### Related Links

- [MariaDB Connector Promise API](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api)
- [MariaDB Connector connection options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options)

## PostgreSQL

Built on `pg` (node-postgres). Supports PostgreSQL 14+; the adapter checks the server version at startup.

### Connection

```ts
import { createClient } from './generated/client.ts';
import { postgres } from '@ofis/tsorm/adapters/postgres';

const db = await createClient({
  adapter: postgres({
    connection: {
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
    },
    dbSchema: 'public',
  }),
});
```

| Option       | Type         | Default  | Description                                        |
| ------------ | ------------ | -------- | -------------------------------------------------- |
| `connection` | `PoolConfig` | Required | `pg` connection pool config, including SSL         |
| `dbSchema`   | `string`     | `public` | Target schema; must already exist and cannot be a system schema |
| `initialize` | `boolean`    | `false`  | Create all tables in an empty schema, see below    |

::: warning Type parsers
Do not replace `pg`'s default type parsers in `connection`, or `bigint` may be rounded to `number` before the range check. The adapter never mutates `pg.types` globally.
:::

#### Session Settings

The adapter sets `search_path`, the UTC timezone, and `standard_conforming_strings` on every connection it checks out.

### Type Details

- `int8` and `count` are returned as strings by default, and the adapter converts them to `number` after a range check.
- Booleans use the native `BOOLEAN`, with no extra value `CHECK`.
- Auto keys use `GENERATED ALWAYS AS IDENTITY`, and the database also rejects explicit writes.
- All identifiers are limited to 63 UTF-8 bytes to avoid silent truncation causing name collisions.
- Index size is still bound by PostgreSQL's actual index entry size limit.
- Ordering explicitly uses `ASC NULLS FIRST` and `DESC NULLS LAST`.
- `LIKE` follows PostgreSQL's case semantics.

### Initialization

`initialize: true` requires the target schema to have no tables, views, or sequences, otherwise `DATABASE_NOT_EMPTY` is raised. If the target schema does not exist, `SCHEMA_NOT_FOUND` is raised.

Initialization runs in one transaction and rolls back all DDL on failure. It holds an advisory lock scoped to the database and schema: under concurrent initialization, the later arrival waits for the lock to release, then is rejected because the schema is not empty.

`initialize` never drops existing tables; use [versioned migrations](./migrations.md) for schema upgrades. Omit it when reconnecting to an existing database.

Export the table-creation SQL without connecting (`DATABASE_URL` only determines the database type):

```bash
DATABASE_URL=postgresql://user:pass@host:5432/app tsorm diff --from empty
```

When running it manually, set the correct `search_path` and enable `standard_conforming_strings`.

For schema upgrades of an existing database, use [versioned migrations](./migrations.md). The `schema` parameter of `DATABASE_URL` corresponds to `dbSchema`. Migrations need `CREATEDB` permission to create the shadow database, or set `SHADOW_DATABASE_URL`.

### Writes

- `INSERT` and `UPDATE` use `RETURNING` to obtain the record actually written.
- Bulk write returning and native `ON CONFLICT DO UPDATE` are supported; conditions are in [upsert](../client/writes.md#upsert).

### Transactions and Connections

Each root request acquires its own connection from the pool, and the whole nested query tree or write graph uses that one connection. Writes are wrapped in a transaction automatically; plain reads do not open one.

- All three isolation levels are supported, set via `BEGIN ISOLATION LEVEL`.
- When the level is omitted, the session default applies (`READ COMMITTED` on PostgreSQL), and calling `findManyAndCount` inside a transaction then raises `TRANSACTION_ISOLATION`.
- A failed `ROLLBACK` discards the connection instead of returning it to the pool.
- `$close()` closes the connection pool the adapter created.
- The adapter registers `error` listeners on the pool so that idle connection failures do not become unhandled exceptions. These errors are not logged separately.

Common behavior is in [Transactions](../client/transactions.md).

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
