---
description: SQLite、MySQL / MariaDB 和 PostgreSQL 的能力、类型映射与行为差异。
---

# 能力对比

三种数据库共用模型语法、生成的类型和客户端 API。本页汇总它们之间的差异，配置细节见各数据库页面。

## 概要

| 项目       | SQLite                  | MySQL / MariaDB                | PostgreSQL     |
| ---------- | ----------------------- | ------------------------------ | -------------- |
| 服务器版本 | 无需服务器              | MySQL 8.0+ / MariaDB 10.6+  | 14+            |
| 驱动       | `node:sqlite`           | `mariadb`                      | `pg`           |
| 连接方式   | 单个同步连接            | 连接池                         | 连接池         |
| 参数占位符 | `?`                     | `?`                            | `$1`、`$2`     |
| 标识符引号 | 双引号                  | 反引号                         | 双引号         |

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

所有功能在三种数据库上都可以使用，区别只在实现方式和数据库自身的限制：

| 功能                                         | SQLite | MySQL / MariaDB | PostgreSQL |
| -------------------------------------------- | ------ | --------------- | ---------- |
| CRUD、关系查询、嵌套写入、聚合               | 支持   | 支持            | 支持       |
| 软删除、类型化 JSON、虚拟字段                | 支持   | 支持            | 支持       |
| 版本化迁移                                   | 支持   | 支持            | 支持       |
| `createManyAndReturn`、`updateManyAndReturn` | 支持   | 支持 ¹          | 支持       |
| `upsert`                                     | 支持   | 支持 ²          | 支持       |
| 迁移失败时自动回滚                           | 支持   | 不支持 ³        | 支持       |
| 初始化 DDL 失败时回滚                        | 支持   | 不支持 ³        | 支持       |

1. MySQL 没有 `RETURNING`，ORM 在同一事务内逐条插入并按 `insertId` 读回，或先选出匹配的主键再逐条更新。结果相同，但比单条语句慢。
2. 条件允许时使用单条原生语句：SQLite 和 PostgreSQL 用 `ON CONFLICT DO UPDATE`，MySQL 用 `ON DUPLICATE KEY UPDATE`。MySQL 的条件更严格，因为该语句会在任意唯一键冲突时触发，见 [upsert](../client/writes.md#upsert)。
3. MySQL 的 DDL 会隐式提交事务，这是数据库本身的限制。请保持每个迁移只做一件事，失败时手动检查后再用 `resolve` 处理。

隔离级别的详细行为见[事务](../client/transactions.md#隔离级别)，批量写入的差异见[写入](../client/writes.md#数据库差异)。

## 类型映射

| 模型类型        | SQLite                    | MySQL / MariaDB           | PostgreSQL                       |
| --------------- | ------------------------- | ------------------------- | -------------------------------- |
| `int`、`bigint` | `INTEGER`                 | `BIGINT`                  | `BIGINT`                         |
| `number`        | `REAL`                    | `DOUBLE`                  | `DOUBLE PRECISION`               |
| `decimal(p, s)` | `NUMERIC`（按浮点数存储） | `DECIMAL(p, s)`           | `NUMERIC(p, s)`                  |
| `string`        | `TEXT`                    | `LONGTEXT`                | `TEXT`                           |
| `string(n)`     | `TEXT` + 长度 `CHECK`     | `VARCHAR(n)`              | `VARCHAR(n)`                     |
| `boolean`       | `INTEGER` + 取值 `CHECK`  | `TINYINT(1)` + 取值 `CHECK` | `BOOLEAN`                      |
| `date`          | `TEXT`                    | `DATETIME(3)`             | `TIMESTAMP(3) WITHOUT TIME ZONE` |
| `json<T>`       | `TEXT` + JSON 有效性 `CHECK` | `JSON`                 | `JSONB`                          |
| `bytes`         | `BLOB`                    | `LONGBLOB`              | `BYTEA`                          |
| 字符串联合      | `TEXT` + 枚举 `CHECK`     | `LONGTEXT` + 枚举 `CHECK` | `TEXT` + 枚举 `CHECK`            |
| `int @id @auto` | `INTEGER` + `AUTOINCREMENT` | `BIGINT` + `AUTO_INCREMENT` | `BIGINT` + `GENERATED ALWAYS AS IDENTITY` |

客户端得到的值在三种数据库上相同：

| 模型类型        | 客户端值                                                      |
| --------------- | ------------------------------------------------------------- |
| `int`           | 安全范围内的 `number`，超出范围报 `NUMERIC_OVERFLOW`，不会损失精度 |
| `bigint`        | JavaScript `bigint`，不受安全整数范围限制                     |
| `number`        | 有限的 `number`                                               |
| `decimal`       | 字符串，例如 `"1234.50"`；SQLite 约 15 位有效数字以内准确     |
| `string`        | `string`，长度校验按 Unicode 码点计数                         |
| `boolean`       | `boolean`                                                     |
| `date`          | 毫秒精度的本地日期时间字符串                                  |
| `json<T>`       | 经过结构校验的 JSON 值                                        |
| `bytes`         | `Uint8Array`                                                  |
| 字符串联合      | TypeScript 字符串联合                                         |
| `int @id @auto` | `number`，创建时不能显式赋值                                  |

生成的外键继承目标字段的类型和长度。`@map` 和 `@@map` 改变数据库中的列名和表名，不改变类型。

## 通用查询语义

以下行为在三种数据库上统一：

- 空集合过滤：`in: []` 不匹配，`notIn: []` 匹配全部。
- `NULL` 排序：升序在前，降序在后。
- 稳定排序：自动追加主键。
- 关系分页按每个父记录独立计算，每批最多 200 个父键。

## 仍然存在的差异

- **字符串语义**：排序规则、大小写、`LIKE` 和尾随空格比较遵循各数据库自身的规则。
- **日期范围**：可存储范围依赖数据库，MySQL 适配器校验年份为 1000 到 9999。
- **索引限制**：实际的索引字节数、复合索引和总行大小由服务器决定。
- **并发行为**：锁、死锁和事务冲突由数据库决定。
