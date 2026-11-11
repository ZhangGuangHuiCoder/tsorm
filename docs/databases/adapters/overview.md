---
description: The three database adapters share one model syntax and one client API; pick the page for SQLite, MySQL / MariaDB, or PostgreSQL.
---

# Adapters

The three adapters share one model syntax and one client API, so switching databases needs no regeneration. What differs is the driver underneath, the connection model, and a handful of type rules. Each adapter pins driver options and session settings so decoded results stay correct, and each one maps its driver errors onto the same error codes. Physical type mappings are in [Type Mapping](../overview.md#type-mapping).

## Adapter Matrix

| Adapter                       | Connection model                            |
| ----------------------------- | ------------------------------------------- |
| [SQLite](./sqlite.md)         | One synchronous connection, queued requests |
| [MySQL / MariaDB](./mysql.md) | Pool, one connection per root request       |
| [PostgreSQL](./postgres.md)   | Pool, one connection per root request       |

Each root request's nested query tree or write graph stays on that connection. Shared connections alone do not guarantee a shared snapshot; see [Transactions](../../client/transactions.md). Versions, drivers, and capabilities are maintained in the [Capability Matrix](../overview.md).

## Initialization and Upgrades

`initialize: true` creates every table and index for a new database. Use migrations for schema upgrades:

| Adapter                       | `initialize: true` requires                                                  | On failure                                               |
| ----------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| [SQLite](./sqlite.md)         | No user tables or views; otherwise `DATABASE_NOT_EMPTY`                      | Rolls back all DDL and closes the connection             |
| [MySQL / MariaDB](./mysql.md) | An empty database, otherwise `DATABASE_NOT_EMPTY`                            | DDL commits implicitly, so some tables may remain behind |
| [PostgreSQL](./postgres.md)   | A schema with no tables, views, or sequences, otherwise `DATABASE_NOT_EMPTY` | Rolls back all DDL and releases the advisory lock        |

For schema upgrades of an existing database, use [versioned migrations](../migrations.md). Initialize a database from one process only.

## Choosing an Adapter

- [SQLite](./sqlite.md): a single file or an in-memory database, no server to run, and a single-connection transaction model. A good fit for tests, local development, and single-node deployments.
- [MySQL / MariaDB](./mysql.md): MySQL 8.0.16+ or MariaDB 10.6+ with InnoDB tables. Its DDL commits implicitly, so a failed migration needs manual inspection and cleanup.
- [PostgreSQL](./postgres.md): PostgreSQL 14+, with `dbSchema` for keeping tables in a dedicated schema and native `BOOLEAN` and `IDENTITY` types.

## Next Steps

- [SQLite](./sqlite.md), [MySQL / MariaDB](./mysql.md), [PostgreSQL](./postgres.md): connection options, type details, initialization, writes, transactions, and error mapping for each adapter
- [Capability Matrix](../overview.md): what each database supports, side by side
- [Versioned Migrations](../migrations.md): diffing a schema and applying migrations in order
