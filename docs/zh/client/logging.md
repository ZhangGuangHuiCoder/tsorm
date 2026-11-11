---
description: 通过 logger 回调接收 SQL、事务和客户端生命周期事件。
---

# 事件日志

配置 `logger` 回调后，ORM 会通知结构化事件。输出、存储、过滤和日志级别都由调用方实现。

## 配置

```ts
import { createClient } from "./generated/client.ts";
import { sqlite } from "@ofis/tsorm/adapters/sqlite";
import type { Logger } from "@ofis/tsorm";

const logger: Logger = (event) => {
  if (event.type === "query") {
    console.log(event.sql, event.durationMs, event.status);
  }
};

const db = await createClient({ adapter: sqlite(), logger });
```

## 事件类型

所有事件都包含 `database`、`timestamp` 和 `durationMs`，以及 `type` 和 `status`（`success` 或 `error`）。失败时，`error` 是经过 ORM 映射的错误。

| `type`        | 触发时机               | 其他字段                                |
| ------------- | ---------------------- | --------------------------------------- |
| `query`       | 一条 SQL 执行完成      | `sql`、`parameters`、`affectedRows`     |
| `transaction` | 事务操作完成           | `action`：`begin`、`commit`、`rollback` |
| `client`      | 客户端生命周期操作完成 | `action`：`connect`、`close`            |

`query` 事件包含事务内的关系加载和嵌套写入产生的 SQL。适配器内部的连接初始化、版本检查和建表语句不单独发送 `query` 事件，其总耗时计入 `connect` 事件。

## 行为约定

- 事件对象和参数数组都是只读的。
- `logger` 可以返回 `void` 或 `Promise<void>`。异步回调独立执行。
- `logger` 抛出异常或返回被拒绝的 Promise，均与数据库操作隔离。
- 日志队列由应用管理，可靠落盘需在关闭前执行 flush。
- 未配置 `logger` 时，ORM 直接使用原始适配器，没有事件包装开销。

::: warning 敏感信息
`parameters` 可能包含业务数据，记录前请在 `logger` 中脱敏。
:::

## 下一步

- [客户端概览](./overview.md#选项)：`logger` 选项
- [事务](./transactions.md)：每个操作发出的 `transaction` 事件
