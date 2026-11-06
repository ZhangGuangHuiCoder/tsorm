---
description: Read records with filters, projections, relation loading, ordering, pagination, and list totals.
---

# Queries

## Reading Records

| Method              | On no match       | Description                        |
| ------------------- | ----------------- | ---------------------------------- |
| `findMany`          | Returns `[]`      | Read multiple records              |
| `findFirst`         | Returns `null`    | Read the first matching record     |
| `findFirstOrThrow`  | Raises `NOT_FOUND`| Same, return type excludes `null`  |
| `findUnique`        | Returns `null`    | Read by a unique key               |
| `findUniqueOrThrow` | Raises `NOT_FOUND`| Same, return type excludes `null`  |
| `findManyAndCount`  | `data` is `[]`    | Return the list and the total together |
| `count`             | Returns `0`       | Count matching records             |

```ts
const posts = await db.post.findMany({
  where: { published: true },
  orderBy: { createdAt: 'desc' },
  take: 20,
});

const user = await db.user.findUnique({ where: { email: 'alice@example.com' } });
const total = await db.post.count({ where: { published: true } });
```

The `where` of `findUnique` must be a complete unique key: the primary key, an `@unique` field, or all fields of an `@@unique`.

## Filters

Compare a field directly or through filter operators:

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

| Operator                             | Applicable types            | Description            |
| ------------------------------------ | --------------------------- | ---------------------- |
| `equals`                             | All except JSON             | Equality, or a bare value |
| `not`                                | All except JSON             | Inequality, or negates a sub-condition |
| `in`, `notIn`                        | All except JSON             | In or not in a list    |
| `gt`, `gte`, `lt`, `lte`             | `string`, numeric, `date`   | Comparison             |
| `contains`, `startsWith`, `endsWith` | `string`                    | String matching        |

Conditions combine with `AND`, `OR`, and `NOT`, nested at most 12 levels.

### Null and Empty Collections

| Form                 | Behavior                                |
| -------------------- | --------------------------------------- |
| `field: null`        | Matches `NULL`; raises an error on a non-nullable field |
| `field: 'x'`         | `NULL` does not match                   |
| `{ not: 'x' }`       | Matches values not equal to `x`, and also matches `NULL` |
| `{ in: [] }`         | Matches no record                       |
| `{ notIn: [] }`      | Matches every record                    |
| `AND: []`            | Always true                             |
| `OR: []`             | Always false                            |

