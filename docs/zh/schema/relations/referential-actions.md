---
description: 在 schema.orm 中用 @relation 配置 onDelete 与 onUpdate，了解每种参照动作在记录被删除或主键变更时的行为。
---

# 参照动作

参照动作决定被引用的记录被删除、或其主键发生变化时，引用它的记录如何处理。它们声明在关系的持有方一侧。

## 定义

`onDelete` 与 `onUpdate` 是 `@relation` 的选项。`onDelete` 默认为 `Restrict`；省略 `onUpdate` 时，MySQL / PostgreSQL 生成 `RESTRICT`，SQLite 使用数据库默认的 `NO ACTION`。

| 动作       | 行为                                       |
| ---------- | ------------------------------------------ |
| `Restrict` | 存在引用时拒绝操作                         |
| `NoAction` | 存在引用时拒绝操作，在语句结束时检查       |
| `Cascade`  | 一并删除引用它的记录，或同步更新它们的外键 |
| `SetNull`  | 把外键设为 `NULL`，用于可选关系            |

## 示例

```ts
model Post {
  id: int @id @auto
  title: string
  author: User @relation(onDelete: Cascade)
  editor?: User @relation(onDelete: SetNull)
}
```

在这份 schema 下，删除用户会一并删除他撰写的文章，并清空他编辑过的文章上的 `editor` 引用。删除一个仍被作为编辑者引用的用户是允许的，因为 `SetNull` 需要一个可空列。

## 注意事项

- 外键动作由数据库执行，在原生 SQL 中同样生效。
- `onUpdate` 通常使用默认值。
- [软删除](../soft-delete.md)只设置删除时间，不触发参照动作。
- 多对多中间表的连接始终随两侧记录一起删除。
- `SetNull` 要求关系可选，因为列必须能接受 `NULL`。
- 动作作用于声明它的那个关系；一对一关系与一对多关系使用同样的四种动作。

## 下一步

- [外键字段](./foreign-keys.md)：显式声明外键列
- [软删除](../soft-delete.md)：不真删，只隐藏记录
