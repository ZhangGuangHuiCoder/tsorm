---
description: 使用 $transaction 的两种写法、配置选项、隔离级别和失败语义。
---

# 事务

每次写入和嵌套写入都已自动在事务内执行，`$transaction` 用于把多个操作合并为一个事务。

## 基本用法

回调正常返回时提交，抛出异常时回滚。使用 `tx` 参数：

```ts
await db.$transaction(async (tx) => {
  const account = await tx.account.create({ data: { email: "a@example.com" } });
  await tx.accountEntry.create({
    data: { accountId: account.id, title: "same transaction" },
  });
});
```

也可以直接使用根客户端：`AsyncLocalStorage` 让回调内的调用自动加入当前事务：

```ts
await db.$transaction(async () => {
  const account = await db.account.create({ data: { email: "b@example.com" } });
  await db.accountEntry.create({
    data: { accountId: account.id, title: "same transaction" },
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
  { isolationLevel: "serializable", maxWait: 5000, timeout: 10000 },
);
```

| 选项             | 单位 | 说明                                                  |
| ---------------- | ---- | ----------------------------------------------------- |
| `isolationLevel` | 无   | 隔离级别，见下文                                      |
| `maxWait`        | 毫秒 | 获取连接的最长等待时间，超时报 `TRANSACTION_MAX_WAIT` |
| `timeout`        | 毫秒 | 事务的最长工作时间，超时报 `TRANSACTION_TIMEOUT`      |

`maxWait` 与 `timeout` 默认都不设置：获取连接会一直等待，事务也没有时间预算。回调返回后，等待队列中的语句完成期间仍受超时限制；`timeout` 到期后事务拒绝后续操作并回滚，MySQL 和 PostgreSQL 通过独立连接尝试取消执行中的语句（`KILL QUERY` / `pg_cancel_backend`），属于尽力执行。回滚与连接释放仍需等待执行中的操作结束，因此 `timeout` 不是调用耗时的严格上限；SQLite 同步语句无法被 JavaScript 定时器中断。

## 隔离级别

| 隔离级别          | SQLite | MySQL / MariaDB | PostgreSQL |
| ----------------- | ------ | --------------- | ---------- |
| `read committed`  | 拒绝   | 支持            | 支持       |
| `repeatable read` | 拒绝   | 支持            | 支持       |
| `serializable`    | 支持   | 支持            | 支持       |

不支持的隔离级别在开启事务前报 `UNSUPPORTED_CAPABILITY`。省略时的行为：

| 数据库     | 省略隔离级别时的服务器行为    | 其中能否调用 `findManyAndCount` |
| ---------- | ----------------------------- | ------------------------------- |
| SQLite     | `serializable`                | 可以                            |
| MySQL      | 会话默认（`REPEATABLE READ`） | 可以                            |
| PostgreSQL | 会话默认（`READ COMMITTED`）  | 否，报 `TRANSACTION_ISOLATION`  |

::: warning 快照一致性
在 `READ COMMITTED` 下，同一事务内的多条查询可能看到不同的已提交数据。需要一致快照时，请显式指定 `repeatable read` 或 `serializable`。一次根关系查询及其嵌套查询共用同一连接，但未开启显式事务时，多条语句不保证共享快照。
:::

## 执行与失败语义

- **串行执行**：同一事务内并发发起的操作排队串行执行；提交前会等待已入队的操作完成。
- **失败后只能回滚**：任一数据库操作失败后，即使业务代码捕获了错误，事务也只能回滚，后续操作报 `TRANSACTION_ABORTED`。
- **错误透传、结束后不可复用**：回调中抛出的错误原样保留；事务结束后使用 `tx` 报 `TRANSACTION_CLOSED`。
- **回滚失败**：`ROLLBACK` 本身失败时，MySQL 和 PostgreSQL 丢弃该连接，不放回连接池；SQLite 将唯一的连接标记为不可用，后续请求报 `CLIENT_CLOSED`。

## 嵌套事务

嵌套 `$transaction` 复用外层事务及其提交边界。

- 设置 `maxWait` 或 `timeout` 报 `TRANSACTION_OPTIONS`，改变隔离级别报 `TRANSACTION_ISOLATION`。
- 内层失败后，即使错误被捕获，外层也无法提交，包括 `undefined`、`null`、`false`、`0` 和空字符串这类拒绝值。

## 重试与副作用

事务失败时直接抛出错误，是否重试由调用方决定。回滚无法撤销回调中已执行的外部副作用（HTTP 请求、发邮件），重试前请确保回调可以安全地重复执行。

死锁牺牲者报 `TRANSACTION_DEADLOCK`；其他事务可能继续，但不保证提交成功。回滚完成后，仅当回调及其副作用可以安全重复时才重试整个事务；可重试的错误是 `TRANSACTION_DEADLOCK`、`SERIALIZATION_FAILURE` 和 `LOCK_TIMEOUT`：

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

让所有事务按相同顺序锁定记录（例如按主键升序更新）可以减少死锁；PostgreSQL 在 `deadlock_timeout`（默认 1 秒）后才检测死锁，MySQL 立即检测。在 MySQL 的默认隔离级别 `repeatable read` 下，快照建立在第一次普通读取时；`update` 会先读取目标记录，所以“先更新一行加锁、再读取其他记录”读到的仍是加锁前的快照——需要读到加锁后的最新数据时请使用 `read committed`。

## 下一步

- [写入安全](./overview.md#写入安全)：批量写的行数上限
- [关系写入](./relation-writes.md)：已在事务内执行的嵌套写入
- [错误码](../reference/errors.md)：全部事务错误码
