---
description: schema.orm 中关系的声明方式、持有方与反向字段的分工，以及可选的关系类型。
---

# 关系

关系字段引用其他模型，或通过 `morph` 引用多种拥有方模型。**关系持有方**保存外键，或声明多对多关联表；**反向字段**通过 `@via` 指定持有方字段，仅提供关联访问，不生成数据库列。

## 关系类型

| 关系   | 持有方                             | 反向字段                                | 数据库结构                    |
| ------ | ---------------------------------- | --------------------------------------- | ----------------------------- |
| 一对多 | `author: User`                     | `posts: Post[] @via(author)`            | `Post.authorId`               |
| 一对一 | `user: User @unique`               | `profile?: Profile @via(user)`          | 唯一的 `Profile.userId`       |
| 多对多 | `tags: Tag[]`                      | `posts: Post[] @via(tags)`              | 中间表 `_Post_tags`           |
| 多态   | `owner: morph(ownerType, ownerId)` | `attachments: Attachment[] @via(owner)` | `ownerType` 与 `ownerId` 两列 |

关系类型说明：

- [一对多](./one-to-many.md)：一个父记录拥有多个子记录。
- [一对一](./one-to-one.md)：两侧各自最多关联对方的一条记录。
- [多对多](./many-to-many.md)：两侧各自拥有对方的一个集合。
- [多态关联](./polymorphic.md)：通过判别列与目标主键引用多种拥有方模型。
- [自关联](./self-relations.md)：模型与自身建立关系。
- [多个关系](./multiple-relations.md)：两个模型之间存在不止一个关系。

[外键字段](./foreign-keys.md)说明显式外键绑定；[参照动作](./referential-actions.md)说明引用记录更新和删除时的约束行为。

## 持有方与反向字段

持有方是保存链接的字段。链接必须存在时，它是必需关系字段：

```ts
model Post {
  id: int @id @auto
  author: User
}
```

反向字段通过 `@via` 引用目标模型的持有方字段：

```ts
model User {
  id: int @id @auto
  posts: Post[] @via(author)
}
```

- 单个反向字段总是可选（`profile?: Profile @via(user)`），因为持有方可能还不存在。
- 数组反向字段总是必需（`posts: Post[] @via(author)`），因为集合总是存在，可能为空。
- 持有方也可以可选（`reviewer?: User`），此时外键列可空。

## 单向关系

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

单向和双向声明生成相同的数据库结构；新增反向字段不产生迁移。

## 写法速查

| 字段                     | 可用的写法                                                          |
| ------------------------ | ------------------------------------------------------------------- |
| 单个关系字段（持有方）   | `?`、`@unique`、`@relation(field, onDelete, onUpdate)`              |
| 数组字段（多对多持有方） | 不加属性                                                            |
| 反向字段                 | 只写 `@via(持有方字段)`；单个反向字段写成可选，数组反向字段写成必需 |

持有方外键引用的目标必须使用单字段主键；多对多要求两侧都使用单字段主键。反向集合可以指向使用复合主键的子模型。需要组合键的模型见[用代理主键替代复合主键](../attributes.md#用代理主键替代复合主键)。

## 读与写

`schema.orm` 声明决定数据库结构、客户端类型与关系元数据；反向字段不生成物理列。关联读取通过 `include` 或嵌套 `select` 声明；关联写入通过嵌套操作声明：

- 读取见[关系过滤](../../client/queries.md#关系过滤)与 `include`
- 写入见[关系写入](../../client/relation-writes.md)，包括嵌套创建、连接与断开

## 下一步

- [模型属性](../attributes.md)：复合键、索引、名称映射和软删除
