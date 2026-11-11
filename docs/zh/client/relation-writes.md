---
description: 在 create 和 update 中嵌套写入关联记录，以及各操作的规则和执行顺序。
---

# 关系写入

嵌套写入与父记录写入、结果投影使用同一个事务，任一步失败都会全部回滚。递归深度最多 8 层。

## 在 create 中写入

`create` 输入支持 `create`、`connect` 和 `connectOrCreate`；多条直接外键关系还支持 `createMany`。

```ts
await db.user.create({
  data: {
    email: "alice@example.com",
    posts: { create: [{ title: "First" }, { title: "Second" }] },
    profile: { create: { bio: "Hello" } },
  },
});

await db.post.create({
  data: {
    title: "Hello",
    author: { connect: { email: "alice@example.com" } },
  },
});

await db.post.create({
  data: {
    title: "Hello",
    author: { connectOrCreate: { where: { email: "a@x.com" }, create: { email: "a@x.com" } } },
    tags: { connectOrCreate: [{ where: { name: "ts" }, create: { name: "ts" } }] },
  },
});

await db.user.create({
  data: { email: "b@x.com", posts: { createMany: { data: [{ title: "One" }, { title: "Two" }] } } },
});
```

必需关系可以通过外键字段（如 `authorId`）或关系字段（如 `author`）赋值，二者只能选其一。`connectOrCreate` 在找不到 `where` 指定的记录时创建，并发时仍可能遇到唯一冲突。

## 在 update 中写入

```ts
await db.user.update({
  where: { id: 1 },
  data: {
    name: "Alice",
    profile: { update: { bio: "New bio" } },
    posts: {
      update: { where: { id: 10 }, data: { title: "Updated" } },
    },
  },
  include: { profile: true, posts: true },
});

await db.post.update({
  where: { id: 10 },
  data: { tags: { set: [{ name: "TypeScript" }] } },
});
```

### 支持的操作

| 操作              | 单条关系             | 多条关系                                      |
| ----------------- | -------------------- | --------------------------------------------- |
| `create`          | 目标模型的创建数据   | 创建数据或数组                                |
| `connect`         | 唯一条件             | 唯一条件或数组                                |
| `connectOrCreate` | `{ where, create }`  | `{ where, create }` 或数组                    |
| `update`          | 目标模型的更新数据   | `{ where, data }` 或数组                      |
| `upsert`          | `{ create, update }` | `{ where, create, update }` 或数组            |
| `delete`          | `true`               | 唯一条件或数组                                |
| `disconnect`      | `true`，仅限可选关系 | 唯一条件或数组，仅限可解除的关系              |
| `set`             | —                    | 唯一条件数组                                  |
| `updateMany`      | —                    | `{ where?, data }` 或数组                     |
| `deleteMany`      | —                    | 过滤条件或数组                                |
| `createMany`      | —                    | `{ data, skipDuplicates? }`，仅限直接外键关系 |

单条关系一次只能指定一个操作。多条关系可以组合多个操作，同一请求也可以更新多个关系字段。

```ts
await db.user.update({
  where: { id: 1 },
  data: {
    profile: { upsert: { create: { bio: "New" }, update: { bio: "Existing" } } },
    posts: {
      createMany: { data: [{ title: "Batch" }] },
      updateMany: { where: { published: true }, data: { views: { increment: 1 } } },
      deleteMany: { title: { startsWith: "obsolete" } },
    },
  },
});

await db.post.update({
  where: { id: 1 },
  data: { tags: { connectOrCreate: { where: { name: "TS" }, create: { name: "TS" } } } },
});
```

### 执行顺序

同一多条关系上的操作按以下顺序执行，每个操作都会重新读取当前关联：

`set` → `disconnect` → `delete` → `deleteMany` → `connect` → `connectOrCreate` → `create` → `createMany` → `update` → `updateMany` → `upsert`

嵌套 `upsert` 数组也按顺序执行，使用前序项完成后的关联状态。内部关联检查与主键查询不受全局 `omit` 影响。

## 规则

### 作用范围

- `update`、`delete` 和 `disconnect` 的目标必须已属于当前关系，否则报 `RELATION_NOT_CONNECTED`。
- 嵌套 `updateMany` 和 `deleteMany` 受父关系范围约束。与顶层批量写不同，嵌套 `updateMany` 可省略 `where`，嵌套 `deleteMany` 可用 `{}` 选择该关系下可见的记录。
- 嵌套 `create` 的父记录外键由 ORM 填入。
- 反向 `connect` 接受空闲对象或已属于当前父记录的对象。
- 多态关系支持除 `connect`、`connectOrCreate`、`disconnect`、`set` 之外的全部嵌套操作，转移类操作报 `POLYMORPHIC_OPERATION`；见[多态关联](../schema/relations/polymorphic.md)。

### 解除与删除

- `disconnect` 只解除关系；`delete` 删除目标记录。在多对多关系中，`delete` 也会删除目标记录的其他连接。
- 必需外键和必需单条关系须保持有效引用。
- `set` 会先解除被移除的连接，因此解除连接要求外键可空。

### 批量操作

- 嵌套 `updateMany` 只接受标量更新。
- `createMany` 用于直接外键关系，数据中只包含标量字段。

::: warning 并发唯一冲突
`connectOrCreate` 和嵌套 `upsert` 可能回退到事务内先读后写，因此仍可能遇到并发唯一冲突。
:::

## 下一步

- [查询](./queries.md)：关系过滤与预加载
- [多态关系](../schema/relations/polymorphic.md)：多态关系会拒绝的操作
- [软删除](../schema/soft-delete.md)：嵌套写入如何处理已删除的记录
