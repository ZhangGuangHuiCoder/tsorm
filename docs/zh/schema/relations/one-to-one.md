---
description: 在 schema.orm 中声明一对一关系：把唯一外键放在依附的一侧，反向字段写成可选。
---

# 一对一

一对一关系限制两侧记录的关联基数均不超过一，例如用户与用户资料。数据库通过外键列上的唯一约束保证该关系。

## 定义

持有方使用 `user: User @unique`，使生成的 `userId` 唯一；反向字段写成可选的 `profile?: Profile @via(user)`。[显式绑定外键](./foreign-keys.md)时，也可在绑定标量列上声明唯一约束；关系上的 `@unique` 同样会使该列唯一。

其余规则与[一对多](./one-to-many.md#定义)一致：列名是关系名加上首字母大写的目标主键名，类型和长度与目标主键相同。

## 示例

```ts
model User {
  id: int @id @auto
  email: string @unique
  profile?: Profile @via(user)
}

model Profile {
  id: int @id @auto
  bio: string = ""
  user: User @unique
}
```

`Profile.userId` 引用用户主键。通过 `include` 加载用户资料：

```ts
const user = await db.user.findUniqueOrThrow({
  where: { id: 1 },
  include: { profile: true },
});
```

## 注意事项

- 持有方也可以可选：`user?: User @unique` 表示资料可以暂时不属于任何用户。唯一约束依然生效，每个用户最多关联一条资料。
- 反向关系的基数由外键列的唯一性决定；外键不唯一时，多个 `Profile` 可以引用同一用户。
- 反向字段必须可选，因为持有方可能还不存在：`profile: Profile @via(user)` 会被拒绝。
- 持有方外键不能引用复合主键，应改用代理主键，见[用代理主键替代复合主键](../attributes.md#用代理主键替代复合主键)。
- 唯一约束建在数据库上，原生 SQL 同样受约束。

## 下一步

- [多对多](./many-to-many.md)：两侧各自拥有对方的一个集合时
- [外键字段](./foreign-keys.md)：显式声明带唯一约束的外键列
