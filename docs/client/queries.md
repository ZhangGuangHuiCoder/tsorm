---
description: Read records with filters, projections, relation loading, ordering, pagination, and list totals.
---

# Queries

## Reading Records

| Method              | On no match        | Description                            |
| ------------------- | ------------------ | -------------------------------------- |
| `findMany`          | Returns `[]`       | Read multiple records                  |
| `findFirst`         | Returns `null`     | Read the first matching record         |
| `findFirstOrThrow`  | Raises `NOT_FOUND` | Same, return type excludes `null`      |
| `findUnique`        | Returns `null`     | Read by a unique key                   |
| `findUniqueOrThrow` | Raises `NOT_FOUND` | Same, return type excludes `null`      |
| `findManyAndCount`  | `data` is `[]`     | Return the list and the total together |
| `count`             | Returns `0`        | Count matching records                 |

```ts
const posts = await db.post.findMany({
  where: { published: true },
  orderBy: { id: "desc" },
  take: 20,
});

const user = await db.user.findUnique({ where: { email: "alice@example.com" } });
const total = await db.post.count({ where: { published: true } });
```

`findUnique` needs a complete unique key: the full primary key (all `@@id` fields), an `@unique` field, or all fields of an `@@unique`.

## Filters

```ts
await db.post.findMany({
  where: {
    title: { startsWith: "Hello" },
    views: { gte: 10 },
    body: null,
    OR: [{ published: true }, { authorId: { in: [1, 2] } }],
  },
});
```

| Operator                             | Applicable types                                                 | Description                            |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------------------------- |
| `equals`                             | All except JSON                                                  | Equality, or a bare value              |
| `not`                                | All except JSON                                                  | Inequality, or negates a sub-condition |
| `in`, `notIn`                        | All except JSON                                                  | In or not in a list                    |
| `gt`, `gte`, `lt`, `lte`             | `string`, `text`, string enums, numeric, `datetime`, `timestamp` | Comparison                             |
| `contains`, `startsWith`, `endsWith` | `string`, `text`, string enums                                   | String matching                        |

Conditions combine with `AND`, `OR`, and `NOT`, nested at most 12 levels.

### Null and Empty Collections

| Form            | Behavior                                                 |
| --------------- | -------------------------------------------------------- |
| `field: null`   | Matches `NULL`; raises an error on a non-nullable field  |
| `field: 'x'`    | `NULL` does not match                                    |
| `{ not: 'x' }`  | Matches values not equal to `x`, and also matches `NULL` |
| `{ in: [] }`    | Matches no record                                        |
| `{ notIn: [] }` | Matches every record                                     |
| `AND: []`       | Always true                                              |
| `OR: []`        | Always false                                             |

