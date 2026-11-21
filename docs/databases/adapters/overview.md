---
description: The three database adapters share one model syntax and one client API; pick the page for SQLite, MySQL / MariaDB, or PostgreSQL.
---

# Adapters

The three adapters share one model syntax and one client API, so switching databases needs no regeneration; what differs is the driver, the connection model, and a few type rules. Each pins driver options and session settings and maps driver errors to the same error codes; physical type mappings are in [Type Mapping](../overview.md#type-mapping). `createClient` picks the adapter from the connection URL scheme, and the driver loads and connects on the first database operation, so creating a client neither loads a driver nor touches the database.

## Adapter Matrix

| Adapter                       | Connection model                            |
| ----------------------------- | ------------------------------------------- |
| [SQLite](./sqlite.md)         | One synchronous connection, queued requests |
| [MySQL / MariaDB](./mysql.md) | Pool, one connection per root request       |
| [PostgreSQL](./postgres.md)   | Pool, one connection per root request       |

Each root request's nested query tree or write graph stays on that connection; a shared connection alone does not guarantee a shared snapshot — see [Transactions](../../client/transactions.md). Versions, drivers, and capabilities are in the [Capability Matrix](../overview.md).

## Initialization and Upgrades

Adapters do not create tables. Use [`tsorm push`](../migrations.md#push) while prototyping and [versioned migrations](../migrations.md) for schema creation and upgrades.

## Choosing an Adapter

- [SQLite](./sqlite.md): a single file or in-memory database, no server, single-connection transactions. Fits tests, local development, and single-node deployments.
- [MySQL / MariaDB](./mysql.md): MySQL 8.0.16+ or MariaDB 10.6+ with InnoDB. DDL commits implicitly, so a failed migration needs manual inspection and cleanup.
- [PostgreSQL](./postgres.md): PostgreSQL 14+, with a `schema` query parameter, native `BOOLEAN` and `IDENTITY` types.

## Next Steps

- [SQLite](./sqlite.md), [MySQL / MariaDB](./mysql.md), [PostgreSQL](./postgres.md): connection options, type details, initialization, writes, transactions, and error mapping for each adapter
- [Capability Matrix](../overview.md): what each database supports, side by side
- [Versioned Migrations](../migrations.md): diffing a schema and applying migrations in order
