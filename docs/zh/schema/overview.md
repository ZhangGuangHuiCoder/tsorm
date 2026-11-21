---
description: schema.orm 的字段类型、默认值、字段属性和保留名称。
---

# 模型与字段

## 模型基础

每个模型必须有一个主键：单字段主键用 `@id`，复合主键用 `@@id`。

```ts
model User {
  id: int @id @auto
  email: string @unique
  name?: string
  enabled: boolean = true
  createdAt: datetime = now()
}
```

字段的完整写法是 `名称[?]: 类型 [= 默认值] [属性...]`，属性写在默认值之后：

```ts
model Token {
  id: string(36) = uuid() @id
  value: string
}
```

## 字段类型

| 类型                   | 说明                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `int`                  | JavaScript 安全整数范围内的整数，读取为 `number`                                           |
| `bigint`               | 64 位整数，读取为 `string`；写入接受整数字符串、`bigint` 或安全整数；物理类型与 `int` 相同 |
| `number`               | 有限浮点数                                                                                 |
| `decimal(p, s)`        | 小数，读取为字符串，写入接受字符串或数字；`p` 取 1 到 65，`s` 取 0 到 30 且不能大于 `p`    |
| `string` / `string(n)` | 字符串，`n` 取 1 到 16383，按 Unicode 码点计数；省略长度时为 191                           |
| `text`                 | 不限长度字符串，不能作为键或索引                                                           |
| `boolean`              | 布尔值                                                                                     |
| `datetime`             | 存储日期时间；读写均为 `Date`，见[日期与时区](../client/datetime.md)                       |
| `timestamp`            | Unix 毫秒时间戳，存为整数列；读写均为 `Date`                                               |
| `"a" \| "b"`           | 字符串字面量联合，由数据库 `CHECK` 约束取值                                                |
| `json<T>`              | 类型化 JSON，见[类型化 JSON](./json.md)                                                    |
| `bytes`                | 二进制数据，读写为 `Uint8Array`                                                            |

字段名后加 `?` 表示可空；未显式声明默认值时默认为 `NULL`。各类型对应的物理类型见[类型映射](../databases/overview.md#类型映射)。写入值超出显式声明的位数或小数位时报 `VALIDATION`；省略 `(p, s)` 时只受数据库限制（MySQL 使用 `DECIMAL(65,30)`，SQLite 的 NUMERIC 亲和性不保证精确小数）。

### 为什么 `string` 默认是 191

MySQL 旧行格式的索引上限是 767 字节，utf8mb4 每字符最多 4 字节，取整得 191。更长可用 `string(n)`。

## 默认值

| 写法       | 说明                                       |
| ---------- | ------------------------------------------ |
| `= 字面量` | 固定默认值，类型必须与字段一致             |
| `= now()`  | 当前时间，适用于 `datetime` 和 `timestamp` |
| `= uuid()` | 生成 UUID，仅用于字符串，长度不小于 36     |

## 字段属性

| 属性             | 说明                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `@id`            | 单字段主键                                                                                                     |
| `@auto`          | 自动生成 ID，只能用于没有默认值的 `int @id` 或 `bigint @id`                                                    |
| `@unique`        | 单字段唯一约束                                                                                                 |
| `@updatedAt`     | 创建和每次更新时自动设为当前时间；只能用于没有显式默认值且未标 `@id` 或 `@unique` 的 `datetime` 或 `timestamp` |
| `@map("名称")`   | 数据库中的列名，见[名称映射](./attributes.md#名称映射)                                                         |
| `@via(字段)`     | 声明反向关系对应的字段                                                                                         |
| `@relation(...)` | 绑定外键字段、配置参照动作，见[参照动作](./relations/referential-actions.md)                                   |

`@updatedAt` 字段在创建时可以不传。ORM 更新（包括 `updateMany`、`upsert` 和嵌套更新）写入字段时自动更新该字段，显式赋值优先；软删除和恢复不改变它。

## 表前缀

用顶层 `prefix` 给所有物理表名加统一前缀，模型名和客户端 API 不变：

```ts
prefix "app_"

model User {
  id: int @id @auto
}
```

- 上例的表名为 `app_User`；`@@map("users")` 的表名为 `app_users`，中间表、索引、外键和迁移历史表（`<前缀>_tsorm_migrations`）名称同样带前缀。
- 前缀只能包含字母、数字和下划线，整个文件最多声明一次；`ignore` 按加前缀后的物理表名匹配。已有数据库新增或修改前缀时，迁移表现为删除旧表、创建新表，需要手动编写改名迁移。

## 忽略表

用顶层 `ignore` 声明不归本 schema 管理的表，迁移命令会完全跳过它们：

```ts
ignore ["legacy_*", "misc"]

model User {
  id: int @id @auto
}
```

- 列表中是物理表名，`*` 匹配任意长度的字符，其余字符按字面匹配，不区分大小写，可以写多条 `ignore` 结果合并；模型表、`@@map` 名称和中间表不能命中忽略模式，否则校验报错。
- 被忽略的表不参与漂移检测、`diff` 和 `push`，`--reset` 也只删除本 schema 的表，见[忽略的表](../databases/migrations.md#忽略的表)。

## 保留名称

模型和字段不能使用保留名称 `AND`、`OR`、`NOT`、`_count`、`constructor`、`prototype`、`__proto__`，也不能以 `$` 开头（字段还不能以 `__orm_` 开头）。校验模型文件使用 [`tsorm validate`](../reference/cli/overview.md#命令)，语法错误会带上行号和列号。

## 下一步

- [关系](./relations/overview.md)：一对多、一对一、多对多和多态关联
- [模型属性](./attributes.md)：复合键、索引、名称映射和软删除
