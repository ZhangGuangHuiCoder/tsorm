---
description: 通过 logger 回调接收 SQL、事务和客户端生命周期事件。
---

# 事件日志

配置 `logger` 回调后，ORM 会通知结构化事件；输出、存储、过滤和日志级别都由调用方实现。

## 配置

```ts
import { createClient } from "./generated/client.ts";
import type { Logger } from "@ofis/tsorm";

const logger: Logger = (event) => {
  if (event.type === "query") {
    console.log(event.sql, event.durationMs, event.status);
  }
};

const db = createClient({ connection: "file::memory:", logger });
```

## 事件类型

所有事件都包含 `database`、`timestamp` 和 `durationMs`，以及 `type` 和 `status`（`success` 或 `error`）。失败时，`error` 是经过 ORM 映射的错误。

| `type`        | 触发时机               | 其他字段                                |
| ------------- | ---------------------- | --------------------------------------- |
| `query`       | 一条 SQL 执行完成      | `sql`、`parameters`、`affectedRows`     |
| `transaction` | 事务操作完成           | `action`：`begin`、`commit`、`rollback` |
| `client`      | 客户端生命周期操作完成 | `action`：`connect`、`close`            |

`connect` 在首次操作建立连接时触发，而不是 `createClient` 返回时；未被使用就关闭的客户端不产生任何事件。`query` 事件包含事务内的关系加载和嵌套写入，但不包含适配器内部的连接初始化、版本检查和建表语句——这些耗时计入 `connect` 事件。

## 行为约定

- 事件对象和参数数组都是只读的。
- `logger` 可以返回 `void` 或 `Promise<void>`，异步回调独立执行。
- `logger` 抛出异常或返回被拒绝的 Promise 均与数据库操作隔离；未配置 `logger` 时，语句和事务操作不做事件上报包装。
- 日志队列由应用管理，可靠落盘需在关闭前执行 flush。

::: warning 敏感信息
`parameters` 可能包含业务数据，记录前请在 `logger` 中脱敏。
:::

## 下一步

- [客户端概览](./overview.md#选项)：`logger` 选项
- [事务](./transactions.md)：每个操作发出的 `transaction` 事件
