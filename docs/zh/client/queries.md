---
description: 读取记录，使用过滤条件、投影、关系加载、排序、分页和列表总数。
---

# 查询

## 读取记录

| 方法                | 无结果时         | 说明                     |
| ------------------- | ---------------- | ------------------------ |
| `findMany`          | 返回 `[]`        | 读取多条记录             |
| `findFirst`         | 返回 `null`      | 读取第一条匹配记录       |
| `findFirstOrThrow`  | 报 `NOT_FOUND`   | 同上，返回类型不含 `null` |
| `findUnique`        | 返回 `null`      | 按唯一键读取             |
| `findUniqueOrThrow` | 报 `NOT_FOUND`   | 同上，返回类型不含 `null` |
| `findManyAndCount`  | `data` 为 `[]`   | 同时返回列表和总数       |
| `count`             | 返回 `0`         | 统计匹配记录数           |

```ts
const posts = await db.post.findMany({
  where: { published: true },
  orderBy: { createdAt: 'desc' },
  take: 20,
});

const user = await db.user.findUnique({ where: { email: 'alice@example.com' } });
const total = await db.post.count({ where: { published: true } });
```

`findUnique` 的 `where` 必须是一个完整的唯一键：主键、`@unique` 字段，或 `@@unique` 的全部字段。

## 过滤条件

字段可以直接比较，也可以使用过滤运算符：

```ts
await db.post.findMany({
  where: {
    title: { startsWith: 'Hello' },
    views: { gte: 10 },
    reviewerId: null,
    OR: [{ published: true }, { authorId: { in: [1, 2] } }],
  },
});
```

| 运算符                             | 适用类型                 | 说明                   |
| ---------------------------------- | ------------------------ | ---------------------- |
| `equals`                           | 除 JSON 外的全部类型     | 等于，也可以直接写值   |
| `not`                              | 除 JSON 外的全部类型     | 不等于，或否定子条件   |
| `in`、`notIn`                      | 除 JSON 外的全部类型     | 在或不在列表中         |
| `gt`、`gte`、`lt`、`lte`           | `string`、数值、`date`   | 大小比较               |
| `contains`、`startsWith`、`endsWith` | `string`                 | 字符串匹配             |

条件之间可以用 `AND`、`OR`、`NOT` 组合，嵌套深度最多 12 层。

### 空值与空集合

| 写法                 | 行为                                  |
| -------------------- | ------------------------------------- |
| `field: null`        | 匹配 `NULL`，不可空字段会报错         |
| `field: 'x'`         | `NULL` 不匹配                         |
| `{ not: 'x' }`       | 匹配不等于 `x` 的值，也匹配 `NULL`    |
| `{ in: [] }`         | 不匹配任何记录                        |
| `{ notIn: [] }`      | 匹配全部记录                          |
| `AND: []`            | 恒为真                                |
| `OR: []`             | 恒为假                                |

