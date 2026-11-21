---
description: All methods, parameters, and return values provided by the generated client.
---

# Client API

Every member the generated client provides; usage and examples are in the [Client](../client/overview.md) chapter.

## Client Methods

| Member          | Return value               | Description                                                                                                                                                                                         |
| --------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$transaction`  | `Promise<callback result>` | Run a transaction, see [Transactions](../client/transactions.md)                                                                                                                                    |
| `$queryRaw`     | `Promise<T>`               | Run a raw query, see [Raw SQL](../client/raw-sql.md)                                                                                                                                                |
| `$executeRaw`   | `Promise<number>`          | Run a raw write, returns the affected row count                                                                                                                                                     |
| `$clear`        | `Promise<{ count }>`       | Empty a whole table on purpose, see [Delete](../client/delete.md#clear-a-table)                                                                                                                     |
| `$capabilities` | `Capabilities`             | Read-only property, the current adapter's capabilities                                                                                                                                              |
| `$extend`       | A new client instance      | Extend the client with extra `virtuals` and `omit` layered on top of the current ones; the extended client shares the connection, transactions and close, see [Extensions](../client/extensions.md) |
| `$close`        | `Promise<void>`            | Wait for in-flight requests, then close connections; a client that never connected closes without connecting                                                                                        |

The `tx` of a transaction callback provides the model methods, `$clear`, `$queryRaw`, and `$executeRaw`.

## Read Methods

All model methods are asynchronous; tables show results after `await`, with `T` depending on the projection (`select`, or `include` combined with `omit`).

| Method              | Main parameters                                                                    | Return value                   |
| ------------------- | ---------------------------------------------------------------------------------- | ------------------------------ |
| `findMany`          | `where`, `orderBy`, `skip`, `take`, `cursor`, `distinct`, `deleted`, projection    | `T[]`                          |
| `findFirst`         | Same as `findMany`                                                                 | `T \| null`                    |
| `findFirstOrThrow`  | Same as `findMany`                                                                 | `T`                            |
| `findUnique`        | `where` (unique key), `deleted`, projection                                        | `T \| null`                    |
| `findUniqueOrThrow` | `where` (unique key), `deleted`, projection                                        | `T`                            |
| `findManyAndCount`  | Same as `findMany`                                                                 | `{ data: T[]; total: number }` |
| `count`             | `where`, `distinct`, `deleted`                                                     | `number`                       |
| `aggregate`         | `where`, `deleted`, `orderBy`, `skip`, `take`, aggregation options                 | Aggregation result             |
| `groupBy`           | `by`, `where`, `deleted`, `having`, `orderBy`, `skip`, `take`, aggregation options | Array of group results         |

## Write Methods

| Method                | Main parameters                                      | Return value        |
| --------------------- | ---------------------------------------------------- | ------------------- |
| `create`              | `data`, projection                                   | `T`                 |
| `createMany`          | `data[]`, `skipDuplicates`                           | `{ count: number }` |
| `createManyAndReturn` | `data[]`, `skipDuplicates`, projection               | `T[]`               |
| `update`              | `where` (unique key), `data`, projection             | `T`                 |
| `updateMany`          | `where`, `data`                                      | `{ count: number }` |
| `updateManyAndReturn` | `where`, `data`, projection                          | `T[]`               |
| `upsert`              | `where` (unique key), `create`, `update`, projection | `T`                 |
| `delete`              | `where` (unique key), projection                     | `T`                 |
| `deleteMany`          | `where`                                              | `{ count: number }` |

On MySQL, `createManyAndReturn` and `updateManyAndReturn` are per-row writes in a transaction; see [Create](../client/create.md#database-differences) and [Update](../client/update.md#database-differences). Top-level bulk updates, deletes, and restores require a non-empty `where`; for `maxAffected` and whole-table deletion see [Write Safety](../client/overview.md#write-safety), and nested operations use the [parent relation scope](../client/relation-writes.md#scope).

## Soft Delete Methods

| Method            | Main parameters                  | Return value        |
| ----------------- | -------------------------------- | ------------------- |
| `restore`         | `where` (unique key), projection | `T`                 |
| `restoreMany`     | `where`                          | `{ count: number }` |
| `forceDelete`     | `where` (unique key), projection | `T`                 |
| `forceDeleteMany` | `where`                          | `{ count: number }` |

## Limits

| Item                                | Upper bound                |
| ----------------------------------- | -------------------------- |
| `where` nesting depth               | 12                         |
| `having` nesting depth              | 12                         |
| Projection nesting depth            | 8                          |
| Nested write depth                  | 8                          |
| JSON nesting depth                  | 64                         |
| Parent keys per relation-load batch | 200                        |
| Parameters per `createMany` batch   | ~900 (conservative budget) |
| `string(n)` length                  | 16383                      |

## Package Entrypoints

The six tables below are the complete public symbol set of each entrypoint; `type` marks a type-only export. `@internal` source symbols, adapter pool-connection interfaces, and the PostgreSQL literal helper are outside this contract.

<!-- exports:root -->

### `@ofis/tsorm`

| Symbol                    | Description                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `internalCreateClient`    | Internal assembly for generated clients: create a client from a schema and a connection URL (the scheme picks the adapter) |
| `sql`                     | Tagged template for a raw SQL fragment                                                                                     |
| `OrmError`                | Runtime error carrying a `code`                                                                                            |
| `DbNull`                  | Sentinel writing a database `NULL` into a nullable JSON column                                                             |
| `JsonNull`                | Sentinel writing a JSON `null`                                                                                             |
| `type ClientOptions`      | Options accepted by `internalCreateClient`                                                                                 |
| `type Client`             | Database-independent client                                                                                                |
| `type TxClient`           | Client surface exposed to a transaction callback                                                                           |
| `type Spec`               | Generated model specification                                                                                              |
| `type Query`              | Query builder surface                                                                                                      |
| `type Payload`            | Resolved query payload                                                                                                     |
| `type Where`              | Filter expression                                                                                                          |
| `type OrderBy`            | Ordering expression                                                                                                        |
| `type JsonFilter`         | JSON path filter expression                                                                                                |
| `type FieldUpdate`        | Per-field update expression                                                                                                |
| `type DecimalUpdate`      | Decimal value, `{ set }`, or arithmetic update expression                                                                  |
| `type Invalid`            | Marker for an invalid input                                                                                                |
| `type OmitFields`         | Per-model omit configuration                                                                                               |
| `type GlobalOmit`         | Client-wide omit configuration                                                                                             |
| `type WithOmit`           | Result type after applying omissions                                                                                       |
| `type SortOrder`          | `asc`, `desc`, or `{ sort, nulls? }` to control NULL placement                                                             |
| `type AggregateArgs`      | Arguments of `aggregate`                                                                                                   |
| `type AggregateResult`    | Result of `aggregate`                                                                                                      |
| `type GroupByArgs`        | Arguments of `groupBy`                                                                                                     |
| `type GroupByResult`      | Result of `groupBy`                                                                                                        |
| `type JsonInput`          | JSON column input type                                                                                                     |
| `type JsonShape`          | JSON shape type                                                                                                            |
| `type Schema`             | Parsed schema                                                                                                              |
| `type Adapter`            | Adapter factory contract                                                                                                   |
| `type RuntimeAdapter`     | Connected adapter contract                                                                                                 |
| `type Dialect`            | SQL dialect contract used by the query compiler                                                                            |
| `type Session`            | Leased database session                                                                                                    |
| `type CompiledSQL`        | Compiled statement                                                                                                         |
| `type QueryResult`        | Statement result                                                                                                           |
| `type Capabilities`       | Per-adapter feature flags                                                                                                  |
| `type TransactionOptions` | Transaction `maxWait`, `timeout` and isolation settings                                                                    |
| `type IsolationLevel`     | Supported isolation levels                                                                                                 |
| `type Logger`             | Logging callback                                                                                                           |
| `type ClientEvent`        | Client lifecycle event                                                                                                     |
| `type SqlQuery`           | Raw SQL fragment                                                                                                           |
| `type RawClient`          | Raw query surface                                                                                                          |
| `type Virtuals`           | Computed field declarations                                                                                                |
| `type WithVirtuals`       | Result type with computed fields                                                                                           |
| `type DeletedMode`        | Soft-delete visibility mode                                                                                                |

<!-- exports:schema -->

### `@ofis/tsorm/schema`

| Symbol                   | Description                                     |
| ------------------------ | ----------------------------------------------- |
| `parseSchema`            | Parse a schema source string into a `Schema`    |
| `schemaErrors`           | Collect all parse errors for editor diagnostics |
| `generateClient`         | Generate the TypeScript client source           |
| `SchemaError`            | Parse error with `line` and `column`            |
| `referentialActions`     | SQL spelling of each referential action         |
| `type Schema`            | Parsed schema                                   |
| `type Table`             | Parsed model                                    |
| `type Column`            | Parsed field                                    |
| `type Relation`          | Parsed relation                                 |
| `type Scalar`            | Scalar column type union                        |
| `type ReferentialAction` | Referential action union                        |

<!-- exports:migrations -->

### `@ofis/tsorm/migrations`

| Symbol                   | Description                                 |
| ------------------------ | ------------------------------------------- |
| `migrate`                | Create and apply a migration                |
| `deploy`                 | Apply pending migrations                    |
| `status`                 | Report applied and pending migrations       |
| `resolve`                | Mark a migration applied or rolled back     |
| `diff`                   | Diff two sources                            |
| `push`                   | Push a schema directly to the database      |
| `MigrationError`         | Migration error carrying a `code`           |
| `type Prompter`          | Confirmation callback for interactive steps |
| `type CommandOptions`    | Options shared by the migration functions   |
| `type MigrateResult`     | Result of `migrate`                         |
| `type StatusResult`      | Result of `status`                          |
| `type DiffSource`        | Source selector for `diff`                  |
| `type DiffResult`        | Result of `diff`                            |
| `type SchemaDiff`        | Structural schema difference                |
| `type MigrationProvider` | Database-specific migration provider        |

<!-- exports:sqlite -->

### `@ofis/tsorm/adapters/sqlite`

| Symbol               | Description                         |
| -------------------- | ----------------------------------- |
| `sqlite`             | Create a SQLite adapter             |
| `sqliteSchemaSQL`    | Emit SQLite DDL for a parsed schema |
| `type SQLiteOptions` | SQLite adapter options              |

<!-- exports:mysql -->

### `@ofis/tsorm/adapters/mysql`

| Symbol              | Description                        |
| ------------------- | ---------------------------------- |
| `mysql`             | Create a MySQL/MariaDB adapter     |
| `mysqlSchemaSQL`    | Emit MySQL DDL for a parsed schema |
| `type MySQLOptions` | MySQL adapter options              |

<!-- exports:postgres -->

### `@ofis/tsorm/adapters/postgres`

| Symbol                 | Description                             |
| ---------------------- | --------------------------------------- |
| `postgres`             | Create a PostgreSQL adapter             |
| `postgresSchemaSQL`    | Emit PostgreSQL DDL for a parsed schema |
| `type PostgresOptions` | PostgreSQL adapter options              |

<!-- exports:end -->

## Generated Types

For each model, the generated client exports `<Model>Row`, `<Model>Create`, `<Model>Update`, `<Model>ScalarCreate`, `<Model>ScalarUpdate`, and `<Model>Unique`, for example `UserRow`.

## Next Steps

- [Client Overview](../client/overview.md): creating and configuring the client
- [Queries](../client/queries.md): the read methods in detail
- [Error Codes](./errors.md): the errors these methods can raise
