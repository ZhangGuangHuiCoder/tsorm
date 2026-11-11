---
description: Capabilities, type mapping, and behavioral differences across SQLite, MySQL / MariaDB, and PostgreSQL.
---

# Capability Matrix

The three databases share one model syntax, one set of generated types, and one client API. This page summarizes their differences; configuration details are on each database page.

## Overview

| Item             | SQLite                        | MySQL / MariaDB               | PostgreSQL      |
| ---------------- | ----------------------------- | ----------------------------- | --------------- |
| Server version   | No server needed              | MySQL 8.0.16+ / MariaDB 10.6+ | 14+             |
| Driver           | `node:sqlite`                 | `mariadb`                     | `pg`            |
| Connection       | Single synchronous connection | Connection pool               | Connection pool |
| Placeholder      | `?`                           | `?`                           | `$1`, `$2`      |
| Identifier quote | Double quotes                 | Backticks                     | Double quotes   |

## Client Capabilities

The table below maps to the fields of [`db.$capabilities`](../client/overview.md#reading-database-capabilities):

| Field                 | SQLite         | MySQL / MariaDB | PostgreSQL |
| --------------------- | -------------- | --------------- | ---------- |
| `returning`           | Yes            | No              | Yes        |
| `windowFunctions`     | Yes            | Yes             | Yes        |
| `transactionalDDL`    | Yes            | No              | Yes        |
| `versionedMigrations` | Yes            | Yes             | Yes        |
| `isolationLevels`     | `serializable` | All three       | All three  |

## Feature Differences

The ORM targets the same feature set on all three databases; differences are in implementation and each database's own limits:

| Feature                                             | SQLite | MySQL / MariaDB | PostgreSQL |
| --------------------------------------------------- | ------ | --------------- | ---------- |
| CRUD, relation queries, nested writes, aggregations | Yes    | Yes             | Yes        |
| Soft delete, typed JSON, virtual fields             | Yes    | Yes             | Yes        |
| Versioned migrations                                | Yes    | Yes             | Yes        |
| `createManyAndReturn`, `updateManyAndReturn`        | Yes    | Yes ¹           | Yes        |
| `upsert`                                            | Yes    | Yes ²           | Yes        |
| Automatic rollback on migration failure             | Yes    | No ³            | Yes        |
| Rollback on initialization DDL failure              | Yes    | No ³            | Yes        |

1. The MySQL / MariaDB adapter does not use `RETURNING`. Bulk returning uses per-row writes and primary-key readback, requiring additional SQL; see the write pages below for details.
2. A single native statement is used when conditions allow: `ON CONFLICT DO UPDATE` on SQLite and PostgreSQL, and `ON DUPLICATE KEY UPDATE` on MySQL. MySQL's conditions are stricter because that statement fires on any unique key conflict, see [upsert](../client/update.md#upsert).
3. MySQL's DDL implicitly commits the transaction, which is a limitation of the database itself. Keep each migration doing one thing, and on failure inspect manually before handling it with `resolve`.

Isolation level details are in [Transactions](../client/transactions.md#isolation-levels), and bulk write differences are in [Create](../client/create.md#database-differences) and [Update](../client/update.md#database-differences).

## Type Mapping

| Model type            | SQLite                       | MySQL / MariaDB               | PostgreSQL                                |
| --------------------- | ---------------------------- | ----------------------------- | ----------------------------------------- |
| `int`, `bigint`       | `INTEGER`                    | `BIGINT`                      | `BIGINT`                                  |
| `number`              | `REAL`                       | `DOUBLE`                      | `DOUBLE PRECISION`                        |
| `decimal(p, s)`       | `NUMERIC` (numeric affinity) | `DECIMAL(p, s)`               | `NUMERIC(p, s)`                           |
| `string`, `string(n)` | `TEXT` + length `CHECK`      | `VARCHAR(n)`                  | `VARCHAR(n)`                              |
| `text`                | `TEXT`                       | `LONGTEXT`                    | `TEXT`                                    |
| `boolean`             | `INTEGER` + value `CHECK`    | `TINYINT(1)` + value `CHECK`  | `BOOLEAN`                                 |
| `datetime`            | `TEXT`                       | `DATETIME(3)`                 | `TIMESTAMP(3) WITHOUT TIME ZONE`          |
| `timestamp`           | `INTEGER`                    | `BIGINT`                      | `BIGINT`                                  |
| `json<T>`             | `TEXT` + JSON-valid `CHECK`  | `JSON`                        | `JSONB`                                   |
| `bytes`               | `BLOB`                       | `LONGBLOB`                    | `BYTEA`                                   |
| String union          | `TEXT` + enum `CHECK`        | `VARCHAR(191)` + enum `CHECK` | `VARCHAR(191)` + enum `CHECK`             |
| `int @id @auto`       | `INTEGER` + `AUTOINCREMENT`  | `BIGINT` + `AUTO_INCREMENT`   | `BIGINT` + `GENERATED ALWAYS AS IDENTITY` |

`n` in `string(n)` defaults to 191 when the length is omitted, so `string` is `VARCHAR(191)` on MySQL and PostgreSQL and a length-checked `TEXT` on SQLite; the reason for that default is explained in [Why `string` Defaults to 191](../schema/overview.md#why-string-defaults-to-191). `text` is unbounded: MySQL stores it as `LONGTEXT` (reducing inline row-size pressure, while still subject to database limits), and PostgreSQL and SQLite store it as `TEXT` without a length check. Because MySQL cannot index `LONGTEXT` without a prefix, `text` fields cannot be keys or indexed.

The client uses the following result types across adapters; storage precision and database limits still differ:

| Model type              | Client value                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `int`                   | A `number` within the safe range; out of range raises `NUMERIC_OVERFLOW`, never losing precision |
| `bigint`                | Decimal integer string preserving integer precision                                              |
| `number`                | A finite `number`                                                                                |
| `decimal`               | A string, for example `"1234.50"`; SQLite may lose precision through floating-point storage      |
| `string`                | `string`, length validated by Unicode code points                                                |
| `text`                  | `string`, no length limit                                                                        |
| `boolean`               | `boolean`                                                                                        |
| `datetime`, `timestamp` | Millisecond-precision string in `local` or `utc` format, selected by `datetimeFormat`            |
| `json<T>`               | A structurally validated JSON value                                                              |
| `bytes`                 | `Uint8Array`                                                                                     |
| String union            | A TypeScript string union                                                                        |
| `int @id @auto`         | `number`, generated automatically on create                                                      |

Generated foreign keys inherit the target field's type and length. `@map` and `@@map` change the column and table names in the database, not the types.

## Common Query Semantics

The following behaviors are uniform across the three databases:

- Empty collection filters: `in: []` matches nothing, `notIn: []` matches everything.
- `NULL` ordering: first in ascending, last in descending.
- Stable ordering: the primary key is appended automatically.
- Relation pagination is computed independently per parent record, at most 200 parent keys per batch.

## Remaining Differences

- **String semantics**: collation, case, `LIKE`, and trailing-space comparison follow each database's own rules.
- **Date range**: the storable range depends on the database; the MySQL adapter validates years 1000–9999 for `datetime`, not integer `timestamp` storage.
- **Index limits**: the actual indexed byte length, composite indexes, and total row size are decided by the server.
- **Concurrency behavior**: locks, deadlocks, and transaction conflicts are decided by the database.

## Next Steps

- [Adapters](./adapters/overview.md): connection options and type details per adapter
- [Versioned Migrations](./migrations.md): applying schema changes to a real database
- [Transactions](../client/transactions.md): isolation levels and failure semantics
