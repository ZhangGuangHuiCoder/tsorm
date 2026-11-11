---
description: 在 schema.orm 中让模型与自身建立关系：树形结构用父节点与子节点集合，社交关系用多对多写法。
---

# 自关联

关系的目标可以是模型自身。树形结构用父节点加反向的子节点集合；社交关系则在同一个模型上写多对多。

## 定义

树形结构使用可选的父节点字段与反向子节点集合；有向多对多关系使用持有方数组与反向数组。两种写法的目标都是当前模型。

## 示例

分类树：

```ts
model Category {
  id: int @id @auto
  name: string(64)
  parent?: Category @relation(onDelete: SetNull)
  children: Category[] @via(parent)
}
```

`onDelete: SetNull` 在父分类删除时把子分类提升为根节点，但不检查环；需要无环树时由应用保证。

关注关系，两侧都在同一个模型上：

```ts
model User {
  id: int @id @auto
  email: string @unique
  following: User[]
  followers: User[] @via(following)
}
```

## 注意事项

- 需要表示没有父记录的根节点时，树的父节点字段必须可选。
- 自关联多对多的两个数组都是必需的。中间表按持有方数组命名，`User.following` 生成 `_User_following`。
- 自关联仍然要求模型使用单字段主键。
- 读取树就是普通的关系过滤，见[关系过滤](../../client/queries.md#关系过滤)。

## 下一步

- [多个关系](./multiple-relations.md)：两个不同模型之间存在多个关系
- [参照动作](./referential-actions.md)：记录被删除时会发生什么
