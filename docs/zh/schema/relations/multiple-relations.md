---
description: 在 schema.orm 中为同一对模型声明多个关系，每个持有方字段各自生成外键列。
---

# 多个关系

两个模型之间可以存在多个关系：文章有作者和审稿人，用户有账单地址和收货地址。每个关系单独声明，每个持有方字段各自生成外键列。

## 定义

每个关系使用独立的持有方字段；反向字段通过 `@via` 区分对应关系：`authored` 指向 `author`，`reviewed` 指向 `reviewer`。

## 示例

```ts
model User {
  id: int @id @auto
  email: string @unique
  authored: Post[] @via(author)
  reviewed: Post[] @via(reviewer)
}

model Post {
  id: int @id @auto
  title: string
  author: User
  reviewer?: User
}
```

```ts
await db.post.findMany({
  where: { authorId: 1, reviewerId: 2 },
  include: { author: true, reviewer: true },
});
```

## 注意事项

- 反向字段必须使用不同的名字，每个 `@via` 都要指向确实存在的持有方字段。
- 同样的规则适用于两个模型互相指向的情况，以及自关联；见[自关联](./self-relations.md)。

## 下一步

- [一对多](./one-to-many.md)：最基本的关系形状
- [外键字段](./foreign-keys.md)：显式指定外键列名
