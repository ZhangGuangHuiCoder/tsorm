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

- `where` must match a unique key.
- A missing record raises `NOT_FOUND` and nothing is written.
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

The ORM chooses an execution strategy based on the conditions:

| Strategy                           | When used                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single native statement            | Only scalar fields are written; the unique key value in `create` equals the one in `where`; the model has no soft delete and no foreign key check against a soft-deleted model. On MySQL it additionally requires that the inserted record can only conflict on the unique key named by `where` |
| Read-then-write in one transaction | All other cases, including nested writes and soft-deleted models                                                                                                                                                                                                                                |

The native statement is `ON CONFLICT DO UPDATE` on SQLite and PostgreSQL, where the conflict target only includes the unique constraint named by `where`, so other unique conflicts still error. On MySQL it is `ON DUPLICATE KEY UPDATE`, which fires on any unique key conflict, so it is used only when `create` has no other non-null unique key value besides the `where` key — for example `where: { email }` with an auto-increment primary key.

An upsert never restores a soft-deleted record: the unique key is still occupied, so the update path fails like any other write to a deleted record.

::: warning Concurrent creates
The native statement is concurrency-safe by database guarantee. The read-then-write path may hit unique constraint or transaction conflicts on the first concurrent create; the ORM does not retry automatically, and callers can retry the whole transaction.
:::

## Atomic Field Updates

Operations run directly in the `UPDATE` statement, with parameters bound independently:

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

- A field may specify only one operation at a time, and the divisor must be nonzero.
- Operands for an `int` field must be safe integers; a `bigint` field accepts `bigint` or a safe integer; integer division truncates toward zero.
- Operands for a `decimal` field may be a numeric string or a number, and arithmetic runs in the database, subject to its precision rules; SQLite does not guarantee exact decimal arithmetic.
- `NULL` involved in an operation yields `NULL`.
- When an `int` result exceeds the JavaScript safe-integer range, `NUMERIC_OVERFLOW` is raised and the whole operation rolls back.

## updateMany

```ts
const { count } = await db.post.updateMany({
  where: { published: false },
  data: { published: true },
});
```

- Accepts only scalar fields.
- `where` is required and must not be empty; `{}` raises `VALIDATION`. There is no implicit unfiltered bulk update; `$clear` deletes records rather than updating arbitrary fields.
- `count` is the number of matched records, including those whose assignment changed nothing.
- Soft-deleted records are not matched, so they are never updated.
- A single set-based `UPDATE` is used normally. When soft-delete foreign key validation or MySQL arithmetic result checking is involved, records are processed one by one to guarantee correctness.
- With `maxAffected`, the matched rows are counted first and a larger result raises `MASS_WRITE_BLOCKED`.

## updateManyAndReturn

```ts
const updated = await db.post.updateManyAndReturn({
  where: { published: false },
  data: { published: true, views: { increment: 1 } },
  include: { author: { select: { email: true } } },
  omit: { body: true },
});
```

- Supports `select`, `include`, `omit`, and virtual fields.
- `where` is required and must not be empty; `{}` raises `VALIDATION`.
- Return order is not guaranteed; sort by a business key yourself when needed.
- The returned records are the actual write results. A record is returned even if the update changed a filter field.
- Empty update data returns the matched records.

## Database Differences

| Capability            | SQLite      | PostgreSQL  | MySQL / MariaDB                                                                  |
| --------------------- | ----------- | ----------- | -------------------------------------------------------------------------------- |
| `updateManyAndReturn` | `RETURNING` | `RETURNING` | Select matching primary keys in a transaction, then update and read back per row |

The MySQL / MariaDB adapter does not use `RETURNING`; its primary-key readback strategy requires additional statements.

## Next Steps

- [Create](./create.md): write new records, including bulk inserts
- [Delete](./delete.md): remove records instead of changing them
- [Write Safety](./overview.md#write-safety): the row limit applied to bulk updates
