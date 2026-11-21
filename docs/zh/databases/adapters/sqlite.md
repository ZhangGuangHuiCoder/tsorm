---
description: SQLite 适配器基于 Node.js 内置的 node:sqlite，单连接同步执行，事务只支持 serializable，写入使用原生 RETURNING。
---

# SQLite

## 概述

基于 Node.js 内置的 `node:sqlite`（`DatabaseSync`），不需要独立服务或额外驱动。

- 驱动：`node:sqlite`，随 Node.js 一起发布
- 连接：所有请求共用一个同步连接
- 写入结果：原生 `RETURNING`
- 事务：写事务用 `BEGIN IMMEDIATE`，只读事务用 `BEGIN`
- 隔离级别：仅 `serializable`

物理类型对应关系见[类型映射](../overview.md#类型映射)。

## 定义

### 连接选项

| 选项         | 类型     | 默认值                             | 说明                                                                            |
| ------------ | -------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| `connection` | `string` | 必填（适配器默认 `file::memory:`） | `file:` 形式的数据库文件；`createClient` 必须传入，单独使用适配器时才默认内存库 |

首次操作建立连接时启用 `PRAGMA foreign_keys=ON`，并设置 `busy_timeout` 为 5000 毫秒。SQLite 在进程内用一条同步连接串行执行请求，没有连接池配置，连接 URL 也不接受参数；连接池参数见 [MySQL](./mysql.md#连接池) 和 [PostgreSQL](./postgres.md#连接池)。

### 类型细节

- 在生成的结构中，`string`、`datetime` 和 JSON 共用 `TEXT`，`boolean` 和整数共用 `INTEGER`。长度、枚举、布尔取值和 JSON 合法性由 `CHECK` 约束保证。
- `bigint` 模型字段返回十进制字符串；`int` 模型字段经过安全整数范围检查后返回 `number`。
- `datetime` 存储 UTC 的 ISO 文本，`timestamp` 存储 Unix 毫秒整数；两者读回均为 `Date`，见[日期与时区](../../client/datetime.md)。
- `string` 列由 `CHECK` 约束校验长度，省略长度时按 191 个字符处理，并且可以建立索引；`text` 列是不带长度校验的 `TEXT`，不能作为键或索引。非唯一关系列会自动添加索引。
- SQLite 没有注释存储；`//` 注释可以声明但会被忽略。

## 示例

### 创建客户端

```ts
import { createClient } from "./generated/client.ts";

const db = createClient({
  connection: "file:./app.sqlite",
});
```

### 创建表

用 [`tsorm push`](../migrations.md#push) 或版本化迁移创建表；适配器本身不建表。导出建表 SQL（不连接数据库，`DATABASE_URL` 只用来确定数据库类型）：

```bash
DATABASE_URL=file:./app.sqlite tsorm diff --from empty
```

手动执行时同样需要开启外键检查。

### 写入

- `INSERT` 和 `UPDATE` 使用 `RETURNING` 获取实际写入的结果。
- 支持批量写入返回和原生 `ON CONFLICT DO UPDATE`，条件见 [upsert](../../client/update.md#upsert)。

## 注意事项

### 事务与连接

所有请求共用一个同步连接，按到达顺序排队；同一客户端上的 SQL 串行执行，没有多连接并行读。

| 场景     | 语句              |
| -------- | ----------------- |
| 写事务   | `BEGIN IMMEDIATE` |
| 只读事务 | `BEGIN`           |

- 隔离级别只能声明 `serializable`；`ROLLBACK` 失败后连接不可用，后续请求报 `CLIENT_CLOSED`。同步 API 会阻塞事件循环，在高并发或大数据量场景下请结合实际负载验证。通用行为见[事务](../../client/transactions.md)。

### 错误映射

根据 SQLite 的约束消息映射为 `UNIQUE_CONSTRAINT`、`FOREIGN_KEY_CONSTRAINT`、`NOT_NULL_CONSTRAINT` 和 `CHECK_CONSTRAINT`，其余归为 `DATABASE_ERROR`。

### 相关链接

- [Node.js `node:sqlite` 文档](https://nodejs.org/api/sqlite.html)

## 下一步

- [MySQL / MariaDB](./mysql.md)：连接池适配器，支持三种隔离级别，DDL 隐式提交
- [PostgreSQL](./postgres.md)：连接池适配器，支持 schema 和原生 `BOOLEAN`
- [版本化迁移](../migrations.md)：升级已有的 SQLite 数据库
