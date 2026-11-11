---
description: Error codes and meanings of OrmError, MigrationError, and SchemaError.
---

# Error Codes

The ORM defines three error types; the first two distinguish causes by error code. Application callback errors and some underlying failures may propagate unchanged, so not every exception is one of these types.

| Error type       | Source              | How to tell                  |
| ---------------- | ------------------- | ---------------------------- |
| `OrmError`       | Client and adapters | `error.code`                 |
| `MigrationError` | Migration tool      | `error.code`                 |
| `SchemaError`    | Model parsing       | `error.line`, `error.column` |

The `cause` of a database error keeps the original driver error, which may contain sensitive input values.

## Client Errors

### Input and Queries

| Error code               | Description                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `VALIDATION`             | Input does not match the model or API rules                                                         |
| `NOT_FOUND`              | An `OrThrow` query, `update`, `delete`, or relation target found no record                          |
| `NUMERIC_OVERFLOW`       | An `int` or count exceeds the safe-integer range, or a numeric result is non-finite                 |
| `INVALID_DATABASE_VALUE` | A value in the database does not match the model declaration, for example a JSON structure mismatch |
| `UNSUPPORTED_CAPABILITY` | The current database does not support the requested capability                                      |

### Write Safety

| Error code           | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| `MASS_WRITE_BLOCKED` | A bulk write matched more rows than the client's `maxAffected` |

### Constraints

| Error code               | Description                     |
| ------------------------ | ------------------------------- |
| `UNIQUE_CONSTRAINT`      | Unique constraint violated      |
| `FOREIGN_KEY_CONSTRAINT` | Foreign key constraint violated |
| `NOT_NULL_CONSTRAINT`    | Not-null constraint violated    |
| `CHECK_CONSTRAINT`       | Check constraint violated       |

### Relations and Soft Delete

| Error code               | Description                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| `RELATION_NOT_CONNECTED` | A nested operation's target does not belong to the current relation         |
| `RELATION_INTEGRITY`     | A to-one relation's load result violates the cardinality constraint         |
| `POLYMORPHIC_INCLUDE`    | `include` or `select` named the forward side of a polymorphic relation      |
| `POLYMORPHIC_OPERATION`  | A nested write tried to transfer the ownership of a polymorphic relation    |
| `SOFT_DELETED_REFERENCE` | A foreign key or `connect` points at a soft-deleted record                  |
| `SOFT_DELETED_RELATION`  | A required relation's target is soft-deleted, leaving eager loading missing |

### Transactions

| Error code              | Description                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `TRANSACTION_ABORTED`   | An operation in the transaction already failed, rollback only                                                      |
| `TRANSACTION_CLOSED`    | The transaction has ended and cannot be reused                                                                     |
| `TRANSACTION_TIMEOUT`   | Exceeded `timeout`                                                                                                 |
| `TRANSACTION_MAX_WAIT`  | Failed to acquire a connection before `maxWait`                                                                    |
| `TRANSACTION_OPTIONS`   | A nested transaction tried to set `maxWait` or `timeout`                                                           |
| `TRANSACTION_SCOPE`     | The operation cannot run inside a transaction, for example `$close()`                                              |
| `TRANSACTION_ISOLATION` | The isolation level cannot support `findManyAndCount`, or a nested transaction tried to change the isolation level |
| `TRANSACTION_DEADLOCK`  | A deadlock occurred, MySQL and PostgreSQL only                                                                     |
| `LOCK_TIMEOUT`          | Lock wait timed out or was unavailable, MySQL and PostgreSQL only                                                  |
| `SERIALIZATION_FAILURE` | Serialization failure, PostgreSQL only                                                                             |
| `QUERY_CANCELLED`       | The statement was cancelled by the server, for example terminated after a transaction timeout                      |

### Connection and Initialization

| Error code           | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `CLIENT_CLOSED`      | The client is closed, or the SQLite connection is unusable |
| `UNSUPPORTED_SERVER` | The server version is below the minimum requirement        |
| `UNSUPPORTED_ENGINE` | A managed MySQL table does not use InnoDB                  |
| `DATABASE_NOT_EMPTY` | The `initialize` target is not empty                       |
| `SCHEMA_NOT_FOUND`   | The PostgreSQL target schema does not exist                |
| `DATABASE_ERROR`     | Other unclassified database errors                         |

## Migration Errors

Migration commands throw `MigrationError`. The CLI prints `Error: <code>` followed by a description, with exit code 1.

### Connection

| Error code                      | Description                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `INVALID_URL`                   | The database URL is malformed, or identical to the shadow URL                                                 |
| `SCHEMA_NOT_FOUND`              | The schema file could not be read                                                                             |
| `UNSUPPORTED_SERVER`            | The server version is below the minimum requirement                                                           |
| `DATABASE_NOT_FOUND`            | The database does not exist for `deploy --check`, `resolve`, or `diff --from database`                        |
| `DATABASE_UNREACHABLE`          | Could not connect to the database server                                                                      |
| `DATABASE_CREATE_FAILED`        | Failed to create the database                                                                                 |
| `SHADOW_DATABASE_CREATE_FAILED` | Could not create the shadow database automatically; needs create-database permission or `SHADOW_DATABASE_URL` |

### Migration History

| Error code                     | Description                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `PROVIDER_MISMATCH`            | The `DATABASE_URL` database type does not match `migration_lock.toml`                                        |
| `INVALID_MIGRATION_FILE`       | A `.sql` file in the migrations directory does not match `<YYYYMMDDHHMMSS>_<name>.sql`                       |
| `MIGRATION_TIMESTAMP_CONFLICT` | Two migrations share a timestamp, or a new migration's timestamp is not greater than the latest existing one |
| `MIGRATION_NAME_TOO_LONG`      | A migration file name exceeds 200 bytes                                                                      |
| `MIGRATION_NOT_FOUND`          | The file named by `resolve --applied` does not exist                                                         |
| `MIGRATION_ALREADY_APPLIED`    | The migration is already recorded as applied                                                                 |
| `MIGRATION_NOT_APPLIED`        | The migration was never applied and cannot be marked rolled back                                             |
| `MIGRATION_NOT_FAILED`         | The migration is not in a failed state and cannot be marked rolled back                                      |
| `MIGRATION_LOCKED`             | Timed out waiting for another migration process to release the lock                                          |

### Execution

| Error code                | Description                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_NOT_EMPTY`      | The database has tables but no migration history; establish a baseline first             |
| `FAILED_MIGRATIONS`       | A failed migration exists, so new migrations are not applied                             |
| `MIGRATION_FAILED`        | The migration failed to run; details are written to the history table's `logs`           |
| `SHADOW_MIGRATION_FAILED` | The migration could not run correctly against the shadow database                        |
| `FOREIGN_KEY_CHECK`       | A SQLite script left foreign key violations after execution, rolled back                 |
| `UNEXECUTABLE_MIGRATION`  | The change cannot be executed against existing data                                      |
| `DATA_LOSS`               | `push` would lose data and needs `--force`                                               |
| `NON_INTERACTIVE`         | Confirmation is needed but the environment is not an interactive terminal; add `--force` |
| `ABORTED`                 | The user declined the confirmation                                                       |
| `VALIDATION`              | Invalid argument combination, for example `resolve` given both options                   |

## Next Steps

- [Client API](./client-api.md): the methods that raise these errors
- [Options & Behavior](./cli/options.md): CLI exit codes and confirmation behavior
- [Calling from Code](./cli/programmatic.md): how the same errors surface as exceptions
