---
description: Compute statistics with aggregate and groupBy.
---

# Aggregations

`aggregate` computes statistics over a set of records, and `groupBy` first groups records by fields and then computes per group.

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

| Aggregation | Applicable fields                                      | Empty dataset |
| ----------- | ------------------------------------------------------ | ------------- |
| `_count`    | Total records or non-null values of a field            | `0`           |
| `_sum`, `_avg` | Numeric fields                                    | `null`        |
| `_min`, `_max` | Any field except JSON; `boolean` compares as `false < true` | `null`  |

`orderBy`, `skip`, and `take` apply to the input records before aggregation. At least one aggregation must be selected.

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

Rules:

- `by` contains at least one field and must not repeat a field.
- Plain fields used in `having` and `orderBy` must appear in `by`; aggregate expressions may use ungrouped fields.
- `orderBy` is required whenever `skip` or `take` is used.
- `having` nests at most 12 levels deep.
