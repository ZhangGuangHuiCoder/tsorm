---
description: 生成的客户端提供的全部方法、参数和返回值。
---

# 客户端 API

本页列出生成的客户端提供的全部成员。用法和示例见[客户端](../client/overview.md)章节。

## 客户端方法

| 成员            | 返回值               | 说明                                                                                                                          |
| --------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `$transaction`  | `Promise<回调结果>`  | 执行事务，见[事务](../client/transactions.md)                                                                                 |
| `$queryRaw`     | `Promise<T>`         | 执行原生查询，见[原生 SQL](../client/raw-sql.md)                                                                              |
| `$executeRaw`   | `Promise<number>`    | 执行原生写入，返回受影响的行数                                                                                                |
| `$clear`        | `Promise<{ count }>` | 显式清空整表，见[删除](../client/delete.md#清空整表)                                                                          |
| `$capabilities` | `Capabilities`       | 只读属性，当前适配器的能力                                                                                                    |
| `$extend`       | 新的客户端实例       | 用 `virtuals` 与 `omit` 扩展客户端并叠加到当前配置之上；扩展后的客户端共享连接、事务与关闭，见[扩展](../client/extensions.md) |
| `$close`        | `Promise<void>`      | 等待进行中的请求，然后关闭连接                                                                                                |

事务回调的 `tx` 提供模型方法、`$clear`、`$queryRaw` 和 `$executeRaw`。

## 读取方法

模型方法均为异步方法。读取、写入和软删除表中的返回值表示 `await` 后的结果；`T` 由投影决定。

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

投影指 `select`，或者 `include` 和 `omit` 的组合。

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

在 MySQL 上，`createManyAndReturn` 和 `updateManyAndReturn` 通过事务内逐条写入实现，见[新增](../client/create.md#数据库差异)与[更新](../client/update.md#数据库差异)。

顶层批量更新、删除和恢复必须提供非空 `where`。`maxAffected` 与清空整表见[写入安全](../client/overview.md#写入安全)；嵌套操作使用[父关系范围](../client/relation-writes.md#作用范围)。

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

| 入口                            | 内容                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `@ofis/tsorm`                   | `OrmError`、`sql`、`DbNull`、`JsonNull` 及公共类型                           |
| `@ofis/tsorm/adapters/sqlite`   | `sqlite`、`sqliteSchemaSQL`                                                  |
| `@ofis/tsorm/adapters/mysql`    | `mysql`、`mysqlSchemaSQL`                                                    |
| `@ofis/tsorm/adapters/postgres` | `postgres`、`postgresSchemaSQL`                                              |
| `@ofis/tsorm/schema`            | `parseSchema`、`generateClient`、`SchemaError`                               |
| `@ofis/tsorm/migrations`        | `migrate`、`deploy`、`status`、`resolve`、`diff`、`push` 和 `MigrationError` |

## 生成的类型

对于每个模型，生成的客户端都会导出 `<Model>Row`、`<Model>Create`、`<Model>Update`、`<Model>ScalarCreate`、`<Model>ScalarUpdate` 和 `<Model>Unique` 等类型，例如 `UserRow`。

## 下一步

- [客户端概览](../client/overview.md)：创建与配置客户端
- [查询](../client/queries.md)：读方法的详细说明
- [错误码](./errors.md)：这些方法可能抛出的错误
