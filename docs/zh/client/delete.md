---
description: 删除单条和多条记录、显式清空整表、软删除生命周期与外键约束。
---

# 删除

`delete` 返回被删除的记录，接受 `select`、`include` 和 `omit`。新增见[新增](./create.md)，更新见[更新](./update.md)。

## 单条删除

```ts
const removed = await db.user.delete({
  where: { id: user.id },
  select: { id: true, email: true },
});
```

- `where` 必须使用唯一键。
- 记录不存在时报 `NOT_FOUND`；被软删除隐藏的记录同样视为不存在。

## deleteMany

```ts
const { count } = await db.post.deleteMany({
  where: { title: { startsWith: "draft" } },
});
```

- `where` 必须提供且不能为空；传入 `{}` 报 `VALIDATION`。需要清空整表时使用 [`$clear`](#清空整表)。
- `count` 是被删除的记录数。
- 已软删除的记录不在匹配范围内，不会被重复删除。

## 清空整表

`$clear` 用于显式删除模型的全部记录。调用前请确认目标模型和外键约束：

```ts
await db.$clear("account"); // 软删除模型：只写删除时间
await db.$clear("account", { force: true }); // 物理删除所有行，包括已软删除的
```

- 返回 `{ count }`，受影响的行数。
- 不传 `force` 时，带 `@@softDelete` 的模型走软删除，其余模型物理删除。
- `force` 忽略可见性，把已软删除的行也一并移除。
- 事务客户端上同样可用：`tx.$clear`。
- 不受 `maxAffected` 限制：调用本身就是确认动作，清空整表不会被行数上限拦下。

顶层批量方法保持严格：`deleteMany`、`forceDeleteMany`、`restoreMany`、`updateMany` 和 `updateManyAndReturn` 都会以 `VALIDATION` 拒绝缺失或为空的 `where`。

## 软删除

启用 `@@softDelete` 时，`delete` 和 `deleteMany` 写入删除时间而不是移除数据行。记录从默认查询中消失、继续占用唯一键、拒绝普通更新 —— `update` 报 `NOT_FOUND`，`updateMany` 匹配不到它们。

| 方法                             | 行为                                    |
| -------------------------------- | --------------------------------------- |
| `delete`、`deleteMany`           | 写入删除时间，按客户端时区生成          |
| `restore`、`restoreMany`         | 清除删除时间                            |
| `forceDelete`、`forceDeleteMany` | 执行真实的 `DELETE`，仍受数据库外键约束 |

`restoreMany` 和 `forceDeleteMany` 与 `deleteMany` 一样必须提供非空 `where`。未启用 `@@softDelete` 的模型上，`restore` 和 `restoreMany` 报 `VALIDATION`，而 `forceDelete` 和 `forceDeleteMany` 就是普通删除。可见性由查询的 `deleted` 选项控制，指向已删除记录的外键报 `SOFT_DELETED_REFERENCE`；详见[软删除](../schema/soft-delete.md)。

## 参照动作

物理删除由数据库执行，声明在外键上的参照动作决定关联记录的去向：

- `RESTRICT`（默认）阻止删除，报外键错误。
- `SET NULL` 清空引用列。
- `CASCADE` 一并删除关联记录。

软删除不移除数据行，外键仍然有效，参照动作不会触发。关系上的嵌套删除见[关系写入](./relation-writes.md)，完整矩阵见[参照动作](../schema/relations/referential-actions.md)。

## 下一步

- [软删除](../schema/soft-delete.md)：恢复记录并控制可见性
- [参照动作](../schema/relations/referential-actions.md)：关联记录的去向
- [更新](./update.md)：修改记录而不是移除
