---
description: MySQL / MariaDB 适配器基于 mariadb 连接器，使用连接池、固定的驱动选项、utf8mb4_bin 排序规则，DDL 会隐式提交。
---

# MySQL / MariaDB

## 概述

基于 `mariadb` Node.js Promise 客户端，支持 MySQL 8.0.16+ 和 MariaDB 10.6+；服务器版本在首次操作时检查，而非创建客户端时。

- 驱动：`mariadb`
- 连接：连接池，每个根请求独立获取连接
- 写入结果：按主键回读，本适配器不使用 `RETURNING`
- 事务：写入自动包裹事务，普通读取直接执行
- 隔离级别：三种都支持，通过 `SET TRANSACTION ISOLATION LEVEL` 设置

物理类型对应关系见[类型映射](../overview.md#类型映射)。

## 定义

### 连接选项

| 选项         | 类型     | 默认值 | 说明                                       |
| ------------ | -------- | ------ | ------------------------------------------ |
| `connection` | `string` | 必填   | MySQL 连接 URL，驱动参数通过查询字符串配置 |

### 连接池

连接池完全写在连接 URL 里，参数名就是 mariadb 驱动的参数名：

| URL 参数          | 说明                                 | 默认值                           |
| ----------------- | ------------------------------------ | -------------------------------- |
| `connectionLimit` | 池内连接上限                         | `2 × availableParallelism() + 1` |
| `minimumIdle`     | 保底空闲连接数                       | 等于 `connectionLimit`           |
| `acquireTimeout`  | 等待空闲连接的时长上限，单位毫秒     | 10000 ms                         |
| `idleTimeout`     | 空闲连接回收时间，单位秒，`0` 不回收 | 1800 s                           |

适配器从 URL 读取这些参数，只补上默认的 `connectionLimit`，并在连接前拒绝非法值。只接受 `mysql://…` 与 `mariadb://…` 形式的 URL。

```ts
const db = createClient({
  connection: "mysql://app:password@localhost:3306/app?connectionLimit=20&minimumIdle=2&acquireTimeout=5000&idleTimeout=1800",
});
```

### 固定的驱动选项

为保证结果正确解码，适配器固定以下选项，`connection` 中的同名设置会被覆盖：

`autoJsonMap`、`bigIntAsNumber`、`insertIdAsNumber`、`multipleStatements`、`decimalAsNumber`、`dateStrings`

### 会话设置

适配器为每个取出的连接设置严格写入模式和 `NO_BACKSLASH_ESCAPES`；会话时区只由驱动的 `timezone` 参数控制——`connection` 里写了它，`mariadb` 会在每条连接初始化时执行 `SET time_zone`。

```ts
// 直接写 +08:00 即可：查询字符串会把 + 解码成前导空格，适配器在连接前把它还原成正号
createClient({ connection: "mysql://app:password@localhost:3306/app?timezone=+08:00" });
// %2B 是 + 的百分号编码，写法等价
createClient({ connection: "mysql://app:password@localhost:3306/app?timezone=%2B08%3A00" });
// IANA 时区名同样可用
createClient({ connection: "mysql://app:password@localhost:3306/app?timezone=Asia/Shanghai" });
```

`DATETIME` 不带时区：`Date` 的序列化与反序列化交给驱动，按连接 `timezone`（默认本机时区）处理。数据库默认值（`CURRENT_TIMESTAMP`）按服务器时区生成——要让 ORM 写入与数据库默认值一致，请把 `timezone` 设为服务器时区。`timestamp` 列存 Unix 毫秒，不受会话时区影响。

### 身份验证

MySQL 8.4 默认使用 `caching_sha2_password`；生产环境应配置 TLS 或可信的服务端公钥（`cachingRsaPublicKey`）。`allowPublicKeyRetrieval` 需显式配置。

### 类型细节

- `string` 生成 `VARCHAR(n)`，省略长度时 `n` 取 191——覆盖 `utf8mb4` 下 InnoDB 767 字节的索引键上限，见[为什么 `string` 默认是 191](../../schema/overview.md#为什么-string-默认是-191)。
- `text` 生成不带长度校验的 `LONGTEXT`；它不能作为键或索引，ORM 也不会生成前缀索引。
- 建表固定使用 `utf8mb4_bin`，比较语义包括 `PAD SPACE`，关系分组也按此处理尾部空格。已有数据库应采用生成 DDL 的类型和排序规则，否则不保证查询行为等价。
- `bigint` 字段返回十进制字符串，`int` 字段经安全整数范围检查后返回 `number`。
- 非唯一关系列显式建索引。`//` 注释生成为列和表上的内联 `COMMENT` 子句，迁移用 `ALTER TABLE` 应用注释变更。

## 示例

### 创建客户端

`createClient` 会根据 URL 协议选择适配器：

```ts
import { createClient } from "./generated/client.ts";

const db = createClient({
  connection: "mysql://app:password@localhost:3306/app",
});
```

### 创建表

用 [`tsorm push`](../migrations.md#push) 或版本化迁移创建表；适配器本身不建表。导出建表 SQL（不连接数据库，`DATABASE_URL` 只用来确定数据库类型）：

```bash
DATABASE_URL=mysql://user:pass@host:3306/app tsorm diff --from empty
```

手动执行时需要自行配置 `NO_BACKSLASH_ESCAPES` 和严格写入模式。

### 写入

- 写入在事务内按主键回读。自增主键插入使用 `insertId`，其他插入使用传入的主键。
- `upsert` 在插入的记录只可能在 `where` 的唯一键上冲突时使用 `ON DUPLICATE KEY UPDATE`，否则在同一事务内先查询后写入，见 [upsert](../../client/update.md#upsert)。
- `createManyAndReturn` 在事务内逐条插入并按生成或传入的主键读回；`updateManyAndReturn` 先选出匹配的主键，再逐条更新并读回。
- `skipDuplicates` 逐条执行并只捕获唯一冲突，以保证计数准确。
- 算术更新会逐条回读，以校验结果，包括 `int` 字段的安全整数范围。

## 注意事项

### 事务与连接

每个根请求从连接池获取一条连接，整个嵌套查询树或写入图共用它；写入自动包裹事务，普通读取直接执行。

- 三种隔离级别都支持，通过 `SET TRANSACTION ISOLATION LEVEL` 设置；省略时用会话默认值（MySQL 为 `REPEATABLE READ`）。通用行为见[事务](../../client/transactions.md)。
- `ROLLBACK` 失败时销毁该连接，不放回连接池；`$close()` 关闭适配器创建的连接池。

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
| 1317         | `QUERY_CANCELLED`        |
| 其他         | `DATABASE_ERROR`         |

### 相关链接

- [MariaDB Connector Promise API](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/connector-nodejs-promise-api)
- [MariaDB Connector 连接选项](https://mariadb.com/docs/connectors/mariadb-connector-nodejs/node-js-connection-options)

## 下一步

- [PostgreSQL](./postgres.md)：连接池适配器，使用原生 `RETURNING` 并支持 schema
- [SQLite](./sqlite.md)：单连接适配器
- [版本化迁移](../migrations.md)：迁移失败如何记录和修复
