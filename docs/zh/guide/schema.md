---
description: schema.orm 的字段类型、默认值、关系、约束、索引和名称映射语法。
---

# 模型定义

`schema.orm` 使用 TypeScript 风格的语法描述模型，生成器据此输出客户端类型和建表语句。

## 模型与字段

每个模型必须有一个主键：单字段主键用 `@id`，复合主键用 `@@id`。

```ts
model User {
  id: int @id @auto
  email: string(191) @unique
  name?: string
  enabled: boolean = true
  createdAt: date = now()
}
```

字段的完整写法是 `名称[?]: 类型 [= 默认值] [属性...]`，属性写在默认值之后：

```ts
model Token {
  id: string(36) = uuid() @id
  value: string
}
```

### 字段类型

| 类型                | 说明                                                 |
| ------------------- | ---------------------------------------------------- |
| `int`               | JavaScript 安全整数范围内的整数，读取为 `number`     |
| `bigint`            | 64 位整数，读取为 JavaScript `bigint`，写入接受 `bigint` 或安全整数 |
| `number`            | 有限浮点数                                           |
| `decimal(p, s)`     | 定点小数，读写为字符串以免丢失精度，写入也接受数字；`p` 取 1 到 65，`s` 取 0 到 30 |
| `string`            | 不限长度的字符串                                     |
| `string(n)`         | 限长字符串，`n` 取 1 到 16383，按 Unicode 码点计数   |
| `boolean`           | 布尔值                                               |
| `date`              | 本地日期时间，以毫秒精度字符串返回，见[日期与时区](../client/datetime.md) |
| `"a" \| "b"`        | 字符串字面量联合，由数据库 `CHECK` 约束取值          |
| `json<T>`           | 类型化 JSON，见[类型化 JSON](../client/json.md)      |
| `bytes`             | 二进制数据，读写为 `Uint8Array`；不能作为键或索引      |