::: info 字符串比较
`contains`、`startsWith` 和 `endsWith` 通过 `LIKE` 实现，字面量 `%`、`_` 和 `!` 会自动转义。大小写是否敏感取决于数据库和排序规则，详见[仍然存在的差异](../databases/overview.md#仍然存在的差异)。
:::

字符串条件加 `mode: 'insensitive'` 后不区分大小写，例如 `{ email: { equals: 'a@x.com', mode: 'insensitive' } }`。PostgreSQL 使用 `ILIKE`，其他数据库两侧使用 `LOWER()`；SQLite 的 `LOWER()` 只转换 ASCII 字母。

### JSON 字段

JSON 字段按路径过滤，路径由对象键和数组下标组成：

```ts
await db.account.findMany({
  where: { preferences: { path: ['theme'], equals: 'dark' } },
});
await db.account.findMany({
  where: { preferences: { path: ['tags', 0], string_starts_with: 'a' } },
});
```

| 运算符 | 说明 |
| --- | --- |
| `equals`、`not` | 等于或不等于字符串、数字、布尔值或 JSON `null`，类型不同视为不等 |
| `gt`、`gte`、`lt`、`lte` | 数字比较，非数字值不匹配 |
| `string_contains`、`string_starts_with`、`string_ends_with` | 字符串匹配，非字符串值不匹配 |

JSON 字段不能用于排序、去重或分组。

## 关系过滤

| 运算符             | 适用关系 | 说明               |
| ------------------ | -------- | ------------------ |
| `some`             | 多条     | 至少一条匹配       |
| `none`             | 多条     | 没有匹配           |
| `every`            | 多条     | 全部匹配           |
| `is`、`isNot`      | 单条     | 目标匹配或不匹配，可传 `null` |

```ts
await db.user.findMany({
  where: { posts: { some: { published: true } } },
});

await db.post.findMany({
  where: { reviewer: { is: null } },
});
```

## 投影

`select` 指定返回字段，`include` 在完整记录上附加关系，`omit` 从完整记录中排除字段。返回类型会随之推导。

```ts
const users = await db.user.findMany({
  select: {
    email: true,
    posts: { take: 3, orderBy: { id: 'desc' }, select: { title: true } },
  },
});

const posts = await db.post.findMany({
  include: { author: { select: { email: true } } },
  omit: { authorId: true },
});
```

- `select` 不能与 `include` 或 `omit` 同时使用。
- `omit` 可以与 `include` 组合，也可以用于嵌套查询。被排除的外键仍会在内部加载，用于解析关系。
- 投影最多嵌套 8 层。
- 客户端选项 `omit` 设置的字段默认排除，查询中的 `select` 或 `omit: { 字段: false }` 可以取回，见[客户端选项](./overview.md#选项)。

## 关系加载

多条关系可以设置 `where`、`orderBy`、`skip` 和 `take`，分页按每个父记录独立计算：

```ts
await db.user.findMany({
  include: {
    posts: { where: { published: true }, orderBy: { views: 'desc' }, take: 3 },
  },
});
```

单条关系只能设置 `select`、`include`、`omit` 和 `deleted`。

## 关系计数

在 `select` 或 `include` 中使用 `_count`，计数不加载子记录，没有匹配时为 `0`。

```ts
const users = await db.user.findMany({
  select: {
    email: true,
    _count: { select: { posts: { where: { published: true } } } },
  },
});
```

`_count: true` 统计该模型的全部多条关系。

## 排序

```ts
await db.post.findMany({
  orderBy: [{ views: 'desc' }, { id: 'asc' }],
});
```

- 如果排序字段中没有主键，ORM 会自动追加主键升序，保证结果稳定。
- 默认把 `NULL` 当作最小值：升序时排在最前，降序时排在最后，三种数据库行为一致。
- 用 `{ sort, nulls }` 显式指定 `NULL` 的位置，`nulls` 可以是 `first` 或 `last`。游标分页和负数 `take` 会遵循同样的位置：

```ts
await db.user.findMany({ orderBy: { name: { sort: 'desc', nulls: 'last' } } });
```

PostgreSQL 生成 `NULLS FIRST` / `NULLS LAST`，MySQL 和 SQLite 在需要时追加一个 `IS NULL` 排序项。

按关系排序时，单条关系写目标模型的字段，多条关系按数量排序：

```ts
await db.post.findMany({ orderBy: { author: { email: 'asc' } } });
await db.user.findMany({ orderBy: { posts: { _count: 'desc' } } });
```

关系排序通过关联子查询实现，已软删除的目标不参与；不能与 `cursor` 一起使用。

## 分页

`skip` 必须是非负整数。顶层查询的 `take` 可以为负数，表示按 `orderBy` 取最后若干条，结果仍按 `orderBy` 排列：

```ts
await db.post.findMany({ orderBy: { id: 'asc' }, take: -10 });
```

关系查询中的 `take` 必须是非负整数。负数 `take` 不能与 `distinct` 一起使用。

### 游标分页

```ts
await db.post.findMany({
  cursor: { id: 10 },
  skip: 1,
  take: 20,
  orderBy: [{ views: 'desc' }, { id: 'asc' }],
});
```

结果包含游标记录本身，用 `skip: 1` 跳过。游标不存在时返回空数组。

负数 `take` 从游标向前翻页，适合“上一页”：

```ts
await db.post.findMany({
  cursor: { id: 10 },
  skip: 1,
  take: -20,
  orderBy: [{ views: 'desc' }, { id: 'asc' }],
});
```

## 去重

`distinct` 使用窗口函数选出每组按 `orderBy` 的第一条记录，然后再分页：

```ts
await db.post.findMany({
  distinct: ['authorId'],
  orderBy: { views: 'desc' },
});
```

## 列表和总数

`findManyAndCount` 在同一连接、同一快照内读取列表和总数，适合分页接口：

```ts
const { data, total } = await db.account.findManyAndCount({
  where: { name: { contains: '张' } },
  include: { entries: true },
  orderBy: { id: 'desc' },
  skip: 0,
  take: 20,
});
```

`total` 应用相同的 `where`、软删除可见性和 `distinct`，不受 `cursor`、`skip`、`take` 和投影影响。

单独调用时，ORM 会开启快照事务：SQLite 使用 deferred `BEGIN`，MySQL 和 PostgreSQL 使用 `repeatable read` 只读事务。在已有事务中调用时会复用该事务；如果隔离级别是 `read committed`，报 `TRANSACTION_ISOLATION`，因为此时无法保证两次读取的一致性。详见[事务](./transactions.md#隔离级别)。

## 下一步

- [聚合与分组](./aggregations.md)
- [写入](./writes.md)
