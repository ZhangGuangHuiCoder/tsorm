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
  _min: { views: true },
  _max: { views: true },
});
```

| Aggregation    | Applicable fields                                           | Empty dataset |
| -------------- | ----------------------------------------------------------- | ------------- |
| `_count`       | Total records or non-null values of a non-JSON field        | `0`           |
| `_sum`, `_avg` | Numeric fields                                              | `null`        |
| `_min`, `_max` | Any field except JSON; `boolean` compares as `false < true` | `null`        |

`orderBy`, `skip`, and `take` apply to the input records before aggregation. At least one aggregation must be selected.

## Numeric Result Types

| Field type      | `_sum`           | `_avg`           |
| --------------- | ---------------- | ---------------- |
| `int`, `number` | `number \| null` | `number \| null` |
| `bigint`        | `string \| null` | `string \| null` |
| `decimal`       | `string \| null` | `string \| null` |

String results avoid converting bigint and decimal aggregates to JavaScript numbers. SQLite numeric storage and arithmetic precision limits still apply.

Decimal aggregate thresholds in `having` accept strings or finite numbers. `_sum` and `_avg` thresholds are not limited by the source column's precision and scale. SQLite explicitly casts decimal comparison parameters to NUMERIC.

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

Rules:

- `by` contains at least one non-JSON scalar field and must not repeat a field; a database unique constraint is not required.
- Plain fields used in `having` and `orderBy` must appear in `by`; aggregate expressions may use ungrouped fields.
- `orderBy` is required whenever `skip` or `take` is used.
- `having` nests at most 12 levels deep.

## Next Steps

- [Queries](./queries.md): filters and projections applied before aggregation
- [Type Mapping](../databases/overview.md#type-mapping): the physical type behind each numeric result
