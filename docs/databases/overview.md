---
description: Capabilities, type mapping, and behavioral differences across SQLite, MySQL / MariaDB, and PostgreSQL.
---

# Capability Matrix

The three databases share one model syntax, one set of generated types, and one client API. This page summarizes their differences; configuration details are on each database page.

## Overview

| Item            | SQLite                    | MySQL / MariaDB                | PostgreSQL     |
| --------------- | ------------------------- | ------------------------------ | -------------- |
| Server version  | No server needed          | MySQL 8.0+ / MariaDB 10.6+  | 14+            |
| Driver          | `node:sqlite`             | `mariadb`                      | `pg`           |
| Connection      | Single synchronous connection | Connection pool            | Connection pool |
| Placeholder     | `?`                       | `?`                            | `$1`, `$2`     |
| Identifier quote| Double quotes             | Backticks                      | Double quotes  |

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

Every feature is available on all three databases; they differ only in implementation and in the databases' own limits:

| Feature                                        | SQLite | MySQL / MariaDB | PostgreSQL |
| ---------------------------------------------- | ------ | --------------- | ---------- |
| CRUD, relation queries, nested writes, aggregations | Yes | Yes            | Yes        |
| Soft delete, typed JSON, virtual fields        | Yes    | Yes             | Yes        |
| Versioned migrations                           | Yes    | Yes             | Yes        |
| `createManyAndReturn`, `updateManyAndReturn`   | Yes    | Yes ¹           | Yes        |
| `upsert`                                       | Yes    | Yes ²           | Yes        |
| Automatic rollback on migration failure        | Yes    | No ³            | Yes        |
| Rollback on initialization DDL failure         | Yes    | No ³            | Yes        |

1. MySQL has no `RETURNING`, so the ORM inserts row by row within one transaction and reads back by `insertId`, or selects the matching primary keys first and updates row by row. The result is identical but slower than a single statement.
2. A single native statement is used when conditions allow: `ON CONFLICT DO UPDATE` on SQLite and PostgreSQL, and `ON DUPLICATE KEY UPDATE` on MySQL. MySQL's conditions are stricter because that statement fires on any unique key conflict, see [upsert](../client/writes.md#upsert).
3. MySQL's DDL implicitly commits the transaction, which is a limitation of the database itself. Keep each migration doing one thing, and on failure inspect manually before handling it with `resolve`.

Isolation level details are in [Transactions](../client/transactions.md#isolation-levels), and bulk write differences are in [Writes](../client/writes.md#database-differences).

## Type Mapping

| Model type      | SQLite                    | MySQL / MariaDB             | PostgreSQL                       |
| --------------- | ------------------------- | --------------------------- | -------------------------------- |
| `int`, `bigint` | `INTEGER`                 | `BIGINT`                    | `BIGINT`                         |
| `number`        | `REAL`                    | `DOUBLE`                    | `DOUBLE PRECISION`               |
| `decimal(p, s)` | `NUMERIC` (stored as float) | `DECIMAL(p, s)`           | `NUMERIC(p, s)`                  |
| `string`        | `TEXT`                    | `LONGTEXT`                  | `TEXT`                           |
| `string(n)`     | `TEXT` + length `CHECK`   | `VARCHAR(n)`                | `VARCHAR(n)`                     |
| `boolean`       | `INTEGER` + value `CHECK` | `TINYINT(1)` + value `CHECK` | `BOOLEAN`                       |
| `date`          | `TEXT`                    | `DATETIME(3)`               | `TIMESTAMP(3) WITHOUT TIME ZONE` |
| `json<T>`       | `TEXT` + JSON-valid `CHECK` | `JSON`                    | `JSONB`                          |
| `bytes`         | `BLOB`                    | `LONGBLOB`                | `BYTEA`                          |
| String union    | `TEXT` + enum `CHECK`     | `LONGTEXT` + enum `CHECK`   | `TEXT` + enum `CHECK`            |
| `int @id @auto` | `INTEGER` + `AUTOINCREMENT` | `BIGINT` + `AUTO_INCREMENT` | `BIGINT` + `GENERATED ALWAYS AS IDENTITY` |

The values delivered to the client are identical across the three databases:

| Model type      | Client value                                                      |
| --------------- | ----------------------------------------------------------------- |
| `int`           | A `number` within the safe range; out of range raises `NUMERIC_OVERFLOW`, never losing precision |
| `bigint`        | JavaScript `bigint`, not limited by the safe-integer range        |
| `number`        | A finite `number`                                                 |
| `decimal`       | A string, for example `"1234.50"`; accurate up to about 15 significant digits on SQLite |
| `string`        | `string`, length validated by Unicode code points                 |
| `boolean`       | `boolean`                                                         |
| `date`          | A millisecond-precision local date-time string                    |
| `json<T>`       | A structurally validated JSON value                               |
| `bytes`         | `Uint8Array`                                                      |
| String union    | A TypeScript string union                                         |
| `int @id @auto` | `number`, cannot be assigned explicitly on create                 |

Generated foreign keys inherit the target field's type and length. `@map` and `@@map` change the column and table names in the database, not the types.

## Common Query Semantics

The following behaviors are uniform across the three databases:

- Empty collection filters: `in: []` matches nothing, `notIn: []` matches everything.
- `NULL` ordering: first in ascending, last in descending.
- Stable ordering: the primary key is appended automatically.
- Relation pagination is computed independently per parent record, at most 200 parent keys per batch.

## Remaining Differences

- **String semantics**: collation, case, `LIKE`, and trailing-space comparison follow each database's own rules.
- **Date range**: the storable range depends on the database; the MySQL adapter validates the year as 1000 to 9999.
- **Index limits**: the actual indexed byte length, composite indexes, and total row size are decided by the server.
- **Concurrency behavior**: locks, deadlocks, and transaction conflicts are decided by the database.
