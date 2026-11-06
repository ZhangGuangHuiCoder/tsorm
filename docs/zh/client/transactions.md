---
description: 使用 $transaction 的两种写法、配置选项、隔离级别和失败语义。
---

# 事务

所有单次写操作和嵌套写入都会自动在事务内执行。需要把多个操作合并为一个事务时，使用 `$transaction`。

## 基本用法

回调正常返回时提交，抛出异常时回滚。可以使用回调参数 `tx`：

```ts
await db.$transaction(async (tx) => {
  const account = await tx.account.create({ data: { email: 'a@example.com' } });
  await tx.accountEntry.create({
    data: { accountId: account.id, title: 'same transaction' },
  });
});
```

也可以直接使用根客户端。ORM 通过 `AsyncLocalStorage` 让回调内的根客户端调用自动加入当前事务：

```ts
await db.$transaction(async () => {
  const account = await db.account.create({ data: { email: 'b@example.com' } });
  await db.accountEntry.create({
    data: { accountId: account.id, title: 'same transaction' },
  });
});
```

`tx` 同样提供 [`$queryRaw` 和 `$executeRaw`](./raw-sql.md)。

## 选项

```ts
await db.$transaction(
  async (tx) => {
    // ...
  },
  { isolationLevel: 'serializable', maxWait: 5000, timeout: 10000 },
);
```

| 选项             | 单位 | 说明                                     |
| ---------------- | ---- | ---------------------------------------- |
| `isolationLevel` | 无   | 隔离级别，见下文                         |
| `maxWait`        | 毫秒 | 获取连接的最长等待时间，超时报 `TRANSACTION_MAX_WAIT` |
| `timeout`        | 毫秒 | 事务的最长工作时间，超时报 `TRANSACTION_TIMEOUT` |

`timeout` 过期后，事务拒绝后续操作并回滚。如果此时有语句正在服务器上执行，MySQL 和 PostgreSQL 会另开一个连接取消它（`KILL QUERY` 或 `pg_cancel_backend`），再回滚并释放连接，不会等慢查询自然结束。取消需要连接用户有权终止自己的会话，默认即具备。SQLite 的语句是同步执行的，不存在执行中的语句。

## 隔离级别

| 隔离级别          | SQLite | MySQL / MariaDB | PostgreSQL |
| ----------------- | ------ | --------------- | ---------- |
| `read committed`  | 拒绝   | 支持            | 支持       |
| `repeatable read` | 拒绝   | 支持            | 支持       |
| `serializable`    | 支持   | 支持            | 支持       |

请求不支持的级别时，在开启事务前报 `UNSUPPORTED_CAPABILITY`。省略时的行为：

| 数据库     | 省略隔离级别时的服务器行为 | 其中能否调用 `findManyAndCount` |
| ---------- | -------------------------- | ------------------------------ |
| SQLite     | `serializable`             | 可以                           |
| MySQL      | 会话默认（`REPEATABLE READ`） | 可以                           |
| PostgreSQL | 会话默认（`READ COMMITTED`） | 否，报 `TRANSACTION_ISOLATION` |

::: warning 快照一致性
在 `READ COMMITTED` 下，同一事务内的多条查询可能看到不同的已提交数据。需要一致快照时，请显式指定 `repeatable read` 或 `serializable`。事务外的多语句关系读取可能使用不同连接，需要一致快照时请放进事务。
:::

锁、并发冲突、吞吐量和重试行为由数据库决定，ORM 不承诺三者一致。

## 执行与失败语义

- **串行执行**：同一事务内并发发起的操作会排队串行执行。回调结束前会等待已入队的操作。
- **失败后只能回滚**：任一数据库操作失败后，即使业务代码捕获了错误，事务也只能回滚，后续操作报 `TRANSACTION_ABORTED`。
- **错误透传**：回调中抛出的业务错误会保留原样。
- **结束后不可复用**：事务结束后继续使用 `tx` 报 `TRANSACTION_CLOSED`。
- **回滚失败**：`ROLLBACK` 本身失败时，MySQL 和 PostgreSQL 丢弃该连接，不放回连接池；SQLite 将唯一的连接标记为不可用，后续请求报 `CLIENT_CLOSED`。

## 嵌套事务

嵌套的 `$transaction` 加入外层事务，不会创建独立事务或保存点。

- 设置 `maxWait` 或 `timeout` 报 `TRANSACTION_OPTIONS`，改变隔离级别报 `TRANSACTION_ISOLATION`。
- 内层失败后，即使错误被捕获，外层也无法提交。

## 重试与副作用

事务失败时直接抛出错误，是否重试由调用方决定。回滚无法撤销回调中已执行的外部副作用，例如 HTTP 请求或发送邮件。如果业务需要重试，请确保回调可以安全地重复执行。

死锁时数据库会选择一个事务作为牺牲者并回滚，它报 `TRANSACTION_DEADLOCK`，另一个事务正常提交。可安全重试的错误码是 `TRANSACTION_DEADLOCK`、`SERIALIZATION_FAILURE` 和 `LOCK_TIMEOUT`：

```ts
const retryable = new Set(['TRANSACTION_DEADLOCK', 'SERIALIZATION_FAILURE', 'LOCK_TIMEOUT']);
for (let attempt = 0; ; attempt++) {
  try {
    await db.$transaction(async (tx) => { /* ... */ });
    break;
  } catch (error) {
    if (!retryable.has((error as OrmError).code) || attempt >= 5) throw error;
  }
}
```

减少死锁的常见做法是让所有事务按相同顺序锁定记录，例如按主键升序更新。PostgreSQL 在 `deadlock_timeout`（默认 1 秒）后才检测死锁，MySQL 会立即检测。

在 MySQL 的默认隔离级别 `repeatable read` 下，事务的读取快照建立在第一次普通读取时。`update` 会先读取目标记录，所以“先更新一行加锁、再读取其他记录”时，读到的仍是加锁前的快照。需要读到加锁后的最新数据时，请使用 `read committed`。
