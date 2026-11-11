---
description: 显式声明外键字段，通过 @relation(field) 绑定关系并配置物理列名。
---

# 外键字段

默认外键列由关系字段生成。需要指定列名、复用已有列或声明列级属性时，使用 `@relation(field: ...)` 绑定显式标量字段。

## 定义

```ts
model User {
  id: int @id @auto
}

model Post {
  id: int @id @auto
  authorId: int @map("author_id")
  author: User @relation(field: authorId)
}
```

客户端使用 `authorId`，数据库使用 `author_id`。显式字段必须满足以下约束：

- 类型、长度、decimal 精度/小数位及日期存储（`datetime` 或 `timestamp`）与目标主键一致，可空性与关系一致。
- 可以声明 `@map`、`@unique`，不得声明 `@id`、`@auto` 或枚举类型。
- 每个外键字段仅允许绑定一个关系。
- 已声明与默认外键同名的标量字段时，必须通过 `field` 显式绑定。

## 一对一关系

在绑定标量列或关系字段上声明 `@unique` 都会使外键唯一；两处同时声明也有效：

```ts
model Profile {
  id: int @id @auto
  userId: int @unique @map("user_id")
  user: User @unique @relation(field: userId)
}
```

## 注意事项

- 非唯一的关系列自动创建索引。
- 显式绑定不改变关系基数，一对一关系仍由 `@unique` 声明。
- `onDelete` 与 `onUpdate` 配置在关系字段上。
- 类型、长度、可空性不匹配或重复绑定均触发模型校验错误。

## 下一步

- [参照动作](./referential-actions.md)：引用记录更新和删除时的约束行为
- [名称映射](../attributes.md#名称映射)：数据库列名与模型字段名的映射
