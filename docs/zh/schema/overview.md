---
description: schema.orm 的字段类型、默认值、字段属性和保留名称。
---

# 模型与字段

`schema.orm` 使用 TypeScript 风格的语法描述模型，生成器据此输出客户端类型和建表语句。

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

| 类型                   | 说明                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `int`                  | JavaScript 安全整数范围内的整数，读取为 `number`                                          |
| `bigint`               | 64 位整数，读取为 `string`；写入接受整数字符串、`bigint` 或安全整数                       |
| `number`               | 有限浮点数                                                                                |
| `decimal(p, s)`        | 小数，读取为字符串，写入接受字符串或数字；`p` 取 1 到 65，`s` 取 0 到 30 且不能大于 `p`   |
| `string` / `string(n)` | 字符串，`n` 取 1 到 16383，按 Unicode 码点计数；省略长度时为 191                          |
| `text`                 | 不限长度字符串，不能作为键或索引                                                          |
| `boolean`              | 布尔值                                                                                    |
| `datetime`             | 存储本地日期时间；返回格式由 `datetimeFormat` 控制，见[日期与时区](../client/datetime.md) |
| `timestamp`            | Unix 毫秒时间戳，存为整数列；返回格式由 `datetimeFormat` 控制                             |
| `"a" \| "b"`           | 字符串字面量联合，由数据库 `CHECK` 约束取值                                               |
| `json<T>`              | 类型化 JSON，见[类型化 JSON](./json.md)                                                   |
| `bytes`                | 二进制数据，读写为 `Uint8Array`；用于普通数据列                                           |

字段名后加 `?` 表示可空；未显式声明默认值时默认为 `NULL`。各类型对应的物理类型见[类型映射](../databases/overview.md#类型映射)。

`decimal` 写入值超出显式声明的位数或小数位时报 `VALIDATION`。省略 `(p, s)` 时 ORM 不设置模型精度限制，但仍受数据库限制：MySQL 使用 `DECIMAL(65,30)`。字符串输入避免 JavaScript 浮点转换，不能消除数据库精度限制。SQLite 使用 NUMERIC 亲和性，小数可能以浮点数存储（约 15 位有效数字），不保证精确小数运算。

`int` 和 `bigint` 在 MySQL 和 PostgreSQL 中都是 `BIGINT`，区别只在 JavaScript 中的类型，二者互换不需要迁移。

### 为什么 `string` 默认是 191

兼容 MySQL 旧行格式的 767 字节索引限制：utf8mb4 每字符最多 4 字节，取整得 191。更长可用 `string(n)`。

## 默认值

| 写法       | 说明                                       |
| ---------- | ------------------------------------------ |
| `= 字面量` | 固定默认值，类型必须与字段一致             |
| `= now()`  | 当前时间，适用于 `datetime` 和 `timestamp` |
| `= uuid()` | 生成 UUID，仅用于字符串，长度不小于 36     |

日期字段（`datetime` 和 `timestamp`）接受 `now()`，可空日期字段也接受 `null`。JSON 字段的默认值只能是 `null`。

## 字段属性

| 属性             | 说明                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------ |
| `@id`            | 单字段主键                                                                           |
| `@auto`          | 自动生成 ID，只能用于没有默认值的 `int @id` 或 `bigint @id`                          |
| `@unique`        | 单字段唯一约束                                                                       |
| `@updatedAt`     | 创建和每次更新时自动设为当前时间，只能用于没有显式默认值的 `datetime` 或 `timestamp` |
| `@map("名称")`   | 数据库中的列名，见[名称映射](./attributes.md#名称映射)                               |
| `@via(字段)`     | 声明反向关系对应的字段                                                               |
| `@relation(...)` | 绑定外键字段、配置参照动作，见[参照动作](./relations/referential-actions.md)         |

`@updatedAt` 字段在创建时可以不传。ORM 更新（包括 `updateMany`、`upsert` 和嵌套更新）写入至少一个标量字段时，该字段自动更新；显式赋值优先。软删除和恢复不改变它。

## 表前缀

用顶层 `prefix` 给所有物理表名加统一前缀，模型名和客户端 API 不变：

```ts
prefix "app_"

model User {
  id: int @id @auto
}
```

- 上例的表名为 `app_User`；`@@map("users")` 的表名为 `app_users`，多对多中间表同样带前缀。
- 前缀只能包含字母、数字和下划线，整个文件最多声明一次。
- 索引和外键名称同样带前缀，迁移历史表变为 `<前缀>_tsorm_migrations`，不同前缀的模型各自记录迁移。
- `ignore` 按加前缀后的物理表名匹配。

已有数据库新增或修改前缀时，迁移会表现为删除旧表、创建新表，需要手动编写改名迁移。

## 忽略表

用顶层 `ignore` 声明不归本模型管理的表，迁移命令会完全跳过它们：

```ts
ignore ["legacy_*", "misc"]

model User {
  id: int @id @auto
}
```

- 列表中是物理表名，`*` 匹配任意长度的字符，其余字符按字面匹配，不区分大小写。
- 可以写多条 `ignore`，结果合并。
- 模型表、`@@map` 名称和多对多中间表都不能命中忽略模式，否则校验报错。

被忽略的表不参与漂移检测、`diff` 和 `push`，`migrate --reset`、`push --reset` 也只删除模型管理的表，见[忽略的表](../databases/migrations.md#忽略的表)。

## 保留名称

模型和字段应避开保留名称： `AND`、`OR`、`NOT`、`_count`、`constructor`、`prototype` 和 `__proto__`，`$` 和 `__orm_` 前缀保留给内部使用。

校验模型文件可使用 [`tsorm validate`](../reference/cli/overview.md#命令)，语法错误会带上行号和列号。

## 下一步

- [关系](./relations/overview.md)：一对多、一对一、多对多和多态关联
- [模型属性](./attributes.md)：复合键、索引、名称映射和软删除
