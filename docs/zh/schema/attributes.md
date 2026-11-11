---
description: schema.orm 的复合约束与主键、索引、名称映射和软删除。
---

# 模型属性

模型属性写在模型体内，以 `@@` 开头。它们约束的是整张表，而不是单个字段。

## 复合唯一约束与索引

```ts
model Membership {
  id: int @id @auto
  organization: string(64)
  email: string

  @@unique(organization, email)
  @@index(email)
}
```

使用复合唯一键查询时，需要传入全部字段，例如 `where: { organization, email }`。

`@@id`、`@@unique`、`@@index` 的字段列表使用逗号分隔的裸字段名；方括号写法 `@@index([email])` 报 `Field lists take bare names, not brackets`。`@via` 和 `@@softDelete` 同样只接受字段名。

`string` 省略长度时按 `string(191)` 处理，字符串字段可以直接建索引、加唯一约束或作为字符串主键，无需额外标注；该长度的由来见[为什么 `string` 默认是 191](./overview.md#为什么-string-默认是-191)。`text` 不限长度，不能作为键或索引。

## 复合主键

主键字段不可通过 ORM 更新，包括复合主键的各个组成字段及其绑定关系。需要可变业务标识时，应使用代理主键并将业务字段声明为唯一键。

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
- 复合主键的模型可以引用其他模型，其他模型也可以用 `@via` 声明指向它的反向集合；作为外键目标或参与多对多关系时，使用单字段代理主键。

## 用代理主键替代复合主键

外键只能引用单字段主键，`@relation(field: ...)` 也只接受一个列名。需要被其他模型通过外键引用时，应采用代理主键：

- 主键用一个没有业务含义的字段：`id: int @id @auto`，或 `bigint`、`string(36) = uuid()`；
- 原来的组合键写成 `@@unique(...)`，唯一性仍由数据库保证；
- 其他模型通过单列 `id` 引用它。

### 明细行

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

按业务键查找时传入组合键的全部字段，例如 `where: { orderId, lineNo }`。外键使用稳定的代理主键，行号可独立调整。

### 带附加字段的关联

隐式多对多的中间表只有两侧的外键。关联包含角色、加入时间等业务属性时，应声明显式关联模型，并通过 `@via` 定义两侧的一对多关系：

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
  joinedAt: datetime = now()

  @@unique(user, group)
}
```

与[复合主键](#复合主键)的写法相比，这里的 `Membership` 还可以被其他模型引用，例如审计日志里的 `membership: Membership`。用户与组的关联通过 `memberships.group` 访问。

### 多租户

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

## 名称映射

`@map` 和 `@@map` 指定数据库中的列名和表名，客户端中仍然使用模型里的名称：

```ts
model Account {
  id: int @id @auto
  email: string @unique @map("email_address")
  createdAt: datetime = now() @map("created_at")

  @@map("accounts")
}
```

迁移以数据库名称为准：只改模型中的字段名而保持 `@map` 不变时，数据库结构保持一致；修改 `@map` 的值则相当于删除旧列、新增新列。原生 SQL 中要使用数据库名称。

## 软删除

`@@softDelete(字段)` 指定一个可空的 `datetime` 或 `timestamp` 管理字段。`@@softDelete()` 默认使用 `deletedAt`，不存在时补上 `deletedAt?: datetime`。声明约束、可见性和关系行为集中见[软删除](./soft-delete.md)。

## 类型声明

顶层 `type` 声明描述 `json<T>` 的值，不属于模型属性。它同时用于生成类型和运行时 JSON 校验，不改变物理列。声明方式与已有数据的迁移要求见[类型化 JSON](./json.md)。

## 下一步

- [模型与字段](./overview.md)：字段类型、默认值和字段属性
- [关系](./relations/overview.md)：一对多、一对一、多对多和多态关联
