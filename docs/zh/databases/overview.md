---
description: SQLite、MySQL / MariaDB 和 PostgreSQL 的能力、类型映射与行为差异。
---

# 能力对比

三种数据库共用模型语法、生成的类型和客户端 API。本页汇总它们之间的差异，配置细节见各数据库页面。

## 概要

| 项目       | SQLite        | MySQL / MariaDB               | PostgreSQL |
| ---------- | ------------- | ----------------------------- | ---------- |
| 服务器版本 | 无需服务器    | MySQL 8.0.16+ / MariaDB 10.6+ | 14+        |
| 驱动       | `node:sqlite` | `mariadb`                     | `pg`       |
| 连接方式   | 单个同步连接  | 连接池                        | 连接池     |
| 参数占位符 | `?`           | `?`                           | `$1`、`$2` |
| 标识符引号 | 双引号        | 反引号                        | 双引号     |

## 客户端能力

下表对应 [`db.$capabilities`](../client/overview.md#读取数据库能力) 的字段：

| 字段                  | SQLite         | MySQL / MariaDB | PostgreSQL |
| --------------------- | -------------- | --------------- | ---------- |
| `returning`           | 是             | 否              | 是         |
| `windowFunctions`     | 是             | 是              | 是         |
| `transactionalDDL`    | 是             | 否              | 是         |
| `versionedMigrations` | 是             | 是              | 是         |
| `isolationLevels`     | `serializable` | 全部三种        | 全部三种   |

## 功能差异

ORM 在三种数据库上追求同一套功能，差异只在实现方式与数据库自身的限制：

| 功能                                         | SQLite | MySQL / MariaDB | PostgreSQL |
| -------------------------------------------- | ------ | --------------- | ---------- |
| CRUD、关系查询、嵌套写入、聚合               | 支持   | 支持            | 支持       |
| 软删除、类型化 JSON、虚拟字段                | 支持   | 支持            | 支持       |
| 版本化迁移                                   | 支持   | 支持            | 支持       |
| `createManyAndReturn`、`updateManyAndReturn` | 支持   | 支持 ¹          | 支持       |
| `upsert`                                     | 支持   | 支持 ²          | 支持       |
| 迁移失败时自动回滚                           | 支持   | 逐条提交 ³      | 支持       |
| 初始化 DDL 失败时回滚                        | 支持   | 逐条提交 ³      | 支持       |

1. MySQL / MariaDB 适配器不使用 `RETURNING`。批量返回采用逐条写入和主键回读，需要额外 SQL；具体策略见下方写入专题。
2. 条件允许时使用单条原生语句：SQLite 和 PostgreSQL 用 `ON CONFLICT DO UPDATE`，MySQL 用 `ON DUPLICATE KEY UPDATE`。MySQL 的条件更严格，因为该语句会在任意唯一键冲突时触发，见 [upsert](../client/update.md#upsert)。
3. MySQL 的 DDL 会隐式提交事务，这是数据库本身的限制。请保持每个迁移只做一件事，失败时手动检查后再用 `resolve` 处理。

隔离级别的详细行为见[事务](../client/transactions.md#隔离级别)，批量写入的差异见[新增](../client/create.md#数据库差异)与[更新](../client/update.md#数据库差异)。

## 类型映射

| 模型类型              | SQLite                       | MySQL / MariaDB               | PostgreSQL                                |
| --------------------- | ---------------------------- | ----------------------------- | ----------------------------------------- |
| `int`、`bigint`       | `INTEGER`                    | `BIGINT`                      | `BIGINT`                                  |
| `number`              | `REAL`                       | `DOUBLE`                      | `DOUBLE PRECISION`                        |
| `decimal(p, s)`       | `NUMERIC`（数值亲和性）      | `DECIMAL(p, s)`               | `NUMERIC(p, s)`                           |
| `string`、`string(n)` | `TEXT` + 长度 `CHECK`        | `VARCHAR(n)`                  | `VARCHAR(n)`                              |
| `text`                | `TEXT`                       | `LONGTEXT`                    | `TEXT`                                    |
| `boolean`             | `INTEGER` + 取值 `CHECK`     | `TINYINT(1)` + 取值 `CHECK`   | `BOOLEAN`                                 |
| `datetime`            | `TEXT`                       | `DATETIME(3)`                 | `TIMESTAMP(3) WITHOUT TIME ZONE`          |
| `timestamp`           | `INTEGER`                    | `BIGINT`                      | `BIGINT`                                  |
| `json<T>`             | `TEXT` + JSON 有效性 `CHECK` | `JSON`                        | `JSONB`                                   |
| `bytes`               | `BLOB`                       | `LONGBLOB`                    | `BYTEA`                                   |
| 字符串联合            | `TEXT` + 枚举 `CHECK`        | `VARCHAR(191)` + 枚举 `CHECK` | `VARCHAR(191)` + 枚举 `CHECK`             |
| `int @id @auto`       | `INTEGER` + `AUTOINCREMENT`  | `BIGINT` + `AUTO_INCREMENT`   | `BIGINT` + `GENERATED ALWAYS AS IDENTITY` |

`string(n)` 省略长度时 `n` 取 191，因此 `string` 在 MySQL 与 PostgreSQL 上是 `VARCHAR(191)`，在 SQLite 上是带长度 `CHECK` 的 `TEXT`；默认值的由来见[为什么 `string` 默认是 191](../schema/overview.md#为什么-string-默认是-191)。`text` 不限长度：MySQL 存为 `LONGTEXT`（减少行内长度压力，仍受数据库限制），PostgreSQL 与 SQLite 存为不带长度 `CHECK` 的 `TEXT`。由于 MySQL 无法直接索引 `LONGTEXT`（需要前缀索引），`text` 不能作为键或索引。

客户端在各适配器上使用以下结果类型，但存储精度和数据库限制仍有差异：

| 模型类型                | 客户端值                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| `int`                   | 安全范围内的 `number`，超出范围报 `NUMERIC_OVERFLOW`，保持整数精度 |
| `bigint`                | 十进制整数字符串，保持整数精度                                     |
| `number`                | 有限的 `number`                                                    |
| `decimal`               | 字符串，例如 `"1234.50"`；SQLite 的浮点存储可能丢失精度            |
| `string`                | `string`，长度校验按 Unicode 码点计数                              |
| `text`                  | `string`，不限长度                                                 |
| `boolean`               | `boolean`                                                          |
| `datetime`、`timestamp` | 毫秒精度字符串，由 `datetimeFormat` 选择 `local` 或 `utc` 格式     |
| `json<T>`               | 经过结构校验的 JSON 值                                             |
| `bytes`                 | `Uint8Array`                                                       |
| 字符串联合              | TypeScript 字符串联合                                              |
| `int @id @auto`         | `number`，创建时自动生成                                           |

生成的外键继承目标字段的类型和长度。`@map` 和 `@@map` 改变数据库中的列名和表名，不改变类型。

## 通用查询语义

以下行为在三种数据库上统一：

- 空集合过滤：`in: []` 不匹配，`notIn: []` 匹配全部。
- `NULL` 排序：升序在前，降序在后。
- 稳定排序：自动追加主键。
- 关系分页按每个父记录独立计算，每批最多 200 个父键。

## 仍然存在的差异

- **字符串语义**：排序规则、大小写、`LIKE` 和尾随空格比较遵循各数据库自身的规则。
- **日期范围**：可存储范围依赖数据库，MySQL 适配器对 `datetime` 校验年份为 1000 到 9999，不适用于整数 `timestamp` 存储。
- **索引限制**：实际的索引字节数、复合索引和总行大小由服务器决定。
- **并发行为**：锁、死锁和事务冲突由数据库决定。

## 下一步

- [适配器](./adapters/overview.md)：各适配器的连接选项与类型细节
- [版本化迁移](./migrations.md)：把结构变更应用到真实数据库
- [事务](../client/transactions.md)：隔离级别与失败语义