`contains`, `startsWith`, and `endsWith` use `LIKE` with automatic escaping; case sensitivity depends on the database and collation (see [Remaining Differences](../databases/overview.md#remaining-differences)). `mode: 'insensitive'` makes a string condition case-insensitive; PostgreSQL uses `ILIKE` for patterns, other databases `LOWER()` (SQLite transforms ASCII letters only).

### JSON Fields

JSON fields are filtered by path, where the path consists of object keys and array indices:

```ts
await db.account.findMany({
  where: { preferences: { path: ["theme"], equals: "dark" } },
});
await db.account.findMany({
  where: { preferences: { path: ["languages", 0], string_starts_with: "a" } },
});
```

| Operator                                                    | Description                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `equals`, `not`                                             | Equal or not equal to a string, number, boolean, or JSON `null`; differing types count as unequal |
| `gt`, `gte`, `lt`, `lte`                                    | Numeric comparison; non-numeric values never match                                                |
| `string_contains`, `string_starts_with`, `string_ends_with` | String matching; non-string values never match                                                    |

Use ordinary scalar fields for ordering, deduplication, and grouping.

## Relation Filters

| Operator      | Applicable relation | Description                              |
| ------------- | ------------------- | ---------------------------------------- |
| `some`        | To-many             | At least one matches                     |
| `none`        | To-many             | None matches                             |
| `every`       | To-many             | All match                                |
| `is`, `isNot` | To-one              | The target matches or not; may be `null` |

```ts
await db.user.findMany({
  where: { posts: { some: { published: true } } },
});

await db.user.findMany({
  where: { profile: { is: null } },
});
```

## Projections

`select` chooses returned fields, `include` attaches relations, `omit` removes fields; return types are inferred accordingly.

```ts
const users = await db.user.findMany({
  select: {
    email: true,
    posts: { take: 3, orderBy: { id: "desc" }, select: { title: true } },
  },
});

const posts = await db.post.findMany({
  include: { author: { select: { email: true } } },
  omit: { authorId: true },
});
```

- Use `select`, or `include` with `omit`; `omit` also works in nested queries, and projections nest at most 8 levels. An omitted foreign key is still loaded internally to resolve relations.
- Fields omitted via `$extend({ omit })` are excluded by default; bring them back with query-level `select` or `omit: { field: false }`, see [Extensions](./extensions.md).

## Relation Loading

To-many relations accept `where`, `orderBy`, `skip`, and `take`, with pagination computed per parent record:

```ts
await db.user.findMany({
  include: {
    posts: { where: { published: true }, orderBy: { views: "desc" }, take: 3 },
  },
});
```

To-one relations only accept `select`, `include`, `omit`, and `deleted`.

## Relation Counts

`_count` in `select` or `include` counts without loading child records; no match gives `0`.

```ts
const users = await db.user.findMany({
  select: {
    email: true,
    _count: { select: { posts: { where: { published: true } } } },
  },
});
```

`_count: true` counts all to-many relations of the model.

## Ordering

```ts
await db.post.findMany({
  orderBy: [{ views: "desc" }, { id: "asc" }],
});
```

- Without the primary key in the ordering fields, the ORM appends an ascending primary key for stable results.
- `NULL` sorts as the smallest value by default (first ascending, last descending) on all three databases; use `{ sort, nulls }` (`first` or `last`) to place it explicitly — cursor pagination and negative `take` honor it:

```ts
await db.user.findMany({ orderBy: { name: { sort: "desc", nulls: "last" } } });
```

When ordering by a relation, a to-one relation uses target-model fields, a to-many relation orders by count:

```ts
await db.post.findMany({ orderBy: { author: { email: "asc" } } });
await db.user.findMany({ orderBy: { posts: { _count: "desc" } } });
```

Relation ordering runs through correlated subqueries, excludes soft-deleted targets, and cannot be combined with `cursor`.

## Pagination

`skip` must be a non-negative integer. A top-level `take` may be negative: the last N records by `orderBy`, still returned in `orderBy` order:

```ts
await db.post.findMany({ orderBy: { id: "asc" }, take: -10 });
```

`take` in a relation query must be a non-negative integer. A negative `take` cannot be combined with `distinct`.

### Cursor Pagination

```ts
await db.post.findMany({
  cursor: { id: 10 },
  skip: 1,
  take: 20,
  orderBy: [{ views: "desc" }, { id: "asc" }],
});
```

The result includes the cursor record itself (`skip: 1` to pass it; a missing cursor returns an empty array). A negative `take` pages backwards from the cursor ("previous page"):

```ts
await db.post.findMany({
  cursor: { id: 10 },
  skip: 1,
  take: -20,
  orderBy: [{ views: "desc" }, { id: "asc" }],
});
```

## Deduplication

`distinct` picks the first record per group by `orderBy` (via window functions), then paginates:

```ts
await db.post.findMany({
  distinct: ["authorId"],
  orderBy: { views: "desc" },
});
```

## List and Total

```ts
const { data, total } = await db.account.findManyAndCount({
  where: { email: { contains: "@example.com" } },
  include: { entries: true },
  orderBy: { id: "desc" },
  skip: 0,
  take: 20,
});
```

`total` applies the same `where`, soft-delete visibility, and `distinct`; `cursor`, `skip`, `take`, and projections do not affect it. Standalone calls open a snapshot transaction (SQLite: deferred `BEGIN`; MySQL/PostgreSQL: `repeatable read` read-only) and reuse an existing one, but raise `TRANSACTION_ISOLATION` at `read committed`, since the two reads could diverge. See [Transactions](./transactions.md#isolation-levels).

## Next Steps

- [Aggregations](./aggregations.md)
- [Create](./create.md), [Update](./update.md), and [Delete](./delete.md)
