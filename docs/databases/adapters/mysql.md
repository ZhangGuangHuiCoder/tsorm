---
description: The MySQL / MariaDB adapter runs on the mariadb connector with a connection pool, pinned driver options, UTF-8 binary collation, and implicit DDL commits.
---

# MySQL / MariaDB

## Overview

Built on the `mariadb` Node.js Promise client. Supports MySQL 8.0.16+ and MariaDB 10.6+; the server version is checked on the first operation, not at client creation.

- Driver: `mariadb`
- Connections: a pool; every root request gets its own connection
- Write results: primary-key readback; this adapter does not use `RETURNING`
- Transactions: writes are wrapped automatically, plain reads are not
- Isolation levels: all three, set via `SET TRANSACTION ISOLATION LEVEL`

Physical type mappings are in [Type Mapping](../overview.md#type-mapping).

## Definition

### Connection Options

| Option       | Type     | Default  | Description                                    |
| ------------ | -------- | -------- | ---------------------------------------------- |
| `connection` | `string` | Required | MySQL URL; driver options use query parameters |

### Connection Pool

The pool is configured in the connection URL using the mariadb driver parameter names:

| URL parameter     | Description                                                            | Default                          |
| ----------------- | ---------------------------------------------------------------------- | -------------------------------- |
| `connectionLimit` | Maximum connections in the pool                                        | `2 × availableParallelism() + 1` |
| `minimumIdle`     | Connections kept idle once opened                                      | same as `connectionLimit`        |
| `acquireTimeout`  | How long an acquire waits for a free connection, in milliseconds       | 10000 ms                         |
| `idleTimeout`     | Idle time before a connection is closed, in seconds; `0` keeps it open | 1800 s                           |

The adapter reads these parameters from the URL, fills in only the default `connectionLimit`, and rejects invalid values before connecting. Only `mysql://…` and `mariadb://…` URLs are accepted.

```ts
const db = createClient({
  connection: "mysql://app:password@localhost:3306/app?connectionLimit=20&minimumIdle=2&acquireTimeout=5000&idleTimeout=1800",
});
```

### Pinned Driver Options

The adapter pins these options for correct decoding; same-named settings in `connection` are overridden:

`autoJsonMap`, `bigIntAsNumber`, `insertIdAsNumber`, `multipleStatements`, `decimalAsNumber`, `dateStrings`

### Session Settings

Every connection the adapter checks out gets strict write mode and `NO_BACKSLASH_ESCAPES`. The session timezone is changed only by the driver's `timezone` option, which runs `SET time_zone` on every connection it initializes.

```ts
// +08:00 works as is: query strings decode + to a leading space, and the adapter restores the sign before connecting
createClient({ connection: "mysql://app:password@localhost:3306/app?timezone=+08:00" });
// %2B is the percent-encoding of +, equivalent
createClient({ connection: "mysql://app:password@localhost:3306/app?timezone=%2B08%3A00" });
// IANA zone names work too
createClient({ connection: "mysql://app:password@localhost:3306/app?timezone=Asia/Shanghai" });
```

`DATETIME` carries no timezone: the driver serializes a `Date` and parses it using the connection `timezone` (local by default). Database defaults (`CURRENT_TIMESTAMP`) use the server timezone — set `timezone` to the server timezone when ORM writes and database defaults must agree. `timestamp` stores Unix milliseconds and ignores the session timezone.

### Authentication

MySQL 8.4 defaults to `caching_sha2_password`; production should configure TLS or a trusted server public key (`cachingRsaPublicKey`). The adapter never enables `allowPublicKeyRetrieval` by default.

### Type Details

- `string` generates `VARCHAR(n)`, `n` defaulting to 191 when omitted — covering InnoDB's 767-byte index key limit under `utf8mb4`; see [Why `string` Defaults to 191](../../schema/overview.md#why-string-defaults-to-191).
- `text` generates `LONGTEXT` without a length check; it cannot be a key or indexed, and the ORM never generates prefix indexes.
- Table creation pins `utf8mb4_bin`, whose comparison includes `PAD SPACE`; relation grouping treats trailing spaces the same way. Existing databases should adopt the generated DDL's types and collation — the ORM does not guarantee equivalent query behavior on arbitrary external tables.
- Bigint results use decimal strings; model `int` fields are converted after a safe-integer range check.
- Non-unique relation columns are indexed explicitly, independent of InnoDB's foreign-key index. `//` comments render as inline `COMMENT` clauses; migrations apply comment changes with `ALTER TABLE`.

## Example

### Creating a Client

`createClient` picks the adapter from the URL scheme:

```ts
import { createClient } from "./generated/client.ts";

const db = createClient({
  connection: "mysql://app:password@localhost:3306/app",
});
```

### Initialization

Create the tables with [`tsorm push`](../migrations.md#push) or versioned migrations; the adapter itself never creates tables. To export the table-creation SQL without connecting (`DATABASE_URL` only determines the database type):

```bash
DATABASE_URL=mysql://user:pass@host:3306/app tsorm diff --from empty
```

Run it manually with `NO_BACKSLASH_ESCAPES` and strict write mode configured.

### Writes

- Writes read back by primary key inside a transaction; auto-generated inserts use `insertId`, others the supplied primary key.
- `upsert` uses `ON DUPLICATE KEY UPDATE` when the record can only conflict on the `where` unique key, otherwise read-then-write in one transaction; see [upsert](../../client/update.md#upsert).
- `createManyAndReturn` inserts row by row in a transaction and reads back by primary keys; `updateManyAndReturn` selects matching primary keys first, then updates and reads back row by row.
- `skipDuplicates` runs row by row catching only unique conflicts, to keep the count accurate.
- Arithmetic updates read back row by row to validate results, including the safe-integer range for `int` fields.

## Notes

### Transactions and Connections

Each root request acquires one connection from the pool for its whole nested query tree or write graph; writes are wrapped in a transaction, plain reads execute directly.

- All three isolation levels, set via `SET TRANSACTION ISOLATION LEVEL`; the session default applies when omitted (`REPEATABLE READ` on MySQL). Common behavior is in [Transactions](../../client/transactions.md).
- A failed `ROLLBACK` destroys the connection instead of returning it to the pool; `$close()` closes the pool.

### Migration Caveats

MySQL's DDL commits individually, so statements already executed by a failed migration remain; see [Failure and Repair](../migrations.md#resolve). Migrations need permission to create the shadow database, or set `SHADOW_DATABASE_URL`.

### Error Mapping

| MySQL error number | Error code               |
| ------------------ | ------------------------ |
| 1062               | `UNIQUE_CONSTRAINT`      |
| 1451, 1452         | `FOREIGN_KEY_CONSTRAINT` |
| 1048               | `NOT_NULL_CONSTRAINT`    |
| 3819, 4025         | `CHECK_CONSTRAINT`       |
| 1213               | `TRANSACTION_DEADLOCK`   |
| 1205               | `LOCK_TIMEOUT`           |
| 1317               | `QUERY_CANCELLED`        |
| Other              | `DATABASE_ERROR`         |

### Related Links

- [MariaDB Connector Promise API](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api)
- [MariaDB Connector connection options](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options)

## Next Steps

- [PostgreSQL](./postgres.md): a pooled adapter with native `RETURNING` and schema support
- [SQLite](./sqlite.md): the single-connection adapter
- [Versioned Migrations](../migrations.md): how migration failures are recorded and repaired
