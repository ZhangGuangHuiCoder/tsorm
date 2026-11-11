---
description: 在 schema.orm 中声明一对多关系：持有方字段、反向集合，以及自动生成的外键列。
---

# 一对多

一对多是基础的关系形状：一个父记录拥有多个子记录，每个子记录只指向一个父记录。链接保存在子记录一侧，所以子记录是持有方，父记录一侧暴露一个集合。

## 定义

持有方默认必需（`author: User`），加 `?` 变可选（`reviewer?: User`）。反向集合使用 `posts: Post[] @via(author)`，完整模型见下方示例。

外键列由生成器按关系推导：

- 列名是关系名加上首字母大写的目标主键名：`author: User` 搭配 `id: int @id` 生成 `authorId`。
- 列的类型和长度与目标主键相同。目标主键是 `code: string(2) @id` 时，`country: Country` 生成 `countryCode: string(2)`。
- 列的可空性与关系一致：可选关系生成可空列，必需关系生成非空列。
- 非唯一关系列自动建索引，用于外键过滤。

## 示例

```ts
model User {
  id: int @id @auto
  email: string @unique
  posts: Post[] @via(author)
}

model Post {
  id: int @id @auto
  title: string
  author: User
  reviewer?: User
}
```

外键随关系一起出现在客户端中，可以直接用于过滤和写入：

```ts
await db.post.findMany({ where: { authorId: 1 } });
await db.post.create({ data: { title: "Hello", authorId: 1 } });
```

`@@unique`、`@@index` 和 `@@id` 中可以直接写关系名，表示它的外键列：

```ts
model Post {
  id: int @id @auto
  author: User
  slug: string(64)

  @@unique(author, slug)
}
```

## 注意事项

- 只有一侧保存链接。同时声明 `posts: Post[] @via(author)` 和 `author: User` 也只产生一个列。
- 反向数组是必需的，`posts: Post[] @via(author)` 正确，`posts?: Post[] @via(author)` 不正确。
- 持有方外键不能引用复合主键，见[用代理主键替代复合主键](../attributes.md#用代理主键替代复合主键)。
- 读取集合见[关系过滤](../../client/queries.md#关系过滤)，写入集合见[关系写入](../../client/relation-writes.md)。

## 下一步

- [一对一](./one-to-one.md)：每个父记录最多关联一个子记录时
- [多个关系](./multiple-relations.md)：两个模型之间存在不止一个关系时
