---
description: MySQL / MariaDB 适配器基于 mariadb 连接器，使用连接池、固定的驱动选项、utf8mb4_bin 排序规则，DDL 会隐式提交。
---

# MySQL / MariaDB

## 概述

基于 `mariadb` Node.js Promise 客户端。支持 MySQL 8.0.16 及以上和 MariaDB 10.6 及以上，受管理的表必须使用 InnoDB。适配器在启动时检查服务器版本和已有表的存储引擎。

- 驱动：`mariadb`
- 连接：连接池，每个根请求独立获取连接
- 写入结果：按主键回读，本适配器不使用 `RETURNING`
- 事务：写入自动包裹事务，普通读取直接执行
- 隔离级别：三种都支持，通过 `SET TRANSACTION ISOLATION LEVEL` 设置

物理类型对应关系见[类型映射](../overview.md#类型映射)。

## 定义

### 连接选项

| 选项         | 类型      | 默认值  | 说明                                       |
| ------------ | --------- | ------- | ------------------------------------------ |
| `connection` | `string`  | 必填    | MySQL 连接 URL，驱动参数通过查询字符串配置 |
| `initialize` | `boolean` | `false` | 在空数据库中创建全部表，见下文             |

### 固定的驱动选项

为保证结果能够正确解码，适配器固定了以下选项，`connection` 中的同名设置会被覆盖：

`dateStrings`、`timezone`、`autoJsonMap`、`bigIntAsNumber`、`insertIdAsNumber`、`multipleStatements`、`decimalAsNumber`

### 会话设置

适配器为每个取出的连接设置 UTC 会话时区、严格写入模式和 `NO_BACKSLASH_ESCAPES`。

### 身份验证

MySQL 8.4 默认使用 `caching_sha2_password`。生产环境应配置 TLS 或可信的服务端公钥（`cachingRsaPublicKey`）。`allowPublicKeyRetrieval` 需显式配置。

### 类型细节

- `string` 生成 `VARCHAR(n)`，省略长度时 `n` 取 191，字符串主键与索引无需额外标注。191 覆盖了 `utf8mb4` 下 InnoDB 767 字节的索引键上限——该字符集一个字符最多占 4 字节；由来见[为什么 `string` 默认是 191](../../schema/overview.md#为什么-string-默认是-191)。
- `text` 生成不带长度校验的 `LONGTEXT`，适合大段文本，可减少行内长度压力，但仍受数据库限制。它不能作为键或索引，ORM 也不会生成前缀索引。
- 建表固定使用 `utf8mb4_bin`。该排序规则的比较语义包括 `PAD SPACE`，应用层的关系分组也按此处理尾部空格。
- 已有数据库应采用生成 DDL 的类型和排序规则，查询行为以生成 DDL 的类型和排序规则为准。
- `datetime` 年份必须在 1000 到 9999 之间；整数 `timestamp` 存储不受此 DATETIME 限制。
- `bigint` 模型字段返回十进制字符串；`int` 字段经过安全整数范围检查后返回 `number`。
- 非唯一关系列显式建索引。
- `//` 注释生成为列和表上的内联 `COMMENT` 子句；迁移用 `ALTER TABLE` 应用注释变更。

## 示例

### 创建客户端

```ts
import { createClient } from "./generated/client.ts";
import { mysql } from "@ofis/tsorm/adapters/mysql";

const db = await createClient({
  adapter: mysql({
    connection: "mysql://app:password@localhost:3306/app",
  }),
});
```

### 初始化

`initialize: true` 要求所选数据库为空，否则报 `DATABASE_NOT_EMPTY`。适配器先创建所有表和索引，再添加外键，因此支持循环模型引用。

::: danger DDL 不可回滚
MySQL 的 DDL 会隐式提交事务，初始化失败可能留下部分表，需要人工检查和清理。同一个数据库只由一个进程初始化。
:::

导出建表 SQL（不连接数据库，`DATABASE_URL` 只用来确定数据库类型）：

```bash
DATABASE_URL=mysql://user:pass@host:3306/app tsorm diff --from empty
```

手动执行时需要自行配置 `NO_BACKSLASH_ESCAPES`、严格写入模式和 UTC 时区。

### 写入

- 写入在事务内按主键回读。自增主键插入使用 `insertId`，其他插入使用传入的主键。
- `upsert` 在插入的记录只可能在 `where` 的唯一键上冲突时使用 `ON DUPLICATE KEY UPDATE`，否则在同一事务内先查询后写入，见 [upsert](../../client/update.md#upsert)。
- `createManyAndReturn` 在事务内逐条插入并按生成或传入的主键读回；`updateManyAndReturn` 先选出匹配的主键，再逐条更新并读回。
- `skipDuplicates` 逐条执行并只捕获唯一冲突，以保证计数准确。
- 算术更新会逐条回读，以校验结果，包括 `int` 字段的安全整数范围。

## 注意事项

### 事务与连接

每个根请求从连接池独立获取连接，整个嵌套查询树或写入图使用同一连接。写入自动包裹事务，普通读取直接执行。

- 支持三种隔离级别，通过 `SET TRANSACTION ISOLATION LEVEL` 设置。
- 省略隔离级别时使用会话默认值（MySQL 为 `REPEATABLE READ`）。
- `ROLLBACK` 失败时销毁该连接，不放回连接池。
- `$close()` 会关闭适配器创建的连接池。

通用行为见[事务](../../client/transactions.md)。

### 迁移注意事项

MySQL 的 DDL 无法回滚，迁移失败时已执行的语句会保留，见[失败与修复](../migrations.md#resolve)。迁移需要为影子库建库的权限，或设置 `SHADOW_DATABASE_URL`。

### 错误映射

| MySQL 错误号 | 错误码                   |
| ------------ | ------------------------ |
| 1062         | `UNIQUE_CONSTRAINT`      |
| 1451、1452   | `FOREIGN_KEY_CONSTRAINT` |
| 1048         | `NOT_NULL_CONSTRAINT`    |
| 3819、4025   | `CHECK_CONSTRAINT`       |
| 1213         | `TRANSACTION_DEADLOCK`   |
| 1205         | `LOCK_TIMEOUT`           |
| 其他         | `DATABASE_ERROR`         |

### 相关链接

- [MariaDB Connector Promise API](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api)
- [MariaDB Connector 连接选项](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options)

## 下一步

- [PostgreSQL](./postgres.md)：连接池适配器，使用原生 `RETURNING` 并支持 schema
- [SQLite](./sqlite.md)：单连接适配器
- [版本化迁移](../migrations.md)：迁移失败如何记录和修复
