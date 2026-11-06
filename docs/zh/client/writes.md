---
description: 创建、更新、删除和 upsert 记录，原子字段更新，批量写入。
---

# 写入

## 单条写入

```ts
const user = await db.user.create({
  data: { email: 'alice@example.com', name: 'Alice' },
});

await db.user.update({
  where: { id: user.id },
  data: { name: 'Alice Zhang' },
});

await db.user.delete({ where: { id: user.id } });
```

`create`、`update` 和 `delete` 都接受 `select`、`include` 和 `omit`，返回实际写入的记录；`@auto` 主键不能显式赋值。

记录不存在时，`update` 和 `delete` 报 `NOT_FOUND`。关系相关的写入见[关系写入](./relation-writes.md)。

## 原子字段更新

运算直接在 `UPDATE` 语句中执行，参数独立绑定：

```ts
await db.post.update({
  where: { id: 1 },
  data: { views: { increment: 1 }, title: { set: 'New title' } },
});

await db.post.updateMany({
  where: { published: true },
  data: { views: { multiply: 2 } },
});
```

| 运算                                       | 适用字段 |
| ------------------------------------------ | -------- |
| `set`                                      | 全部     |
| `increment`、`decrement`、`multiply`、`divide` | `int`、`bigint`、`number`、`decimal` |

- 每个字段一次只能指定一个运算，除数不能为零。
- `int` 字段的操作数必须是安全整数，`bigint` 字段接受 `bigint` 或安全整数；整数除法向零截断。
- `decimal` 字段的操作数可以是数字字符串或数字，运算在数据库中精确执行。
- `NULL` 参与运算的结果仍是 `NULL`。
- 结果超出安全整数范围时报 `NUMERIC_OVERFLOW`，整个操作回滚。

## upsert

```ts
const user = await db.user.upsert({
  where: { email: 'alice@example.com' },
  create: { email: 'alice@example.com' },
  update: { name: { set: 'Alice' } },
  select: { email: true, name: true },
});
```

ORM 根据条件选择执行方式：

| 执行方式 | 使用条件 |
| --- | --- |
| 单条原生语句 | 只写标量字段；`create` 的唯一键值与 `where` 相同；模型未启用软删除，也没有指向软删除模型的外键检查。MySQL 还要求插入的记录只可能在 `where` 指定的唯一键上冲突 |
| 同一事务内先查询后写入 | 其他情况，包括嵌套写入和软删除模型 |

原生语句在 SQLite 和 PostgreSQL 上是 `ON CONFLICT DO UPDATE`，冲突目标只包含 `where` 指定的唯一约束，其他唯一冲突仍会报错。MySQL 上是 `ON DUPLICATE KEY UPDATE`，它会在任意唯一键冲突时触发，所以只有当 `create` 中除 `where` 的唯一键外没有其他非空唯一键值时才使用，例如 `where: { email }` 且主键自增。

::: warning 并发创建
原生语句由数据库保证并发安全。先查询后写入的路径在并发首次创建时可能遇到唯一约束或事务冲突，ORM 不会自动重试，调用方可以重试整个事务。
:::

## 批量写入

### createMany

```ts
const { count } = await db.user.createMany({
  data: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
  skipDuplicates: true,
});
```

- 只接受标量字段，关联通过外键传入；不接受嵌套关系和自动生成的 ID。
- 默认值、`uuid()`、`now()`、类型化 JSON 和软删除外键检查的行为与单条 `create` 相同。
- 使用多行 `INSERT`，按 900 个参数的预算分批。所有批次在同一事务内，任一错误都会回滚全部批次。
- 空输入返回 `{ count: 0 }`。
- `count` 是实际插入的记录数。启用 `skipDuplicates` 后，唯一冲突（包括批内重复）不计入，其他校验和外键错误仍会报错。

### updateMany 和 deleteMany

```ts
const updated = await db.post.updateMany({
  where: { published: false },
  data: { published: true },
});

const deleted = await db.post.deleteMany({
  where: { title: { startsWith: 'draft' } },
});
```

`updateMany` 只接受标量字段。`count` 是匹配的记录数，包括赋值后没有变化的记录。

通常使用一条集合 `UPDATE`。涉及软删除外键校验或 MySQL 算术结果检查时，会逐条执行以保证正确性。

### 返回写入结果

批量写入后直接返回写入的记录：

```ts
const created = await db.user.createManyAndReturn({
  data: [{ email: 'c@example.com' }],
  select: { id: true, email: true },
});

const updated = await db.post.updateManyAndReturn({
  where: { published: false },
  data: { published: true, views: { increment: 1 } },
  include: { author: { select: { email: true } } },
  omit: { createdAt: true },
});
```

- 支持 `select`、`include`、`omit` 和虚拟字段。
- 不保证返回顺序，需要时请按业务键自行排序。
- 返回的是实际写入的结果。即使更新改变了过滤字段，相应记录也会返回。
- 空输入返回空数组；更新数据为空时返回匹配的记录。

### 数据库差异

| 能力                  | SQLite                   | PostgreSQL               | MySQL / MariaDB            |
| --------------------- | ------------------------ | ------------------------ | -------------------------- |
| 多行 `INSERT`         | 支持                     | 支持                     | 支持                       |
| `skipDuplicates`      | `ON CONFLICT DO NOTHING` | `ON CONFLICT DO NOTHING` | 逐条执行，只捕获唯一冲突   |
| `createManyAndReturn` | `RETURNING`              | `RETURNING`              | 事务内逐条插入，按 `insertId` 读回 |
| `updateManyAndReturn` | `RETURNING`              | `RETURNING`              | 事务内先选出匹配主键，再逐条更新并读回 |

MySQL 没有 `RETURNING`，所以两个返回方法在 MySQL 上需要更多语句，数据量大时更慢；行为和返回结果与其他数据库相同。MySQL 不使用 `INSERT IGNORE`，以免吞掉无效值、非空或外键错误。

软删除模型的唯一约束包含已删除的记录，`skipDuplicates` 不会恢复它们。指向软删除模型的外键在去重前仍需通过引用校验。
