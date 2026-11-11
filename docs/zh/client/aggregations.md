---
description: 使用 aggregate 和 groupBy 计算统计值。
---

# 聚合与分组

`aggregate` 对一组记录计算统计值，`groupBy` 按字段分组后分别计算。

## aggregate

```ts
const totals = await db.post.aggregate({
  where: { published: true },
  _count: true,
  _sum: { views: true },
  _avg: { views: true },
  _min: { views: true },
  _max: { views: true },
});
```

| 聚合           | 适用字段                                           | 数据集为空时 |
| -------------- | -------------------------------------------------- | ------------ |
| `_count`       | 记录总数，或非 JSON 字段的非空值数量               | `0`          |
| `_sum`、`_avg` | 数值字段                                           | `null`       |
| `_min`、`_max` | 除 JSON 外的字段；`boolean` 按 `false < true` 比较 | `null`       |

`orderBy`、`skip` 和 `take` 先作用于输入记录，再计算聚合。至少需要选择一个聚合。

## 数值结果类型

| 字段类型        | `_sum`           | `_avg`           |
| --------------- | ---------------- | ---------------- |
| `int`、`number` | `number \| null` | `number \| null` |
| `bigint`        | `string \| null` | `string \| null` |
| `decimal`       | `string \| null` | `string \| null` |

字符串结果避免将 bigint 和 decimal 聚合值转换为 JavaScript number；SQLite 的数值存储与运算精度限制仍然适用。

decimal 的 `HAVING` 聚合阈值接受字符串或有限 number；`_sum` 与 `_avg` 的阈值不受源字段 precision/scale 限制。SQLite 对 decimal 比较参数显式进行 NUMERIC 转换。

## groupBy

```ts
const groups = await db.post.groupBy({
  by: ["published"],
  _count: { _all: true },
  _sum: { views: true },
  having: { views: { _sum: { gt: 10 } } },
  orderBy: { _sum: { views: "desc" } },
  take: 10,
});
```

规则：

- `by` 至少包含一个非 JSON 标量字段，字段名不能重复，不要求字段具有数据库唯一约束。
- `having` 和 `orderBy` 中的普通字段必须出现在 `by` 中，聚合表达式可以使用未分组的字段。
- 使用 `skip` 或 `take` 时必须指定 `orderBy`。
- `having` 的嵌套深度最多 12 层。

## 下一步

- [查询](./queries.md)：聚合前应用的过滤与投影
- [类型映射](../databases/overview.md#类型映射)：每个数值结果对应的物理类型
