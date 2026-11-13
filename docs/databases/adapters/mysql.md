---
description: The MySQL / MariaDB adapter runs on the mariadb connector with a connection pool, pinned driver options, UTF-8 binary collation, and implicit DDL commits.
---

# MySQL / MariaDB

## Overview

Built on the `mariadb` Node.js Promise client. Supports MySQL 8.0.16+ and MariaDB 10.6+; managed tables must use InnoDB. The adapter checks the server version and the storage engine of existing tables at startup.

- Driver: `mariadb`
- Connections: a pool; every root request gets its own connection
- Write results: primary-key readback; this adapter does not use `RETURNING`
- Transactions: writes are wrapped automatically, plain reads are not
- Isolation levels: all three, set via `SET TRANSACTION ISOLATION LEVEL`

Physical type mappings are in [Type Mapping](../overview.md#type-mapping).

## Definition

### Connection Options

| Option       | Type      | Default  | Description                                       |
| ------------ | --------- | -------- | ------------------------------------------------- |
| `connection` | `string`  | Required | MySQL URL; driver options use query parameters    |
| `initialize` | `boolean` | `false`  | Create all tables in an empty database, see below |

### Pinned Driver Options

To guarantee results decode correctly, the adapter pins the following options; the same-named settings in `connection` are overridden:

`dateStrings`, `timezone`, `autoJsonMap`, `bigIntAsNumber`, `insertIdAsNumber`, `multipleStatements`, `decimalAsNumber`

### Session Settings

The adapter sets a UTC session timezone, strict write mode, and `NO_BACKSLASH_ESCAPES` on every connection it checks out.

### Authentication

MySQL 8.4 defaults to `caching_sha2_password`. Production should configure TLS or a trusted server public key (`cachingRsaPublicKey`). The adapter never enables `allowPublicKeyRetrieval` by default.

### Type Details

- `string` generates `VARCHAR(n)`, with `n` defaulting to 191 when the length is omitted, so string keys and indexes work without extra attributes. The default covers InnoDB's 767-byte index key limit under `utf8mb4`, where one character takes up to 4 bytes; see [Why `string` Defaults to 191](../../schema/overview.md#why-string-defaults-to-191).
- `text` generates `LONGTEXT` without a length check, reducing inline row-size pressure for large text while remaining subject to database limits. It cannot be a key or indexed, and the ORM never generates prefix indexes.
- Table creation pins `utf8mb4_bin`. This collation's comparison semantics include `PAD SPACE`, and application-level relation grouping treats trailing spaces the same way.
- An existing database should adopt the types and collation from the generated DDL; the ORM does not guarantee equivalent query behavior on arbitrary external table structures.
- `datetime` years must be between 1000 and 9999; integer `timestamp` storage is not subject to this DATETIME limit.
- Bigint results use decimal strings. Model `int` fields are converted after a safe-integer range check.
- Non-unique relation columns are indexed explicitly, so the index does not depend on InnoDB creating one for a foreign key.
- `//` comments render as inline `COMMENT` clauses on columns and tables; migrations apply comment changes with `ALTER TABLE`.

## Example

### Creating a Client

```ts
import { createClient } from "./generated/client.ts";
import { mysql } from "@ofis/tsorm/adapters/mysql";

const db = await createClient({
  adapter: mysql({
    connection: "mysql://app:password@localhost:3306/app",
  }),
});
```

### Initialization

`initialize: true` requires the selected database to be empty, otherwise `DATABASE_NOT_EMPTY` is raised. The adapter creates all tables and indexes first, then adds foreign keys, so cyclic model references are supported.

::: danger DDL statements commit individually
MySQL's DDL commits implicitly, so a failed initialization may leave some tables behind, requiring manual inspection and cleanup. Initialize a database from one process only.
:::

Export the table-creation SQL without connecting (`DATABASE_URL` only determines the database type):

```bash
DATABASE_URL=mysql://user:pass@host:3306/app tsorm diff --from empty
```

When running it manually, configure `NO_BACKSLASH_ESCAPES`, strict write mode, and the UTC timezone yourself.

### Writes

- Writes read back by primary key inside a transaction. Auto-generated inserts use `insertId`; other inserts use the supplied primary key.
- `upsert` uses `ON DUPLICATE KEY UPDATE` when the inserted record can only conflict on the `where` unique key; otherwise it reads then writes in one transaction, see [upsert](../../client/update.md#upsert).
- `createManyAndReturn` inserts row by row in a transaction and reads back by generated or supplied primary keys; `updateManyAndReturn` first selects matching primary keys, then updates and reads back row by row.
- `skipDuplicates` runs row by row catching only unique conflicts, to keep the count accurate.
- Arithmetic updates read back row by row to validate results, including the safe-integer range for `int` fields.

## Notes

### Transactions and Connections

Each root request acquires its own connection from the pool, and the whole nested query tree or write graph uses that one connection. Writes are wrapped in a transaction automatically; plain reads execute directly.

- All three isolation levels are supported, set via `SET TRANSACTION ISOLATION LEVEL`.
- When the level is omitted, the session default applies (`REPEATABLE READ` on MySQL).
- A failed `ROLLBACK` destroys the connection instead of returning it to the pool.
- `$close()` closes the connection pool the adapter created.

Common behavior is in [Transactions](../../client/transactions.md).

### Migration Caveats

Because MySQL's DDL statements commit individually, statements already executed by a failed migration remain; see [Failure and Repair](../migrations.md#resolve). Migrations need permission to create the shadow database, or set `SHADOW_DATABASE_URL`.

### Error Mapping

| MySQL error number | Error code               |
| ------------------ | ------------------------ |
| 1062               | `UNIQUE_CONSTRAINT`      |
| 1451, 1452         | `FOREIGN_KEY_CONSTRAINT` |
| 1048               | `NOT_NULL_CONSTRAINT`    |
| 3819, 4025         | `CHECK_CONSTRAINT`       |
| 1213               | `TRANSACTION_DEADLOCK`   |
| 1205               | `LOCK_TIMEOUT`           |
| Other              | `DATABASE_ERROR`         |

### Related Links

- [MariaDB Connector Promise API](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api)
- [MariaDB Connector connection options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options)

## Next Steps

- [PostgreSQL](./postgres.md): a pooled adapter with native `RETURNING` and schema support
- [SQLite](./sqlite.md): the single-connection adapter
- [Versioned Migrations](../migrations.md): how migration failures are recorded and repaired
