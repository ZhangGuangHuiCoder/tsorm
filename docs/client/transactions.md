---
description: The two $transaction styles, configuration options, isolation levels, and failure semantics.
---

# Transactions

Every write and nested write already runs in a transaction; use `$transaction` to combine multiple operations.

## Basic Usage

The callback commits the transaction on return and rolls back on throw. Use the `tx` parameter:

```ts
await db.$transaction(async (tx) => {
  const account = await tx.account.create({ data: { email: "a@example.com" } });
  await tx.accountEntry.create({
    data: { accountId: account.id, title: "same transaction" },
  });
});
```

Or use the root client directly: `AsyncLocalStorage` makes its calls inside the callback join the current transaction:

```ts
await db.$transaction(async () => {
  const account = await db.account.create({ data: { email: "b@example.com" } });
  await db.accountEntry.create({
    data: { accountId: account.id, title: "same transaction" },
  });
});
```

`tx` also provides [`$queryRaw` and `$executeRaw`](./raw-sql.md).

## Options

```ts
await db.$transaction(
  async (tx) => {
    // ...
  },
  { isolationLevel: "serializable", maxWait: 5000, timeout: 10000 },
);
```

| Option           | Unit | Description                                                                      |
| ---------------- | ---- | -------------------------------------------------------------------------------- |
| `isolationLevel` | None | Isolation level, see below                                                       |
| `maxWait`        | ms   | Maximum time to acquire a connection; exceeding it raises `TRANSACTION_MAX_WAIT` |
| `timeout`        | ms   | Transaction work-time budget; exceeding it raises `TRANSACTION_TIMEOUT`          |

Both are unset by default: connection acquisition waits until one is free, and the transaction has no time budget. The timeout keeps running while queued statements finish after the callback returns; after `timeout` the transaction rejects new work and rolls back, with MySQL and PostgreSQL trying to cancel the running statement over a separate connection (`KILL QUERY` / `pg_cancel_backend`), best effort only. Cleanup still waits for in-flight operations, so `timeout` is not a strict wall-clock bound, and synchronous SQLite statements cannot be interrupted by a timer.

## Isolation Levels

| Isolation level   | SQLite    | MySQL / MariaDB | PostgreSQL |
| ----------------- | --------- | --------------- | ---------- |
| `read committed`  | Rejected  | Supported       | Supported  |
| `repeatable read` | Rejected  | Supported       | Supported  |
| `serializable`    | Supported | Supported       | Supported  |

Unsupported levels raise `UNSUPPORTED_CAPABILITY` before the transaction starts. Behavior when omitted:

| Database   | Server behavior when the level is omitted | Can `findManyAndCount` be called   |
| ---------- | ----------------------------------------- | ---------------------------------- |
| SQLite     | `serializable`                            | Yes                                |
| MySQL      | Session default (`REPEATABLE READ`)       | Yes                                |
| PostgreSQL | Session default (`READ COMMITTED`)        | No, raises `TRANSACTION_ISOLATION` |

::: warning Snapshot consistency
Under `READ COMMITTED`, multiple queries in the same transaction may see different committed data. When you need a consistent snapshot, specify `repeatable read` or `serializable` explicitly. A root relation read and its nested queries share one connection, but without an explicit transaction their statements need not share a snapshot.
:::

## Execution and Failure Semantics

- **Serial execution**: operations started concurrently within one transaction are queued and run serially; the transaction waits for queued operations before committing.
- **Rollback only after failure**: once any database operation fails, the transaction can only roll back even if the business code catches the error; later operations raise `TRANSACTION_ABORTED`.
- **Error passthrough, no reuse**: callback errors are preserved as-is; using `tx` after the transaction ends raises `TRANSACTION_CLOSED`.
- **Rollback failure**: if `ROLLBACK` itself fails, MySQL and PostgreSQL discard the connection instead of returning it to the pool; SQLite marks its single connection unusable, and later requests raise `CLIENT_CLOSED`.

## Nested Transactions

A nested `$transaction` shares the outer transaction and its commit boundary.

- Setting `maxWait` or `timeout` raises `TRANSACTION_OPTIONS`, and changing the isolation level raises `TRANSACTION_ISOLATION`.
- After an inner rejection, the outer transaction cannot commit even if the error is caught, including rejection values such as `undefined`, `null`, `false`, `0`, or an empty string.

## Retries and Side Effects

A failed transaction throws; the caller decides whether to retry. Rollback cannot undo external side effects already executed in the callback (HTTP requests, email), so a retried callback must be safe to run again.

A deadlock victim raises `TRANSACTION_DEADLOCK`; other transactions may continue, but their commit is not guaranteed. Retry the whole transaction after rollback completes only when the callback and its side effects are safe to repeat; candidates are `TRANSACTION_DEADLOCK`, `SERIALIZATION_FAILURE`, and `LOCK_TIMEOUT`:

```ts
import { OrmError } from "@ofis/tsorm";

const retryable = new Set(["TRANSACTION_DEADLOCK", "SERIALIZATION_FAILURE", "LOCK_TIMEOUT"]);
for (let attempt = 0; ; attempt++) {
  try {
    await db.$transaction(async (tx) => {
      /* ... */
    });
    break;
  } catch (error) {
    if (!(error instanceof OrmError) || !retryable.has(error.code) || attempt >= 5) {
      throw error;
    }
  }
}
```

Reduce deadlocks by locking records in the same order everywhere, e.g. updating by ascending primary key; PostgreSQL detects deadlocks only after `deadlock_timeout` (1 second by default), MySQL immediately. Under MySQL's default `repeatable read`, the snapshot is established at the first plain read; since `update` reads the target first, "update one row to lock it, then read others" still sees the pre-lock snapshot — use `read committed` to read the latest data after locking.

## Next Steps

- [Write Safety](./overview.md#write-safety): the row limit applied to bulk writes
- [Relation Writes](./relation-writes.md): nested writes that already run in a transaction
- [Error Codes](../reference/errors.md): every transaction error code
