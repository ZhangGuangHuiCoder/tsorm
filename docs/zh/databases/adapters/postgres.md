---
description: PostgreSQL 适配器基于 pg，使用连接池、可配置的 schema、原生 RETURNING 和 BOOLEAN 类型，支持三种隔离级别。
---

# PostgreSQL

## 概述

基于 `pg`（node-postgres），支持 PostgreSQL 14+；服务器版本和目标 schema 在首次操作时检查，而非创建客户端时。

- 驱动：`pg`
- 连接：连接池，每个根请求独立获取连接
- 写入结果：原生 `RETURNING`
- 事务：写入自动包裹事务，普通读取直接执行
- 隔离级别：三种都支持，通过 `BEGIN ISOLATION LEVEL` 设置
- schema：连接 URL 的 `schema` 查询参数指定目标 schema，默认为 `public`

物理类型对应关系见[类型映射](../overview.md#类型映射)。

## 定义

### 连接选项

| 选项         | 类型     | 默认值 | 说明                                                              |
| ------------ | -------- | ------ | ----------------------------------------------------------------- |
| `connection` | `string` | 必填   | PostgreSQL 连接 URL，驱动参数和目标 `schema` 都通过查询字符串配置 |

### 连接池

连接池完全写在连接 URL 里，参数名就是 node-postgres 的连接池参数名，时间单位毫秒：

| URL 参数                  | 说明                         | 默认值                           |
| ------------------------- | ---------------------------- | -------------------------------- |
| `max`                     | 池内连接上限                 | `2 × availableParallelism() + 1` |
| `min`                     | 保底空闲连接数               | `0`                              |
| `connectionTimeoutMillis` | 等待空闲连接的时长上限       | 不超时                           |
| `idleTimeoutMillis`       | 空闲连接回收时间，`0` 不回收 | 10000 ms                         |

node-postgres 会忽略 URL 中的未知参数，所以适配器读取这四个参数交给连接池，并从连接字符串中删除。只接受 `postgresql://…` 形式的 URL。

```ts
const db = createClient({
  connection: "postgresql://app:password@localhost:5432/app?max=20&min=2&connectionTimeoutMillis=5000&idleTimeoutMillis=60000",
});
```

### 会话设置

适配器为每个取出的连接设置 `search_path` 和 `standard_conforming_strings`，不修改会话时区。

### 类型细节

- 驱动的 `int8` 值以字符串返回；模型 `int` 和 ORM 计数经安全范围检查后转为 `number`，模型 `bigint` 保持十进制字符串。
- `string(n)` 生成为带长度校验的 `VARCHAR(n)`，`text` 生成为不限长度的 `TEXT`，两者在 PostgreSQL 中的存储方式相同。
- 布尔值使用原生 `BOOLEAN`，自增键使用 `GENERATED ALWAYS AS IDENTITY`，数据库层也会拒绝显式写入。
- 标识符限制在 63 个 UTF-8 字节以内以避免静默截断重名，索引大小受 PostgreSQL 实际索引条目限制；非唯一关系列显式建索引（外键和多态 id 列都一样）。
- `//` 注释生成为 `COMMENT ON COLUMN` / `COMMENT ON TABLE` 语句，迁移能跟踪注释变更。
- 排序显式使用 `ASC NULLS FIRST` 和 `DESC NULLS LAST`；`LIKE` 遵循 PostgreSQL 的大小写语义。

## 示例

### 创建客户端

```ts
import { createClient } from "./generated/client.ts";

const db = createClient({
  connection: "postgresql://app:password@localhost:5432/app?schema=public",
});
```

### 创建表

用 [`tsorm push`](../migrations.md#push) 或版本化迁移创建表；适配器本身不建表。导出建表 SQL（不连接数据库，`DATABASE_URL` 只用来确定数据库类型）：

```bash
DATABASE_URL=postgresql://user:pass@host:5432/app tsorm diff --from empty
```

手动执行时需要设置正确的 `search_path`，并启用 `standard_conforming_strings`。

### 写入

- `INSERT` 和 `UPDATE` 使用 `RETURNING` 获取实际写入的结果。
- 支持批量写入返回和原生 `ON CONFLICT DO UPDATE`，条件见 [upsert](../../client/update.md#upsert)。

## 注意事项

### 事务与连接

每个根请求从连接池获取一条连接，整个嵌套查询树或写入图共用它；写入自动包裹事务，普通读取直接执行。

- 三种隔离级别都支持，通过 `BEGIN ISOLATION LEVEL` 设置；省略时用会话默认值（`READ COMMITTED`），此时在事务内调用 `findManyAndCount` 报 `TRANSACTION_ISOLATION`。通用行为见[事务](../../client/transactions.md)。
- `ROLLBACK` 失败时丢弃该连接，不放回连接池。`$close()` 关闭连接池；适配器为连接池注册 `error` 监听器，空闲连接故障不会成为未处理异常，也不单独记录日志。

### 迁移注意事项

连接 URL（以及 `DATABASE_URL`）的 `schema` 查询参数同时决定查询与迁移的目标 schema。迁移需要 `CREATEDB` 权限来创建影子库，或设置 `SHADOW_DATABASE_URL`。

### 错误映射

| SQLSTATE | 错误码                   |
| -------- | ------------------------ |
| `23505`  | `UNIQUE_CONSTRAINT`      |
| `23503`  | `FOREIGN_KEY_CONSTRAINT` |
| `23001`  | `FOREIGN_KEY_CONSTRAINT` |
| `23502`  | `NOT_NULL_CONSTRAINT`    |
| `23514`  | `CHECK_CONSTRAINT`       |
| `40001`  | `SERIALIZATION_FAILURE`  |
| `40P01`  | `TRANSACTION_DEADLOCK`   |
| `55P03`  | `LOCK_TIMEOUT`           |
| `57014`  | `QUERY_CANCELLED`        |
| `25P02`  | `TRANSACTION_ABORTED`    |
| 其他     | `DATABASE_ERROR`         |

### 相关链接

- [node-postgres：查询](https://node-postgres.com/features/queries)
- [node-postgres：事务](https://node-postgres.com/features/transactions)
- [node-postgres：连接池](https://node-postgres.com/features/pooling)

## 下一步

- [SQLite](./sqlite.md)：单连接适配器
- [MySQL / MariaDB](./mysql.md)：通过主键回读结果的连接池适配器
- [版本化迁移](../migrations.md)：schema 对比与影子库
