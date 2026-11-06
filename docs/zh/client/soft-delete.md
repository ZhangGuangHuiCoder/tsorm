---
description: 使用 @@softDelete 启用软删除，控制记录可见性，恢复和物理删除记录。
---

# 软删除

软删除把删除操作转换为对管理字段的更新，默认查询不再返回这些记录。

## 启用

```ts
model Account {
  id: int @id @auto
  email: string(191) @unique
  deletedAt?: date

  @@softDelete(deletedAt)
}
```

`@@softDelete()` 省略参数时使用 `deletedAt`，模型未声明该字段则自动补上：

```ts
model Account {
  id: int @id @auto
  email: string(191) @unique

  @@softDelete()
}
```

## 操作

```ts
await db.account.delete({ where: { id: 1 } });
await db.account.restore({ where: { id: 1 } });
await db.account.forceDelete({ where: { id: 1 } });
```

| 方法                            | 行为                                    |
| ------------------------------- | --------------------------------------- |
| `delete`、`deleteMany`          | 写入删除时间，按客户端时区生成          |
| `restore`、`restoreMany`        | 清除删除时间                            |
| `forceDelete`、`forceDeleteMany` | 执行真实的 `DELETE`，仍受数据库外键约束 |

## 查询可见性

`deleted` 选项控制当前查询模型的可见性：

```ts
await db.account.findMany({ deleted: 'include' });
await db.account.findMany({ deleted: 'only' });
```

| 取值      | 行为                     |
| --------- | ------------------------ |
| `exclude` | 排除已删除记录，默认值   |
| `include` | 同时返回已删除记录       |
| `only`    | 只返回已删除记录         |

默认排除规则作用于列表、唯一查询、`count`、聚合、分组、关联预加载、关系过滤和关系计数。

`deleted` 只影响当前模型。关系过滤的目标始终排除已删除记录；关联预加载可以单独配置：

```ts
await db.account.findMany({
  include: { entries: { deleted: 'include' } },
});
```

## 写入规则

- 管理字段由 ORM 维护，不能通过 `update`、`updateMany` 赋值，新记录也不能带删除时间。
- 普通更新不作用于已删除记录，`upsert` 不会恢复它们。
- `restore` 需要满足唯一约束。发生冲突时，整个事务回滚。

## 唯一约束

唯一约束仍然包含已删除记录，已删除的记录会继续占用唯一键。

## 关系

- 软删除不会级联，物理外键依然存在。
- 外键写入和 `connect` 不能指向已删除的目标，否则报 `SOFT_DELETED_REFERENCE`。
- 关联预加载默认隐藏已删除的目标：必需关系因此缺失时报 `SOFT_DELETED_RELATION`，可选关系返回 `null`。
- 嵌套软删除会保留连接，以便恢复；显式的 `disconnect` 和 `set` 仍会修改连接。

::: warning 已删除的记录仍可读取
任何调用方都可以通过 `deleted: 'include'` 或原生 SQL 读取已删除的记录，原生 SQL 也不会应用软删除策略。
:::
