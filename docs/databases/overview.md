---
description: Capabilities, type mapping, and behavioral differences across SQLite, MySQL / MariaDB, and PostgreSQL.
---

# Capability Matrix

The three databases share one model syntax, one set of generated types, and one client API. Configuration details are on each database page.

## Overview

| Item             | SQLite                        | MySQL / MariaDB                | PostgreSQL                     |
| ---------------- | ----------------------------- | ------------------------------ | ------------------------------ |
| Server version   | No server needed              | MySQL 8.0.16+ / MariaDB 10.6+  | 14+                            |
| Driver           | `node:sqlite`                 | `mariadb`                      | `pg`                           |
| Connection       | Single synchronous connection | Connection pool (configurable) | Connection pool (configurable) |
| Placeholder      | `?`                           | `?`                            | `$1`, `$2`                     |
| Identifier quote | Double quotes                 | Backticks                      | Double quotes                  |

## Client Capabilities

Fields of [`db.$capabilities`](../client/overview.md#reading-database-capabilities):

| Field             | SQLite         | MySQL / MariaDB | PostgreSQL |
| ----------------- | -------------- | --------------- | ---------- |
| `returning`       | Yes            | No              | Yes        |
| `isolationLevels` | `serializable` | All three       | All three  |

## Feature Differences

| Feature                                             | SQLite | MySQL / MariaDB | PostgreSQL |
| --------------------------------------------------- | ------ | --------------- | ---------- |
| CRUD, relation queries, nested writes, aggregations | Yes    | Yes             | Yes        |
| Soft delete, typed JSON, virtual fields             | Yes    | Yes             | Yes        |
| Versioned migrations                                | Yes    | Yes             | Yes        |
| `createManyAndReturn`, `updateManyAndReturn`        | Yes    | Yes ¹           | Yes        |
| `upsert`                                            | Yes    | Yes ²           | Yes        |
| Automatic rollback on migration failure             | Yes    | No ³            | Yes        |

1. No `RETURNING` on MySQL / MariaDB: bulk returning uses per-row writes and primary-key readback; see [Create](../client/create.md#database-differences) and [Update](../client/update.md#database-differences).
2. A single native statement when conditions allow: `ON CONFLICT DO UPDATE` on SQLite and PostgreSQL, `ON DUPLICATE KEY UPDATE` on MySQL; MySQL's conditions are stricter, see [upsert](../client/update.md#upsert).
3. MySQL DDL implicitly commits; keep each migration doing one thing and inspect failures manually before `resolve`. Isolation levels: [Transactions](../client/transactions.md#isolation-levels).

## Type Mapping

| Model type            | SQLite                       | MySQL / MariaDB               | PostgreSQL                                |
| --------------------- | ---------------------------- | ----------------------------- | ----------------------------------------- |
| `int`, `bigint`       | `INTEGER`                    | `BIGINT`                      | `BIGINT`                                  |
| `number`              | `REAL`                       | `DOUBLE`                      | `DOUBLE PRECISION`                        |
| `decimal(p, s)`       | `NUMERIC` (numeric affinity) | `DECIMAL(p, s)`               | `NUMERIC(p, s)`                           |
| `string`, `string(n)` | `TEXT` + length `CHECK`      | `VARCHAR(n)`                  | `VARCHAR(n)`                              |
| `text`                | `TEXT`                       | `LONGTEXT`                    | `TEXT`                                    |
| `boolean`             | `INTEGER` + value `CHECK`    | `TINYINT(1)` + value `CHECK`  | `BOOLEAN`                                 |
| `datetime`            | `TEXT`                       | `DATETIME(3)`                 | `TIMESTAMP(3) WITH TIME ZONE`             |
| `timestamp`           | `INTEGER`                    | `BIGINT`                      | `BIGINT`                                  |
| `json<T>`             | `TEXT` + JSON-valid `CHECK`  | `JSON`                        | `JSONB`                                   |
| `bytes`               | `BLOB`                       | `LONGBLOB`                    | `BYTEA`                                   |
| String union          | `TEXT` + enum `CHECK`        | `VARCHAR(191)` + enum `CHECK` | `VARCHAR(191)` + enum `CHECK`             |
| `int @id @auto`       | `INTEGER` + `AUTOINCREMENT`  | `BIGINT` + `AUTO_INCREMENT`   | `BIGINT` + `GENERATED ALWAYS AS IDENTITY` |

`string(n)` defaults to `n = 191`: `string` is `VARCHAR(191)` on MySQL and PostgreSQL and a length-checked `TEXT` on SQLite, see [Why `string` Defaults to 191](../schema/overview.md#why-string-defaults-to-191). `text` is unbounded (`LONGTEXT` on MySQL, `TEXT` elsewhere) and cannot be a key or indexed, because MySQL cannot index `LONGTEXT` without a prefix. Client result types are uniform; storage precision and limits still differ:

| Model type              | Client value                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `int`                   | A `number` within the safe range; out of range raises `NUMERIC_OVERFLOW`, never losing precision |
| `bigint`                | Decimal integer string preserving integer precision                                              |
| `number`                | A finite `number`                                                                                |
| `decimal`               | A string, for example `"1234.50"`; SQLite may lose precision through floating-point storage      |
| `string`                | `string`, length validated by Unicode code points                                                |
| `text`                  | `string`, no length limit                                                                        |
| `boolean`               | `boolean`                                                                                        |
| `datetime`, `timestamp` | `Date` object                                                                                    |
| `json<T>`               | A structurally validated JSON value                                                              |
| `bytes`                 | `Uint8Array`                                                                                     |
| String union            | A TypeScript string union                                                                        |
| `int @id @auto`         | `number`, generated automatically on create                                                      |

Generated foreign keys inherit the target field's type and length; `@map` and `@@map` change names, not types.

## Common Query Semantics

- Empty collection filters: `in: []` matches nothing, `notIn: []` matches everything; `NULL` sorts first ascending, last descending; ordering is stable (primary key appended automatically); relation pagination is per parent, at most 200 parent keys per batch.

## Remaining Differences

- **String semantics**: collation, case, `LIKE`, and trailing-space comparison follow each database's own rules.
- **Index limits and concurrency**: indexed byte length, row size, locks, deadlocks, and transaction conflicts are decided by the server.

## Next Steps

- [Adapters](./adapters/overview.md): connection options and type details per adapter
- [Versioned Migrations](./migrations.md): applying schema changes to a real database
- [Transactions](../client/transactions.md): isolation levels and failure semantics
