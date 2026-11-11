---
description: 用 morph 让一个关系指向多个模型，涵盖 schema 语法、嵌套写入、关系过滤以及多态形态的能力边界。
---

# 多态关联

多态关联通过判别列与拥有方主键列引用多种模型。例如，附件可以属于帖子或用户。数据库保存这两列，但不创建外键约束。

## 声明 morph

```ts
model Post {
  id: int @id @auto
  title: string(200)
  attachments: Attachment[] @via(owner)
}

model User {
  id: int @id @auto
  attachments: Attachment[] @via(owner)
}

model Attachment {
  id: int @id @auto
  name: string
  ownerType: "Post" | "User"
  ownerId: int
  owner: morph(ownerType, ownerId)
}
```

- `owner: morph(ownerType, ownerId)` 绑定两个已有标量字段：判别列（非空 `string`，通常写成字面量联合）和主键列（非空，类型与拥有方主键一致）。
- 每个拥有方用 `@via(owner)` 声明必需的数组反向字段，写法与普通反向关系一致。反向关系以拥有方的模型名作为判别值，因此 `Post.attachments` 只会返回 `ownerType` 为 `"Post"` 的行。
- 简写 `owner: morph` 自动生成两列：判别列为 `string(191)`，主键列与拥有方主键同型。生成名是 morph 字段名加 `Type` 和 `Id`。
- 所有拥有方必须共用一种单字段主键类型。
- 字面量联合判别列必须与拥有方集合精确闭合：每个拥有方都出现在联合里，联合的每个成员都有反向字段。可用的拥有方在 schema 里一目了然。

`morph` 使用必填单值字段；属性和默认值配置在标量列上。判别列使用普通字段，拥有方使用单字段主键，每个多态关联独立占用两列。

## 写入

反向一侧支持嵌套 `create`、`createMany`、`update`、`upsert`、`updateMany`、`delete` 和 `deleteMany`，与普通多对一关系的数组侧一致；判别列与主键列由 ORM 自动填入：

```ts
await db.post.create({
  data: {
    title: "Hello",
    attachments: { create: { name: "a.png" } },
  },
});

await db.post.update({
  where: { id: 1 },
  data: {
    attachments: {
      createMany: { data: [{ name: "b.png" }] },
      updateMany: { where: { name: "a.png" }, data: { name: "renamed.png" } },
      deleteMany: { name: "c.png" },
    },
  },
});
```

直接创建时两列由调用方给出：

```ts
await db.attachment.create({
  data: { name: "a.png", ownerType: "Post", ownerId: 1 },
});
```

转移所有权的操作——`connect`、`connectOrCreate`、`disconnect` 和 `set`——会报 `POLYMORPHIC_OPERATION`。转移所有权时，需显式更新判别列与拥有方主键列。

## 读取

`include`、`_count`、关系过滤（`some`、`none`、`every`）和按 `_count` 排序都与普通数组关系一致，判别常量始终出现在生成的 SQL 里：

```ts
await db.post.findMany({
  where: { attachments: { some: { name: { endsWith: ".png" } } } },
  include: { attachments: true, _count: { select: { attachments: true } } },
  orderBy: { attachments: { _count: "desc" } },
});
```

每条记录仅关联一个持有方。即使不同目标模型的主键值相同，例如帖子和用户均为 `id: 7`，判别列仍可区分其归属。

正向一侧不可查询：`include: { owner: true }` 报 `POLYMORPHIC_INCLUDE`，按 `owner` 过滤或排序报 `VALIDATION`。在应用代码里按判别值分发：

```ts
const attachment = await db.attachment.findUniqueOrThrow({ where: { id: 1 } });
const owner = attachment.ownerType === "Post" ? await db.post.findUnique({ where: { id: attachment.ownerId } }) : await db.user.findUnique({ where: { id: attachment.ownerId } });
```

## 数据库形态

- 两列是普通列，没有外键约束。参照动作不生效：删除拥有方会留下孤儿行，`ownerId` 也可能指向不存在的记录。
- 可以通过复合唯一约束限制 `(ownerType, ownerId)` 的重复，拥有方记录的存在性由应用校验。
- morph 的 ID 列与其他关系列一样会自动建索引；按拥有方查询时用 `@@index(ownerType, ownerId)` 把判别列一起索引。
- 迁移把两列当普通列处理。使用字面量联合判别列时，新增拥有方会扩大联合并改变 CHECK 约束；普通字符串判别列（包括简写生成的列）不需要这项约束变更。

::: warning 完整性由应用负责
数据库无法校验 `ownerId` 是否存在于 `ownerType` 指名的表，也无法级联删除。如果这些行必须随拥有方一起消失，请在与拥有方相同的事务里删除它们，或者改用普通关系。
:::

## 速查

| 一侧                 | 能力                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| 反向（拥有方模型）   | `include`、`_count`、关系过滤、按 `_count` 排序、除所有权转移外的嵌套写入 |
| 正向（`owner` 字段） | 通过两列写入，按判别值分发关联读取                                        |

## 相关文档

- [关系概览](./overview.md)
- [关系写入](../../client/relation-writes.md)
- [事务](../../client/transactions.md)
