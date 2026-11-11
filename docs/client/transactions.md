---
description: The two $transaction styles, configuration options, isolation levels, and failure semantics.
---

# Transactions

Every single write and every nested write already runs inside a transaction automatically. Use `$transaction` to combine multiple operations into one transaction.

## Basic Usage

The transaction commits when the callback returns normally and rolls back when it throws. You can use the `tx` callback parameter:

```ts
await db.$transaction(async (tx) => {
  const account = await tx.account.create({ data: { email: "a@example.com" } });
  await tx.accountEntry.create({
    data: { accountId: account.id, title: "same transaction" },
  });
});
```

You can also use the root client directly. Through `AsyncLocalStorage`, the ORM makes root client calls inside the callback automatically join the current transaction:

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

The timeout remains active while queued statements finish after the callback returns. After `timeout` expires, the transaction rejects new operations and starts rollback. MySQL and PostgreSQL attempt to cancel the running statement over a separate connection (`KILL QUERY` or `pg_cancel_backend`); enabling `logger` preserves this capability. Cancellation is best effort and depends on connectivity and permissions. Cleanup still waits for in-flight operations, so `timeout` is not a strict wall-clock bound. Synchronous SQLite statements cannot be interrupted by a JavaScript timer.

## Isolation Levels

| Isolation level   | SQLite    | MySQL / MariaDB | PostgreSQL |
| ----------------- | --------- | --------------- | ---------- |
| `read committed`  | Rejected  | Supported       | Supported  |
| `repeatable read` | Rejected  | Supported       | Supported  |
| `serializable`    | Supported | Supported       | Supported  |

Requesting an unsupported level raises `UNSUPPORTED_CAPABILITY` before the transaction starts. Behavior when omitted:

| Database   | Server behavior when the level is omitted | Can `findManyAndCount` be called   |
| ---------- | ----------------------------------------- | ---------------------------------- |
| SQLite     | `serializable`                            | Yes                                |
| MySQL      | Session default (`REPEATABLE READ`)       | Yes                                |
| PostgreSQL | Session default (`READ COMMITTED`)        | No, raises `TRANSACTION_ISOLATION` |

::: warning Snapshot consistency
Under `READ COMMITTED`, multiple queries in the same transaction may see different committed data. When you need a consistent snapshot, specify `repeatable read` or `serializable` explicitly. A root relation read and its nested queries share one connection, but without an explicit transaction their statements need not share a snapshot. Use an appropriate transaction isolation level when consistency is required.
:::

Locks, concurrency conflicts, throughput, and retry behavior are decided by the database; the ORM does not promise identical behavior across the three.

## Execution and Failure Semantics

- **Serial execution**: operations started concurrently within one transaction are queued and run serially. Before the callback ends, queued operations are awaited.
- **Rollback only after failure**: once any database operation fails, the transaction can only roll back even if business code catches the error, and later operations raise `TRANSACTION_ABORTED`.
- **Error passthrough**: business errors thrown in the callback are preserved as-is.
- **No reuse after close**: continuing to use `tx` after the transaction ends raises `TRANSACTION_CLOSED`.
- **Rollback failure**: if `ROLLBACK` itself fails, MySQL and PostgreSQL discard the connection instead of returning it to the pool; SQLite marks its single connection unusable, and later requests raise `CLIENT_CLOSED`.

## Nested Transactions

A nested `$transaction` shares the outer transaction and its commit boundary.

- Setting `maxWait` or `timeout` raises `TRANSACTION_OPTIONS`, and changing the isolation level raises `TRANSACTION_ISOLATION`.
- After an inner rejection, the outer transaction cannot commit even if the error is caught, including rejection values such as `undefined`, `null`, `false`, `0`, or an empty string.

## Retries and Side Effects

A failed transaction throws, and the caller decides whether to retry. Rollback cannot undo external side effects already executed in the callback, such as HTTP requests or sending email. If your business needs retries, make sure the callback can be safely re-run.

A deadlock victim raises `TRANSACTION_DEADLOCK`; other transactions may continue, but their commit is not guaranteed. `TRANSACTION_DEADLOCK`, `SERIALIZATION_FAILURE`, and `LOCK_TIMEOUT` can be candidates for retrying the whole transaction once rollback completes. Retry only when the callback and its external side effects are safe to repeat:

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

A common way to reduce deadlocks is to have all transactions lock records in the same order, for example updating by ascending primary key. PostgreSQL detects deadlocks only after `deadlock_timeout` (1 second by default), while MySQL detects them immediately.

Under MySQL's default `repeatable read`, a transaction's read snapshot is established at its first plain read. `update` reads the target record first, so in "lock one row by updating it, then read other records" you still read the pre-lock snapshot. To read the latest data after locking, use `read committed`.

## Next Steps

- [Write Safety](./overview.md#write-safety): the row limit applied to bulk writes
- [Relation Writes](./relation-writes.md): nested writes that already run in a transaction
- [Error Codes](../reference/errors.md): every transaction error code
