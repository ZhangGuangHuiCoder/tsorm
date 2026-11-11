---
description: 用 $extend 扩展客户端：在现有客户端之上叠加虚拟字段与 omit，并复用其连接。
---

# 扩展

`$extend` 合并 `virtuals` 与 `omit` 配置并返回新客户端，不修改原客户端；两者共享适配器连接。虚拟字段和全局字段排除通过此方法配置，连接与运行时选项仍由 `createClient` 配置。

## 扩展客户端

```ts
const db = await createClient({ adapter });

const extended = db.$extend({
  virtuals: {
    user: {
      displayName: {
        needs: { name: true, email: true },
        compute: (row) => row.name ?? row.email,
      },
    },
  },
  omit: { user: { name: true } },
});

const rows = await extended.user.findMany();
rows[0].displayName; // 在客户端上计算
```

| 选项       | 说明                       |
| ---------- | -------------------------- |
| `virtuals` | 在已配置的虚拟字段之上追加 |
| `omit`     | 在当前全局 omit 之上叠加   |

内联 `compute` 参数的类型为所在模型的完整行，但运行时只暴露 `needs` 声明的字段；见[虚拟字段](./virtual-fields.md)。

`omit` 适合密码哈希这类默认不应返回的字段。它作用于所有返回记录的方法和嵌套关系，返回类型同步去掉这些字段；查询中用 `select` 或 `omit: { 字段: false }` 可以取回。过滤、排序和唯一查找不受影响：

```ts
const db = (await createClient({ adapter: sqlite({ connection: "file:./app.sqlite" }) })).$extend({
  omit: { user: { name: true } },
});
await db.user.findUnique({ where: { id: 1 } }); // 不含 name
await db.user.findUnique({ where: { id: 1 }, omit: { name: false } });
```

## 语义

- **叠加而非替换。** 新的虚拟字段与 omit 追加到当前配置之上；重新定义同名虚拟字段会覆盖原定义。
- **不可变。** 原客户端配置保持不变；`displayName` 仅属于扩展客户端。
- **可链式。** 每次 `$extend` 都返回新客户端，各模块可以独立叠加（`shared` 的定义见[跨模型共享](./virtual-fields.md#跨模型共享)）：

```ts
const withShared = db.$extend({ virtuals: { user: shared, post: shared } });
const withProfile = withShared.$extend({ omit: { user: { name: true } } });
```

- **逐模型校验。** 调用 `$extend` 时按物理标量字段校验 `needs`；字段缺失或依赖其他虚拟字段都会报错。

后续扩展中同名虚拟字段的返回类型以新定义为准；同一字段的 `omit` 选项也由后续配置覆盖。内部关系校验始终使用物理键，不受全局字段排除影响。

## 共享生命周期

扩展后的客户端不建立新连接，也不重复记录事件日志，状态与原客户端共享：

- 在 `$transaction` 回调内通过扩展后的客户端执行的查询参与同一事务，随事务一起回滚。
- 任一客户端调用 `$close`，全部客户端的连接都会关闭。

```ts
await db.$transaction(async () => {
  await extended.user.create({ data: { email: "in-tx@example.com" } });
}); // 扩展后客户端的写入属于该事务
await extended.$close(); // db 也一并关闭
```

## 下一步

- [虚拟字段](./virtual-fields.md)：计算字段的定义与共享
- [客户端概览](./overview.md#选项)：基础客户端的创建选项
