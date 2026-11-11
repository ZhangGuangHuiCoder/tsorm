---
description: 更新记录，upsert，原子字段运算与批量更新。
---

# 更新

`update` 返回实际写入的记录，接受 `select`、`include` 和 `omit`。新增见[新增](./create.md)，删除见[删除](./delete.md)。

## 单条更新

```ts
await db.user.update({
  where: { id: user.id },
  data: { name: "Alice Zhang" },
});
```

- `where` 必须使用唯一键。
- 记录不存在时报 `NOT_FOUND`，不会写入任何内容。
- 已软删除的记录会被跳过：调用报 `NOT_FOUND`，删除时间字段保持只读，见[软删除](../schema/soft-delete.md)。

## upsert

```ts
const user = await db.user.upsert({
  where: { email: "alice@example.com" },
  create: { email: "alice@example.com" },
  update: { name: { set: "Alice" } },
  select: { email: true, name: true },
});
```

ORM 根据条件选择执行方式：

| 执行方式               | 使用条件                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单条原生语句           | 只写标量字段；`create` 的唯一键值与 `where` 相同；模型未启用软删除，也没有指向软删除模型的外键检查。MySQL 还要求插入的记录只可能在 `where` 指定的唯一键上冲突 |
| 同一事务内先查询后写入 | 其他情况，包括嵌套写入和软删除模型                                                                                                                            |

原生语句在 SQLite 和 PostgreSQL 上是 `ON CONFLICT DO UPDATE`，冲突目标只包含 `where` 指定的唯一约束，其他唯一冲突仍会报错。MySQL 上是 `ON DUPLICATE KEY UPDATE`，它会在任意唯一键冲突时触发，所以只有当 `create` 中除 `where` 的唯一键外没有其他非空唯一键值时才使用，例如 `where: { email }` 且主键自增。

`upsert` 不会恢复已软删除的记录：唯一键仍被占用，更新路径与其他写入已删除记录的操作一样失败。

::: warning 并发创建
原生语句由数据库保证并发安全。先查询后写入的路径在并发首次创建时可能遇到唯一约束或事务冲突，调用方按需重试整个事务。
:::

## 原子字段更新

运算直接在 `UPDATE` 语句中执行，参数独立绑定：

```ts
await db.post.update({
  where: { id: 1 },
  data: { views: { increment: 1 }, title: { set: "New title" } },
});

await db.post.updateMany({
  where: { published: true },
  data: { views: { multiply: 2 } },
});
```

| 运算                                           | 适用字段                             |
| ---------------------------------------------- | ------------------------------------ |
| `set`                                          | 全部                                 |
| `increment`、`decrement`、`multiply`、`divide` | `int`、`bigint`、`number`、`decimal` |

- 每个字段一次只能指定一个运算，除数须为非零值。
- `int` 字段的操作数必须是安全整数，`bigint` 字段接受 `bigint` 或安全整数；整数除法向零截断。
- `decimal` 字段的操作数可以是数字字符串或数字，运算在数据库中执行，受其精度规则限制；SQLite 不保证精确小数运算。
- `NULL` 参与运算的结果仍是 `NULL`。
- `int` 结果超出 JavaScript 安全整数范围时报 `NUMERIC_OVERFLOW`，整个操作回滚。

## updateMany

```ts
const { count } = await db.post.updateMany({
  where: { published: false },
  data: { published: true },
});
```

- 只接受标量字段。
- `where` 必须提供且不能为空；传入 `{}` 报 `VALIDATION`。批量更新不会隐式作用于无过滤条件的整表；`$clear` 用于删除记录，不能替代任意字段更新。
- `count` 是匹配的记录数，包括赋值后没有变化的记录。
- 已软删除的记录不在匹配范围内，不会被更新。
- 通常使用一条集合 `UPDATE`。涉及软删除外键校验或 MySQL 算术结果检查时，会逐条执行以保证正确性。
- 配置 `maxAffected` 后先统计命中行数，超过上限报 `MASS_WRITE_BLOCKED`。

## updateManyAndReturn

```ts
const updated = await db.post.updateManyAndReturn({
  where: { published: false },
  data: { published: true, views: { increment: 1 } },
  include: { author: { select: { email: true } } },
  omit: { body: true },
});
```

- 支持 `select`、`include`、`omit` 和虚拟字段。
- `where` 必须提供且不能为空；传入 `{}` 报 `VALIDATION`。
- 结果顺序不保证，需要时按业务键自行排序。
- 返回的是实际写入的结果。即使更新改变了过滤字段，相应记录也会返回。
- 更新数据为空时返回匹配的记录。

## 数据库差异

| 能力                  | SQLite      | PostgreSQL  | MySQL / MariaDB                        |
| --------------------- | ----------- | ----------- | -------------------------------------- |
| `updateManyAndReturn` | `RETURNING` | `RETURNING` | 事务内先选出匹配主键，再逐条更新并读回 |

MySQL / MariaDB 适配器不使用 `RETURNING`，按主键回读的策略需要额外语句。

## 下一步

- [创建](./create.md)：写入新记录，含批量插入
- [删除](./delete.md)：移除记录而不是修改
- [写入安全](./overview.md#写入安全)：批量更新的行数上限