字段名后加 `?` 表示可空，默认值为 `NULL`。各类型对应的物理类型见[类型映射](../databases/overview.md#类型映射)。

`decimal` 写入的值超出声明的位数或小数位时报 `VALIDATION`，不会被静默舍入。省略 `(p, s)` 时不限制位数。SQLite 没有定点数，`decimal` 按浮点数存储，约 15 位有效数字以内准确。

`int` 和 `bigint` 在 MySQL 和 PostgreSQL 中都是 `BIGINT`，区别只在 JavaScript 中的类型，二者互换不需要迁移。

### 默认值

| 写法                | 说明                                  |
| ------------------- | ------------------------------------- |
| `= 字面量`          | 固定默认值，类型必须与字段一致        |
| `= now()`           | 按客户端时区生成当前时间，仅用于 `date` |
| `= uuid()`          | 生成 UUID，仅用于字符串，长度不小于 36 |

`date` 字段只接受 `now()`，JSON 字段的默认值只能是 `null`。

### 字段属性

| 属性                      | 说明                                                 |
| ------------------------- | ---------------------------------------------------- |
| `@id`                     | 单字段主键                                           |
| `@auto`                   | 自动生成 ID，只能用于没有默认值的 `int @id` 或 `bigint @id` |
| `@unique`                 | 单字段唯一约束                                       |
| `@updatedAt`              | 创建和每次更新时自动设为当前时间，只能用于没有默认值的 `date` |
| `@map("名称")`            | 数据库中的列名，见[名称映射](#名称映射)              |
| `@via(字段)`              | 声明反向关系对应的字段                               |
| `@relation(...)`          | 绑定外键字段、配置外键动作，见[外键动作](#外键动作)  |

`@updatedAt` 字段在创建时可以不传。任何 ORM 更新（包括 `updateMany`、`upsert` 和嵌套更新）只要写入了字段，就会把它设为当前时间；显式赋值以传入的值为准。软删除和恢复不改变它。

## 关系

字段的类型是另一个模型时，它就是关系字段。每个关系有一个**持有方**：一对多和一对一由它保存外键列，多对多由它声明中间表。另一侧可以用 `@via` 声明**反向字段**，从对方导航回来。反向字段不产生任何列。

| 关系   | 持有方                 | 反向字段                        | 数据库结构             |
| ------ | ---------------------- | ------------------------------- | ---------------------- |
| 一对多 | `author: User`         | `posts: Post[] @via(author)`    | `Post.authorId`        |
| 一对一 | `user: User @unique`   | `profile?: Profile @via(user)`  | 唯一的 `Profile.userId` |
| 多对多 | `tags: Tag[]`          | `posts: Post[] @via(tags)`      | 中间表 `_Post_tags`    |

关系的查询和写入见[查询](../client/queries.md#关系过滤)和[关系写入](../client/relation-writes.md)。

### 一对多

```ts
model User {
  id: int @id @auto
  email: string(191) @unique
  posts: Post[] @via(author)
}

model Post {
  id: int @id @auto
  title: string
  author: User
  reviewer?: User
}
```

- `author` 是必需关系，生成 `authorId`；`reviewer` 是可选关系，生成可空的 `reviewerId`，默认值为 `NULL`。
- `posts` 是反向字段，`@via(author)` 指向 `Post` 上的持有方字段。
- 外键列名是关系名加上首字母大写的目标主键名，类型和长度与目标主键相同。目标主键是 `code: string(2) @id` 时，`country: Country` 生成 `countryCode: string(2)`。
- 外键随关系一起出现在客户端中，可以直接用于过滤和写入，例如 `where: { authorId: 1 }`。

`@@unique`、`@@index` 和 `@@id` 中可以直接写关系名，表示它的外键列：

```ts
model Post {
  id: int @id @auto
  author: User
  slug: string(64)

  @@unique(author, slug)
}
```

### 一对一

在持有方加 `@unique`，外键列随之带上唯一约束。反向字段写成可选的单个字段：

```ts
model User {
  id: int @id @auto
  profile?: Profile @via(user)
}

model Profile {
  id: int @id @auto
  bio: string = ""
  user: User @unique
}
```

外键放在依附的一侧：先有用户，再有资料，所以 `Profile` 持有 `userId`。持有方也可以是可选的，例如 `user?: User @unique` 表示资料可以暂时不属于任何用户。

### 多对多

持有方是不带 `@via` 的数组字段，ORM 为它创建隐式中间表：

```ts
model Post {
  id: int @id @auto
  title: string
  tags: Tag[]
}

model Tag {
  id: int @id @auto
  name: string(191) @unique
  posts: Post[] @via(tags)
}
```

- 中间表名为 `_模型_字段`，这里是 `_Post_tags`。它有 `sourceId`（指向 `Post`）和 `targetId`（指向 `Tag`）两列，两列共同组成主键。
- 删除任一侧的记录时，中间表中对应的连接一并删除。
- 关联本身需要携带数据（角色、加入时间）时，改用一个普通模型连接两侧，见[带附加字段的关联](#带附加字段的关联)。

### 显式声明外键字段

需要自己控制外键列时，先声明字段，再用 `@relation(field: ...)` 绑定：

```ts
model Post {
  id: int @id @auto
  authorId: int @map("author_id")
  author: User @relation(field: authorId)
}
```

- 外键字段的类型和长度与目标主键相同，可空性与关系一致：可选关系对应可空字段。
- 外键字段是普通标量字段，可以加 `@map`、`@unique`，不能是 `@id`、`@auto` 或枚举。
- 模型中已有与自动生成名称同名的字段时（例如上面的 `authorId`），需要用 `field` 绑定它。
- 一个外键字段只对应一个关系。

### 外键动作

`@relation` 的 `onDelete` 和 `onUpdate` 决定删除被引用的记录或修改其主键时，引用它的记录如何处理：

```ts
model Post {
  id: int @id @auto
  author: User @relation(onDelete: Cascade)
  editor?: User @relation(onDelete: SetNull)
}
```

| 动作       | 行为                                               |
| ---------- | -------------------------------------------------- |
| `Restrict` | 存在引用时拒绝操作，默认值                         |
| `NoAction` | 存在引用时拒绝操作，在语句结束时检查               |
| `Cascade`  | 一并删除引用它的记录，或同步更新它们的外键         |
| `SetNull`  | 把外键设为 `NULL`，用于可选关系                    |

- 外键动作由数据库执行，在原生 SQL 中同样生效。
- 主键通常不会修改，`onUpdate` 一般保持默认即可。
- [软删除](#软删除)只设置删除时间，不触发外键动作。
- 多对多中间表的连接始终随两侧记录一起删除。

### 单向关系

反向字段按需声明。只需要从文章找到作者时，`User` 中可以不写 `posts`：

```ts
model User {
  id: int @id @auto
}

model Post {
  id: int @id @auto
  author: User
}
```

数据库结构与双向声明完全相同；以后补上反向字段也不会产生迁移。

### 自关联

关系的目标可以是模型自身。树形结构用可选的父节点加反向的子节点集合：

```ts
model Category {
  id: int @id @auto
  name: string(64)
  parent?: Category @relation(onDelete: SetNull)
  children: Category[] @via(parent)
}
```

自关联的多对多同样适用，例如关注关系：

```ts
model User {
  id: int @id @auto
  following: User[]
  followers: User[] @via(following)
}
```

### 同一对模型之间的多个关系

两个模型之间可以有多个关系。每个持有方字段生成自己的外键，反向字段通过 `@via` 指明对应哪一个：

```ts
model User {
  id: int @id @auto
  authored: Post[] @via(author)
  reviewed: Post[] @via(reviewer)
}

model Post {
  id: int @id @auto
  author: User
  reviewer?: User
}
```

### 写法速查

| 字段                     | 可用的写法                                         |
| ------------------------ | -------------------------------------------------- |
| 单个关系字段（持有方）   | `?`、`@unique`、`@relation(field, onDelete, onUpdate)` |
| 数组字段（多对多持有方） | 不加属性                                           |
| 反向字段                 | 只写 `@via(持有方字段)`；单个反向字段写成可选，数组反向字段写成必需 |

关系的目标模型使用单字段主键。需要组合键的模型见[用代理主键替代复合主键](#用代理主键替代复合主键)。

## 模型属性

### 复合唯一约束与索引

```ts
model Membership {
  id: int @id @auto
  organization: string(64)
  email: string(191)

  @@unique(organization, email)
  @@index(email)
}
```

使用复合唯一键查询时，需要传入全部字段，例如 `where: { organization, email }`。

`@@id`、`@@unique`、`@@index` 的字段列表用逗号分隔，不接受方括号：`@@index([email])` 报 `Field lists take bare names, not brackets`。`@via` 和 `@@softDelete` 同样只接受字段名。

::: warning MySQL 索引
MySQL 中无长度的 `string` 不能建立索引或唯一约束，需要改用 `string(n)`。否则初始化时报 `UNSUPPORTED_CAPABILITY`。
:::

### 复合主键

```ts
model Membership {
  account: Account
  group: Group
  role: "owner" | "member" = "member"

  @@id(account, group)
}
```

- `@@id` 至少包含两个非空字段，可以写关系名，表示对应的外键字段。
- 按主键查询时传入全部字段，例如 `where: { accountId, groupId }`。
- 复合主键的模型可以引用其他模型，其他模型也可以用 `@via` 声明指向它的反向集合；但它不能被其他模型的外键直接引用，也不能参与多对多关系。

### 用代理主键替代复合主键

外键只能引用单字段主键，`@relation(field: ...)` 也只接受一个列名。一个模型只要将来可能被其他模型引用，就不要用 `@@id`，改用代理主键：

- 主键用一个没有业务含义的字段：`id: int @id @auto`，或 `bigint`、`string(36) = uuid()`；
- 原来的组合键写成 `@@unique(...)`，唯一性仍由数据库保证；
- 其他模型通过单列 `id` 引用它。

#### 明细行

明细行的业务身份是「订单 + 行号」。把这个组合写成唯一约束，退款只需一个外键列 `lineId`：

```ts
model Order {
  id: int @id @auto
  lines: OrderLine[] @via(order)
}

model OrderLine {
  id: int @id @auto
  order: Order @relation(onDelete: Cascade)
  lineNo: int
  quantity: int
  refunds: Refund[] @via(line)

  @@unique(order, lineNo)
}

model Refund {
  id: int @id @auto
  line: OrderLine
  amount: decimal(10, 2)
}
```

按业务键查找时传入组合键的全部字段，例如 `where: { orderId, lineNo }`。行号以后重新编排，也不会影响引用它的外键。

#### 带附加字段的关联

隐式多对多的中间表只有两侧的外键。关联本身需要带数据（角色、加入时间）时，把它写成普通模型，两侧用 `@via` 声明一对多：

```ts
model User {
  id: int @id @auto
  memberships: Membership[] @via(user)
}

model Group {
  id: int @id @auto
  memberships: Membership[] @via(group)
}

model Membership {
  id: int @id @auto
  user: User
  group: Group
  role: "owner" | "member" = "member"
  joinedAt: date = now()

  @@unique(user, group)
}
```

与[复合主键](#复合主键)的写法相比，这里的 `Membership` 还可以被其他模型引用，例如审计日志里的 `membership: Membership`。从用户查到组时，经过 `memberships` 再取 `group`。

#### 多租户

子模型同时保存租户和父记录，按租户过滤时不需要连表：

```ts
model Tenant {
  id: int @id @auto
  slug: string(64) @unique
}

model Project {
  id: int @id @auto
  tenant: Tenant
  key: string(16)
  tasks: Task[] @via(project)

  @@unique(tenant, key)
}

model Task {
  id: int @id @auto
  tenant: Tenant
  project: Project
  title: string(200)

  @@index(tenant, project)
}
```

::: warning 跨表一致性需要在应用层保证
复合外键 `(tenantId, projectId)` 可以让数据库保证任务和项目属于同一租户；改用单列外键后，数据库只检查 `projectId` 存在，不检查 `task.tenantId` 与 `project.tenantId` 是否相同。创建任务时应从项目读出租户写入，不要让调用方分别传入两者。
:::

代理主键的代价是每张表多一列 `id` 和一个索引，以及上面这类跨表约束需要应用层保证。

### 名称映射

`@map` 和 `@@map` 指定数据库中的列名和表名，客户端中仍然使用模型里的名称：

```ts
model Account {
  id: int @id @auto
  email: string(191) @unique @map("email_address")
  createdAt: date = now() @map("created_at")

  @@map("accounts")
}
```

迁移以数据库名称为准：只改模型中的字段名而保持 `@map` 不变，不会产生迁移；修改 `@map` 的值则相当于删除旧列、新增新列。原生 SQL 中要使用数据库名称。

### 软删除

```ts
model Account {
  id: int @id @auto
  deletedAt?: date

  @@softDelete(deletedAt)
}
```

省略参数时使用 `deletedAt`，模型未声明该字段则自动补上：

```ts
model Account {
  id: int @id @auto

  @@softDelete()
}
```

管理字段必须是可空的 `date`，且不能是主键或唯一字段；显式指定模型中不存在的字段会报错。行为见[软删除](../client/soft-delete.md)。

## 类型声明

`type` 声明用于描述 JSON 结构：

```ts
type Preferences = {
  theme: "light" | "dark"
  notifications: boolean
  languages: string[]
}

model Account {
  id: int @id @auto
  role: "admin" | "member" = "member"
  preferences?: json<Preferences>
}
```

## 保留名称

模型和字段不能使用保留名称，包括 `AND`、`OR`、`NOT`、`_count`、`constructor`、`prototype` 和 `__proto__`，也不能以 `$` 开头。字段名还不能以 `__orm_` 开头。

校验模型文件可使用 [`tsorm validate`](../reference/cli.md#命令)，语法错误会带上行号和列号。
