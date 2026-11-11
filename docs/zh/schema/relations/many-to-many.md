---
description: 在 schema.orm 中用隐式中间表声明多对多关系，以及什么时候应该改用普通模型。
---

# 多对多

多对多关系允许两侧记录分别关联多个目标，例如文章与标签、学生与课程。ORM 使用独立关联表存储两侧主键。

## 定义

持有方声明不带 `@via` 的 `tags: Tag[]`，反向侧使用 `posts: Post[] @via(tags)`。完整模型见下方示例。

中间表由声明推导：

- 表名是 `_模型_字段`，所以 `Post.tags` 生成 `_Post_tags`。
- 它有两列，`sourceId` 指向持有方模型，`targetId` 指向另一侧。在 `_Post_tags` 中分别是 `sourceId`（指向 `Post`）和 `targetId`（指向 `Tag`）。
- 两列共同组成主键，每对记录保持唯一关联。
- 删除任一侧的记录时，中间表中对应的连接一并删除。

## 示例

```ts
model Post {
  id: int @id @auto
  title: string
  tags: Tag[]
}

model Tag {
  id: int @id @auto
  name: string @unique
  posts: Post[] @via(tags)
}
```

两侧支持集合查询和嵌套关系操作，但不支持嵌套 `createMany`，见[关系写入](../../client/relation-writes.md)：

```ts
await db.post.findMany({
  where: { tags: { some: { name: "typescript" } } },
  include: { tags: true },
});

await db.post.create({
  data: { title: "Hello", tags: { connect: [{ id: 1 }] } },
});
```

## 注意事项

- 持有方数组字段使用裸模型数组类型。
- 反向数组字段是必需的，`posts: Post[] @via(tags)` 正确，`posts?: Post[] @via(tags)` 不正确。
- 关联本身需要携带数据（角色、加入时间）时，改用一个普通模型连接两侧，见[带附加字段的关联](../attributes.md#带附加字段的关联)。
- 两个模型都必须使用单字段主键，因为中间表把两侧主键都存为普通列。

## 下一步

- [带附加字段的关联](../attributes.md#带附加字段的关联)：携带自身数据的中间模型
- [参照动作](./referential-actions.md)：被关联的记录被删除时会发生什么
