---
description: 使用 @@softDelete 启用软删除，控制记录可见性，恢复和物理删除记录。
---

# 软删除

软删除把删除操作转换为对管理字段的更新，默认查询不再返回这些记录。

## 启用

```ts
model Account {
  id: int @id @auto
  email: string @unique
  deletedAt?: datetime

  @@softDelete(deletedAt)
}
```

`@@softDelete()` 默认使用 `deletedAt`，不存在时补上。显式指定的字段必须已存在，是默认值为 `null` 的可空 `datetime` 或 `timestamp`，且不能是主键或唯一键。

## 操作

使用 `delete` 标记删除、`restore` 恢复可见性、`forceDelete` 物理删除。方法返回值、批量变体和 `$clear` 集中见[删除](../client/delete.md#软删除)。

## 查询可见性

`deleted` 选项控制当前查询模型的可见性：

```ts
await db.account.findMany({ deleted: "include" });
await db.account.findMany({ deleted: "only" });
```

| 取值      | 行为                   |
| --------- | ---------------------- |
| `exclude` | 排除已删除记录，默认值 |
| `include` | 同时返回已删除记录     |
| `only`    | 只返回已删除记录       |

默认排除作用于列表、唯一查询、计数、聚合、分组、关联预加载和关系过滤。

`deleted` 只影响当前模型。关系过滤的目标始终排除已删除记录；关联预加载可以单独配置：

```ts
await db.account.findMany({
  include: { entries: { deleted: "include" } },
});
```

## 写入规则

- 删除时间由 ORM 维护：创建时不能传入，也不能通过普通更新赋值；普通更新不触及已删除记录，`upsert` 也不会恢复它们。
- `restore` 需要满足唯一约束；发生冲突时整个事务回滚。

## 唯一约束

唯一约束仍然包含已删除记录，已删除的记录会继续占用唯一键。

## 关系

- 软删除不级联，物理外键继续生效；外键写入和 `connect` 不能指向已删除的目标，否则报 `SOFT_DELETED_REFERENCE`。
- 关联预加载默认隐藏已删除的目标：必需关系缺失时报 `SOFT_DELETED_RELATION`，可选关系返回 `null`。
- 嵌套软删除保留连接以便恢复；显式的 `disconnect` 和 `set` 仍会修改连接。

::: warning 已删除的记录仍可读取
任何调用方都可以通过 `deleted: 'include'` 或原生 SQL 读取已删除的记录，原生 SQL 不应用软删除策略。
:::

## 下一步

- [删除](../client/delete.md)：删除操作与 `$clear`
- [参照动作](./relations/referential-actions.md)：删除的行如何影响关联记录
