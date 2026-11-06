---
description: All methods, parameters, and return values provided by the generated client.
---

# Client API

This page lists every member the generated client provides. Usage and examples are in the [Client](../client/overview.md) chapter.

## Client Methods

| Member          | Return value         | Description                                           |
| --------------- | -------------------- | ----------------------------------------------------- |
| `$transaction`  | The callback's return value | Run a transaction, see [Transactions](../client/transactions.md) |
| `$queryRaw`     | `Promise<T>`         | Run a raw query, see [Raw SQL](../client/raw-sql.md)  |
| `$executeRaw`   | `Promise<number>`    | Run a raw write, returns the affected row count       |
| `$capabilities` | `Capabilities`       | Read-only property, the current adapter's capabilities |
| `$close`        | `Promise<void>`      | Wait for in-flight requests, then close connections   |

The `tx` of a transaction callback provides the model methods, `$queryRaw`, and `$executeRaw`.

## Read Methods

| Method            | Main parameters                                                                      | Return value           |
| ----------------- | ------------------------------------------------------------------------------------ | ---------------------- |
| `findMany`        | `where`, `orderBy`, `skip`, `take`, `cursor`, `distinct`, `deleted`, projection      | `T[]`                  |
| `findFirst`       | Same as `findMany`                                                                   | `T \| null`            |
| `findFirstOrThrow`| Same as `findMany`                                                                   | `T`                    |
| `findUnique`      | `where` (unique key), `deleted`, projection                                          | `T \| null`            |
| `findUniqueOrThrow` | `where` (unique key), `deleted`, projection                                        | `T`                    |
| `findManyAndCount`| Same as `findMany`                                                                   | `{ data: T[]; total: number }` |
| `count`           | `where`, `distinct`, `deleted`                                                       | `number`               |
| `aggregate`       | `where`, `deleted`, `orderBy`, `skip`, `take`, aggregation options                   | Aggregation result     |
| `groupBy`         | `by`, `where`, `having`, `orderBy`, `skip`, `take`, aggregation options              | Array of group results |

Projection means `select`, or the combination of `include` and `omit`.

## Write Methods

| Method              | Main parameters                         | Return value           |
| ------------------- | --------------------------------------- | ---------------------- |
| `create`            | `data`, projection                      | `T`                    |
| `createMany`        | `data[]`, `skipDuplicates`              | `{ count: number }`    |
| `createManyAndReturn` | `data[]`, `skipDuplicates`, projection | `T[]`                  |
| `update`            | `where` (unique key), `data`, projection | `T`                   |
| `updateMany`        | `where`, `data`                         | `{ count: number }`    |
| `updateManyAndReturn` | `where`, `data`, projection            | `T[]`                  |
| `upsert`            | `where` (unique key), `create`, `update`, projection | `T`     |
| `delete`            | `where` (unique key), projection        | `T`                    |
| `deleteMany`        | `where`                                 | `{ count: number }`    |

On MySQL, `createManyAndReturn` and `updateManyAndReturn` are implemented as per-row writes within a transaction, see [Writes](../client/writes.md#database-differences).

## Soft Delete Methods

| Method          | Main parameters       | Return value          |
| --------------- | --------------------- | --------------------- |
| `restore`       | `where` (unique key), projection | `T`        |
| `restoreMany`   | `where`               | `{ count: number }`   |
| `forceDelete`   | `where` (unique key), projection | `T`        |
| `forceDeleteMany` | `where`             | `{ count: number }`   |

## Limits

| Item                    | Upper bound                |
| ----------------------- | -------------------------- |
| `where` nesting depth   | 12                         |
| `having` nesting depth  | 12                         |
| Projection nesting depth | 8                         |
| Nested write depth      | 8                          |
| JSON nesting depth      | 64                         |
| Parent keys per relation-load batch | 200            |
| Parameters per `createMany` batch | ~900 (conservative budget) |
| `string(n)` length      | 16383                      |

## Package Entrypoints

| Entrypoint                        | Contents                                                             |
| --------------------------------- | -------------------------------------------------------------------- |
| `@ofis/tsorm`                     | `OrmError`, `sql`, `DbNull`, `JsonNull`, `virtualField`, and common types |
| `@ofis/tsorm/adapters`            | All adapters and DDL functions such as `sqliteSchemaSQL`             |
| `@ofis/tsorm/adapters/sqlite`     | `sqlite`, `sqliteSchemaSQL`                                          |
| `@ofis/tsorm/adapters/mysql`      | `mysql`, `mysqlSchemaSQL`                                            |
| `@ofis/tsorm/adapters/postgres`   | `postgres`, `postgresSchemaSQL`                                      |
| `@ofis/tsorm/schema`              | `parseSchema`, `generateClient`, `SchemaError`                       |
| `@ofis/tsorm/migrations`          | `migrate`, `deploy`, `status`, `resolve`, `diff`, `push`, and `MigrationError` |

## Generated Types

For each model, the generated client exports types such as `<Model>Row`, `<Model>Create`, `<Model>Update`, `<Model>ScalarCreate`, `<Model>ScalarUpdate`, and `<Model>Unique`, for example `UserRow`.
