---
description: PostgreSQL 适配器基于 pg，使用连接池、可配置的 schema、原生 RETURNING 和 BOOLEAN 类型，支持三种隔离级别。
---

# PostgreSQL

## 概述

基于 `pg`（node-postgres）。支持 PostgreSQL 14 及以上，适配器在启动时检查服务器版本。

- 驱动：`pg`
- 连接：连接池，每个根请求独立获取连接
- 写入结果：原生 `RETURNING`
- 事务：写入自动包裹事务，普通读取直接执行
- 隔离级别：三种都支持，通过 `BEGIN ISOLATION LEVEL` 设置
- schema：`dbSchema` 指定目标 schema，默认为 `public`

物理类型对应关系见[类型映射](../overview.md#类型映射)。

## 定义

### 连接选项

| 选项         | 类型      | 默认值   | 说明                                            |
| ------------ | --------- | -------- | ----------------------------------------------- |
| `connection` | `string`  | 必填     | PostgreSQL 连接 URL，驱动参数通过查询字符串配置 |
| `dbSchema`   | `string`  | `public` | 目标 schema，使用已创建的业务 schema            |
| `initialize` | `boolean` | `false`  | 在空 schema 中创建全部表，见下文                |

::: warning 类型解析器
适配器使用局部类型解析配置，保留 bigint 精度并执行范围检查。
:::

### 会话设置

适配器为每个取出的连接设置 `search_path`、UTC 时区和 `standard_conforming_strings`。

### 类型细节

- 驱动的 `int8` 值以字符串返回；模型 `int` 和 ORM 计数经安全范围检查后转为 `number`，模型 `bigint` 保持十进制字符串。
- `string(n)` 生成为带长度校验的 `VARCHAR(n)`，`text` 生成为不限长度的 `TEXT`，两者在 PostgreSQL 中的存储方式相同。
- 布尔值使用原生 `BOOLEAN`，不附加取值 `CHECK`。
- 自增键使用 `GENERATED ALWAYS AS IDENTITY`，数据库层也会拒绝显式写入。
- 所有标识符限制在 63 个 UTF-8 字节以内，以避免被静默截断后重名。
- 索引大小仍受 PostgreSQL 实际索引条目大小限制。
- 排序显式使用 `ASC NULLS FIRST` 和 `DESC NULLS LAST`。
- `LIKE` 遵循 PostgreSQL 的大小写语义。

## 示例

### 创建客户端

```ts
import { createClient } from "./generated/client.ts";
import { postgres } from "@ofis/tsorm/adapters/postgres";

const db = await createClient({
  adapter: postgres({
    connection: "postgresql://app:password@localhost:5432/app",
    dbSchema: "public",
  }),
});
```

### 初始化

`initialize: true` 要求目标 schema 中没有表、视图和序列，否则报 `DATABASE_NOT_EMPTY`。目标 schema 不存在时报 `SCHEMA_NOT_FOUND`。

初始化在一个事务内运行，失败时回滚全部 DDL。它持有以数据库和 schema 为范围的 advisory lock：并发初始化时，后到者等待锁释放，然后因 schema 非空被拒绝。

导出建表 SQL（不连接数据库，`DATABASE_URL` 只用来确定数据库类型）：

```bash
DATABASE_URL=postgresql://user:pass@host:5432/app tsorm diff --from empty
```

手动执行时需要设置正确的 `search_path`，并启用 `standard_conforming_strings`。

### 写入

- `INSERT` 和 `UPDATE` 使用 `RETURNING` 获取实际写入的结果。
- 支持批量写入返回和原生 `ON CONFLICT DO UPDATE`，条件见 [upsert](../../client/update.md#upsert)。

## 注意事项

### 事务与连接

每个根请求从连接池独立获取连接，整个嵌套查询树或写入图使用同一连接。写入自动包裹事务，普通读取直接执行。

- 支持三种隔离级别，通过 `BEGIN ISOLATION LEVEL` 设置。
- 省略隔离级别时使用会话默认值（PostgreSQL 为 `READ COMMITTED`），此时在事务内调用 `findManyAndCount` 报 `TRANSACTION_ISOLATION`。
- `ROLLBACK` 失败时丢弃该连接，不放回连接池。
- `$close()` 会关闭适配器创建的连接池。
- 适配器为连接池注册了 `error` 监听器，防止空闲连接故障变成未处理异常。此类空闲连接错误当前不会单独记录到日志。

通用行为见[事务](../../client/transactions.md)。

### 迁移注意事项

`DATABASE_URL` 的 `schema` 参数对应 `dbSchema`。迁移需要 `CREATEDB` 权限来创建影子库，或设置 `SHADOW_DATABASE_URL`。

### 错误映射

| SQLSTATE | 错误码                   |
| -------- | ------------------------ |
| `23505`  | `UNIQUE_CONSTRAINT`      |
| `23503`  | `FOREIGN_KEY_CONSTRAINT` |
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
