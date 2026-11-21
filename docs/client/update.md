---
description: Update records, upsert, atomic field operations, and bulk updates.
---

# Update

`update` returns the record actually written and accepts `select`, `include`, and `omit`. Creating records is covered in [Create](./create.md), deletes in [Delete](./delete.md).

## Single Record

```ts
await db.user.update({
  where: { id: user.id },
  data: { name: "Alice Zhang" },
});
```

- `where` must match a unique key; a missing record raises `NOT_FOUND` and nothing is written.
- Soft-deleted records are skipped: the call raises `NOT_FOUND` and the deletion field stays read-only, see [Soft Delete](../schema/soft-delete.md).

## upsert

```ts
const user = await db.user.upsert({
  where: { email: "alice@example.com" },
  create: { email: "alice@example.com" },
  update: { name: { set: "Alice" } },
  select: { email: true, name: true },
});
```

| Strategy                           | When used                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single native statement            | Only scalar fields are written; the unique key value in `create` equals the one in `where`; the model has no soft delete and no foreign key check against a soft-deleted model. On MySQL it additionally requires that the inserted record can only conflict on the unique key named by `where`, and that `update` leaves that key unchanged |
| Read-then-write in one transaction | All other cases, including nested writes and soft-deleted models                                                                                                                                                                                                                                                                             |

The native statement is `ON CONFLICT DO UPDATE` on SQLite and PostgreSQL (conflict target limited to the unique constraint named by `where`, so other unique conflicts still error), and `ON DUPLICATE KEY UPDATE` on MySQL, which fires on any unique key conflict. An upsert never restores a soft-deleted record: the unique key is still occupied, so it fails like any other write to a deleted record.

::: warning Concurrent creates
The native statement is concurrency-safe by database guarantee. The read-then-write path may hit unique or transaction conflicts on the first concurrent create; the ORM does not retry automatically, and callers can retry the whole transaction.
:::

## Atomic Field Updates

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

| Operation                                      | Applicable fields                    |
| ---------------------------------------------- | ------------------------------------ |
| `set`                                          | All                                  |
| `increment`, `decrement`, `multiply`, `divide` | `int`, `bigint`, `number`, `decimal` |

- One operation per field, divisor nonzero; `int` operands must be safe integers, `bigint` accepts `bigint`, an integer string, or a safe integer, and integer division truncates toward zero.
- `decimal` operands may be a numeric string or a number; arithmetic runs in the database (SQLite does not guarantee exact decimal arithmetic).
- `NULL` involved in an operation yields `NULL`; an `int` result beyond the JavaScript safe-integer range raises `NUMERIC_OVERFLOW` and rolls back the whole operation.

## updateMany

```ts
const { count } = await db.post.updateMany({
  where: { published: false },
  data: { published: true },
});
```

- Scalar fields only; `where` is required and non-empty (`VALIDATION` otherwise), see [Write Safety](./overview.md#write-safety). `$clear` deletes records instead of updating fields.
- `count` is matched records, including ones whose assignment changed nothing; soft-deleted records are never matched.
- Normally one set-based `UPDATE`; per-row when soft-delete foreign key validation or MySQL arithmetic checking applies, and with `maxAffected` matched rows are counted first — a larger result raises `MASS_WRITE_BLOCKED`.

## updateManyAndReturn

```ts
const updated = await db.post.updateManyAndReturn({
  where: { published: false },
  data: { published: true, views: { increment: 1 } },
  include: { author: { select: { email: true } } },
  omit: { body: true },
});
```

- Supports `select`, `include`, `omit`, and virtual fields; `where` is required and non-empty, `{}` raises `VALIDATION`.
- Return order is not guaranteed (sort by a business key yourself); records are the actual write results, returned even when the update changed a filter field, and empty update data returns the matched records.

## Database Differences

| Capability            | SQLite      | PostgreSQL  | MySQL / MariaDB                                                                  |
| --------------------- | ----------- | ----------- | -------------------------------------------------------------------------------- |
| `updateManyAndReturn` | `RETURNING` | `RETURNING` | Select matching primary keys in a transaction, then update and read back per row |

## Next Steps

- [Create](./create.md): write new records, including bulk inserts
- [Delete](./delete.md): remove records instead of changing them
- [Write Safety](./overview.md#write-safety): the row limit applied to bulk updates