::: info String comparison
`contains`, `startsWith`, and `endsWith` are implemented with `LIKE`, and literal `%`, `_`, and `!` are escaped automatically. Case sensitivity depends on the database and collation; see [Remaining Differences](../databases/overview.md#remaining-differences).
:::

Adding `mode: 'insensitive'` to a string condition makes it case-insensitive, for example `{ email: { equals: 'a@x.com', mode: 'insensitive' } }`. PostgreSQL uses `ILIKE`; other databases wrap both sides in `LOWER()`, and SQLite's `LOWER()` only transforms ASCII letters.

### JSON Fields

JSON fields are filtered by path, where the path consists of object keys and array indices:

```ts
await db.account.findMany({
  where: { preferences: { path: ['theme'], equals: 'dark' } },
});
await db.account.findMany({
  where: { preferences: { path: ['tags', 0], string_starts_with: 'a' } },
});
```

| Operator | Description |
| -------- | ----------- |
| `equals`, `not` | Equal or not equal to a string, number, boolean, or JSON `null`; differing types count as unequal |
| `gt`, `gte`, `lt`, `lte` | Numeric comparison; non-numeric values never match |
| `string_contains`, `string_starts_with`, `string_ends_with` | String matching; non-string values never match |

JSON fields cannot be used for ordering, deduplication, or grouping.

## Relation Filters

| Operator        | Applicable relation | Description              |
| --------------- | ------------------- | ------------------------ |
| `some`          | To-many             | At least one matches     |
| `none`          | To-many             | None matches             |
| `every`         | To-many             | All match                |
| `is`, `isNot`   | To-one              | The target matches or not; may be `null` |

```ts
await db.user.findMany({
  where: { posts: { some: { published: true } } },
});

await db.post.findMany({
  where: { reviewer: { is: null } },
});
```

## Projections

`select` chooses returned fields, `include` attaches relations to the full record, and `omit` removes fields from the full record. Return types are inferred accordingly.

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

- `select` cannot be combined with `include` or `omit`.
- `omit` can combine with `include` and can be used in nested queries. An omitted foreign key is still loaded internally to resolve relations.
- Projections nest at most 8 levels.
- Fields set by the client-level `omit` option are excluded by default; `select` or `omit: { field: false }` in a query brings them back, see [Options](./overview.md#options).

## Relation Loading

To-many relations accept `where`, `orderBy`, `skip`, and `take`; pagination is computed independently for each parent record:

```ts
await db.user.findMany({
  include: {
    posts: { where: { published: true }, orderBy: { views: 'desc' }, take: 3 },
  },
});
```

To-one relations only accept `select`, `include`, `omit`, and `deleted`.

## Relation Counts

`_count` in `select` or `include` counts without loading child records and returns `0` when nothing matches.

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
  orderBy: [{ views: 'desc' }, { id: 'asc' }],
});
```

- If the ordering fields do not include the primary key, the ORM appends an ascending primary key to keep results stable.
- By default `NULL` is treated as the smallest value: first in ascending order, last in descending, identically across the three databases.
- Use `{ sort, nulls }` to place `NULL` explicitly, where `nulls` is `first` or `last`. Cursor pagination and negative `take` honor the same placement:

```ts
await db.user.findMany({ orderBy: { name: { sort: 'desc', nulls: 'last' } } });
```

PostgreSQL emits `NULLS FIRST` / `NULLS LAST`; MySQL and SQLite append an `IS NULL` ordering term when needed.

When ordering by a relation, a to-one relation uses fields of the target model, and a to-many relation orders by count:

```ts
await db.post.findMany({ orderBy: { author: { email: 'asc' } } });
await db.user.findMany({ orderBy: { posts: { _count: 'desc' } } });
```

Relation ordering runs through correlated subqueries; soft-deleted targets are excluded, and it cannot be combined with `cursor`.

## Pagination

`skip` must be a non-negative integer. In a top-level query `take` may be negative, meaning take the last N records by `orderBy` while still returning them in `orderBy` order:

```ts
await db.post.findMany({ orderBy: { id: 'asc' }, take: -10 });
```

`take` in a relation query must be a non-negative integer. A negative `take` cannot be combined with `distinct`.

### Cursor Pagination

```ts
await db.post.findMany({
  cursor: { id: 10 },
  skip: 1,
  take: 20,
  orderBy: [{ views: 'desc' }, { id: 'asc' }],
});
```

The result includes the cursor record itself; use `skip: 1` to pass it. When the cursor does not exist, an empty array is returned.

A negative `take` pages backwards from the cursor, which suits a "previous page":

```ts
await db.post.findMany({
  cursor: { id: 10 },
  skip: 1,
  take: -20,
  orderBy: [{ views: 'desc' }, { id: 'asc' }],
});
```

## Deduplication

`distinct` uses window functions to pick the first record per group by `orderBy`, then paginates:

```ts
await db.post.findMany({
  distinct: ['authorId'],
  orderBy: { views: 'desc' },
});
```

## List and Total

`findManyAndCount` reads the list and the total on one connection within one snapshot, which suits pagination endpoints:

```ts
const { data, total } = await db.account.findManyAndCount({
  where: { name: { contains: 'Z' } },
  include: { entries: true },
  orderBy: { id: 'desc' },
  skip: 0,
  take: 20,
});
```

`total` applies the same `where`, soft-delete visibility, and `distinct`, and is unaffected by `cursor`, `skip`, `take`, and projections.

When called on its own, the ORM opens a snapshot transaction: SQLite uses a deferred `BEGIN`, and MySQL and PostgreSQL use a `repeatable read` read-only transaction. Inside an existing transaction it reuses that transaction; if the isolation level is `read committed` it raises `TRANSACTION_ISOLATION`, because consistency between the two reads cannot be guaranteed there. See [Transactions](./transactions.md#isolation-levels).

## Next Steps

- [Aggregations](./aggregations.md)
- [Writes](./writes.md)
