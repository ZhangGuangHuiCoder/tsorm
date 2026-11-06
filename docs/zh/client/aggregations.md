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
  _min: { createdAt: true },
  _max: { createdAt: true },
});
```

| 聚合   | 适用字段             | 数据集为空时 |
| ------ | -------------------- | ------------ |
| `_count` | 记录总数或非空字段 | `0`          |
| `_sum`、`_avg` | 数值字段     | `null`       |
| `_min`、`_max` | 除 JSON 外的字段；`boolean` 按 `false < true` 比较 | `null` |

`orderBy`、`skip` 和 `take` 先作用于输入记录，再计算聚合。至少需要选择一个聚合。

## groupBy

```ts
const groups = await db.post.groupBy({
  by: ['published'],
  _count: { _all: true },
  _sum: { views: true },
  having: { views: { _sum: { gt: 10 } } },
  orderBy: { _sum: { views: 'desc' } },
  take: 10,
});
```

规则：

- `by` 至少包含一个字段，且不能重复。
- `having` 和 `orderBy` 中的普通字段必须出现在 `by` 中，聚合表达式可以使用未分组的字段。
- 使用 `skip` 或 `take` 时必须指定 `orderBy`。
- `having` 的嵌套深度最多 12 层。
