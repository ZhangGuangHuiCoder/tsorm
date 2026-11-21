---
description: 生成的客户端提供的全部方法、参数和返回值。
---

# 客户端 API

本页列出生成的客户端提供的全部成员；用法和示例见[客户端](../client/overview.md)章节。

## 客户端方法

| 成员            | 返回值               | 说明                                                                                                                          |
| --------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `$transaction`  | `Promise<回调结果>`  | 执行事务，见[事务](../client/transactions.md)                                                                                 |
| `$queryRaw`     | `Promise<T>`         | 执行原生查询，见[原生 SQL](../client/raw-sql.md)                                                                              |
| `$executeRaw`   | `Promise<number>`    | 执行原生写入，返回受影响的行数                                                                                                |
| `$clear`        | `Promise<{ count }>` | 显式清空整表，见[删除](../client/delete.md#清空整表)                                                                          |
| `$capabilities` | `Capabilities`       | 只读属性，当前适配器的能力                                                                                                    |
| `$extend`       | 新的客户端实例       | 用 `virtuals` 与 `omit` 扩展客户端并叠加到当前配置之上；扩展后的客户端共享连接、事务与关闭，见[扩展](../client/extensions.md) |
| `$close`        | `Promise<void>`      | 等待进行中的请求，然后关闭连接；从未连接过的客户端直接返回，不建立连接                                                        |

事务回调的 `tx` 提供模型方法、`$clear`、`$queryRaw` 和 `$executeRaw`。

## 读取方法

模型方法均为异步方法；下表为 `await` 后的结果，`T` 由投影决定（`select`，或 `include` 与 `omit` 的组合）。

| 方法                | 主要参数                                                                  | 返回值                         |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------ |
| `findMany`          | `where`、`orderBy`、`skip`、`take`、`cursor`、`distinct`、`deleted`、投影 | `T[]`                          |
| `findFirst`         | 同 `findMany`                                                             | `T \| null`                    |
| `findFirstOrThrow`  | 同 `findMany`                                                             | `T`                            |
| `findUnique`        | `where`（唯一键）、`deleted`、投影                                        | `T \| null`                    |
| `findUniqueOrThrow` | `where`（唯一键）、`deleted`、投影                                        | `T`                            |
| `findManyAndCount`  | 同 `findMany`                                                             | `{ data: T[]; total: number }` |
| `count`             | `where`、`distinct`、`deleted`                                            | `number`                       |
| `aggregate`         | `where`、`deleted`、`orderBy`、`skip`、`take`、聚合选项                   | 聚合结果                       |
| `groupBy`           | `by`、`where`、`deleted`、`having`、`orderBy`、`skip`、`take`、聚合选项   | 分组结果数组                   |

## 写入方法

| 方法                  | 主要参数                                    | 返回值              |
| --------------------- | ------------------------------------------- | ------------------- |
| `create`              | `data`、投影                                | `T`                 |
| `createMany`          | `data[]`、`skipDuplicates`                  | `{ count: number }` |
| `createManyAndReturn` | `data[]`、`skipDuplicates`、投影            | `T[]`               |
| `update`              | `where`（唯一键）、`data`、投影             | `T`                 |
| `updateMany`          | `where`、`data`                             | `{ count: number }` |
| `updateManyAndReturn` | `where`、`data`、投影                       | `T[]`               |
| `upsert`              | `where`（唯一键）、`create`、`update`、投影 | `T`                 |
| `delete`              | `where`（唯一键）、投影                     | `T`                 |
| `deleteMany`          | `where`                                     | `{ count: number }` |

在 MySQL 上，`createManyAndReturn` 和 `updateManyAndReturn` 通过事务内逐条写入实现，见[新增](../client/create.md#数据库差异)与[更新](../client/update.md#数据库差异)。顶层批量更新、删除和恢复必须提供非空 `where`；`maxAffected` 与清空整表见[写入安全](../client/overview.md#写入安全)，嵌套操作使用[父关系范围](../client/relation-writes.md#作用范围)。

## 软删除方法

| 方法              | 主要参数                | 返回值              |
| ----------------- | ----------------------- | ------------------- |
| `restore`         | `where`（唯一键）、投影 | `T`                 |
| `restoreMany`     | `where`                 | `{ count: number }` |
| `forceDelete`     | `where`（唯一键）、投影 | `T`                 |
| `forceDeleteMany` | `where`                 | `{ count: number }` |

## 限制值

| 项目                    | 上限               |
| ----------------------- | ------------------ |
| `where` 嵌套深度        | 12                 |
| `having` 嵌套深度       | 12                 |
| 投影嵌套深度            | 8                  |
| 嵌套写入深度            | 8                  |
| JSON 嵌套深度           | 64                 |
| 关系加载每批父键数      | 200                |
| `createMany` 每批参数数 | 约 900（保守预算） |
| `string(n)` 长度        | 16383              |

## 包入口

下面六张表逐项列出每个入口的完整公开符号，`type` 表示仅类型导出；源码中标记 `@internal` 的符号、适配器连接池接口和 PostgreSQL 字面量 helper 不在承诺范围内。

<!-- exports:root -->

### `@ofis/tsorm`

| 符号                      | 说明                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| `internalCreateClient`    | 供生成客户端内部装配；用结构定义与连接 URL 创建客户端，scheme 决定适配器 |
| `sql`                     | 原生 SQL 片段的标签模板                                                  |
| `OrmError`                | 带 `code` 的运行时错误                                                   |
| `DbNull`                  | 向可空 JSON 列写入数据库 `NULL` 的哨兵                                   |
| `JsonNull`                | 写入 JSON `null` 的哨兵                                                  |
| `type ClientOptions`      | `internalCreateClient` 接受的配置                                        |
| `type Client`             | 与数据库无关的客户端                                                     |
| `type TxClient`           | 事务回调中可用的客户端接口                                               |
| `type Spec`               | 生成的模型规格                                                           |
| `type Query`              | 查询构建器接口                                                           |
| `type Payload`            | 查询解析后的载荷                                                         |
| `type Where`              | 过滤表达式                                                               |
| `type OrderBy`            | 排序表达式                                                               |
| `type JsonFilter`         | JSON 路径过滤表达式                                                      |
| `type FieldUpdate`        | 字段级更新表达式                                                         |
| `type DecimalUpdate`      | 小数值、`{ set }` 或算术更新表达式                                       |
| `type Invalid`            | 非法输入的标记类型                                                       |
| `type OmitFields`         | 按模型配置的省略字段                                                     |
| `type GlobalOmit`         | 客户端级省略配置                                                         |
| `type WithOmit`           | 应用省略后的结果类型                                                     |
| `type SortOrder`          | `asc`、`desc`，或用 `{ sort, nulls? }` 指定 NULL 位置                    |
| `type AggregateArgs`      | `aggregate` 的参数                                                       |
| `type AggregateResult`    | `aggregate` 的结果                                                       |
| `type GroupByArgs`        | `groupBy` 的参数                                                         |
| `type GroupByResult`      | `groupBy` 的结果                                                         |
| `type JsonInput`          | JSON 列输入类型                                                          |
| `type JsonShape`          | JSON 结构类型                                                            |
| `type Schema`             | 解析后的结构定义                                                         |
| `type Adapter`            | 适配器工厂约定                                                           |
| `type RuntimeAdapter`     | 已连接适配器的约定                                                       |
| `type Dialect`            | 查询编译器使用的 SQL 方言约定                                            |
| `type Session`            | 租用的数据库会话                                                         |
| `type CompiledSQL`        | 编译后的语句                                                             |
| `type QueryResult`        | 语句执行结果                                                             |
| `type Capabilities`       | 各适配器的能力标记                                                       |
| `type TransactionOptions` | 事务的 `maxWait`、`timeout` 与隔离级别设置                               |
| `type IsolationLevel`     | 支持的隔离级别                                                           |
| `type Logger`             | 日志回调                                                                 |
| `type ClientEvent`        | 客户端生命周期事件                                                       |
| `type SqlQuery`           | 原生 SQL 片段                                                            |
| `type RawClient`          | 原生查询接口                                                             |
| `type Virtuals`           | 计算字段声明                                                             |
| `type WithVirtuals`       | 带计算字段的结果类型                                                     |
| `type DeletedMode`        | 软删除可见性模式                                                         |

<!-- exports:schema -->

### `@ofis/tsorm/schema`

| 符号                     | 说明                                     |
| ------------------------ | ---------------------------------------- |
| `parseSchema`            | 把结构定义源码字符串解析为 `Schema`      |
| `schemaErrors`           | 一次性收集全部解析错误，供编辑器诊断使用 |
| `generateClient`         | 生成 TypeScript 客户端源码               |
| `SchemaError`            | 带 `line` 与 `column` 的解析错误         |
| `referentialActions`     | 各引用动作的 SQL 拼写                    |
| `type Schema`            | 解析后的结构定义                         |
| `type Table`             | 解析后的模型                             |
| `type Column`            | 解析后的字段                             |
| `type Relation`          | 解析后的关系                             |
| `type Scalar`            | 标量列类型联合                           |
| `type ReferentialAction` | 引用动作联合                             |

<!-- exports:migrations -->

### `@ofis/tsorm/migrations`

| 符号                     | 说明                       |
| ------------------------ | -------------------------- |
| `migrate`                | 创建并应用迁移             |
| `deploy`                 | 应用尚未执行的迁移         |
| `status`                 | 报告已应用与待应用的迁移   |
| `resolve`                | 将迁移标记为已应用或已回滚 |
| `diff`                   | 对两个来源做结构差异       |
| `push`                   | 将结构直接推送到数据库     |
| `MigrationError`         | 带 `code` 的迁移错误       |
| `type Prompter`          | 交互步骤的确认回调         |
| `type CommandOptions`    | 迁移函数共用的选项         |
| `type MigrateResult`     | `migrate` 的返回值         |
| `type StatusResult`      | `status` 的返回值          |
| `type DiffSource`        | `diff` 的来源选择器        |
| `type DiffResult`        | `diff` 的返回值            |
| `type SchemaDiff`        | 结构差异描述               |
| `type MigrationProvider` | 数据库专属的迁移提供者     |

<!-- exports:sqlite -->

### `@ofis/tsorm/adapters/sqlite`

| 符号                 | 说明               |
| -------------------- | ------------------ |
| `sqlite`             | 创建 SQLite 适配器 |
| `sqliteSchemaSQL`    | 生成 SQLite DDL    |
| `type SQLiteOptions` | SQLite 适配器配置  |

<!-- exports:mysql -->

### `@ofis/tsorm/adapters/mysql`

| 符号                | 说明                      |
| ------------------- | ------------------------- |
| `mysql`             | 创建 MySQL/MariaDB 适配器 |
| `mysqlSchemaSQL`    | 生成 MySQL DDL            |
| `type MySQLOptions` | MySQL 适配器配置          |

<!-- exports:postgres -->

### `@ofis/tsorm/adapters/postgres`

| 符号                   | 说明                   |
| ---------------------- | ---------------------- |
| `postgres`             | 创建 PostgreSQL 适配器 |
| `postgresSchemaSQL`    | 生成 PostgreSQL DDL    |
| `type PostgresOptions` | PostgreSQL 适配器配置  |

<!-- exports:end -->

## 生成的类型

对于每个模型，生成的客户端导出 `<Model>Row`、`<Model>Create`、`<Model>Update`、`<Model>ScalarCreate`、`<Model>ScalarUpdate` 和 `<Model>Unique` 等类型，例如 `UserRow`。

## 下一步

- [客户端概览](../client/overview.md)：创建与配置客户端
- [查询](../client/queries.md)：读方法的详细说明
- [错误码](./errors.md)：这些方法可能抛出的错误
