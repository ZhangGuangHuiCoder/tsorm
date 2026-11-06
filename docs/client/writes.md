---
description: Create, update, delete, and upsert records, atomic field updates, and bulk writes.
---

# Writes

## Single Writes

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

`create`, `update`, and `delete` all accept `select`, `include`, and `omit`, and return the record actually written; an `@auto` primary key cannot be assigned explicitly.

When the record does not exist, `update` and `delete` raise `NOT_FOUND`. Relation-oriented writes are covered in [Relation Writes](./relation-writes.md).

## Atomic Field Updates

Operations run directly in the `UPDATE` statement, with parameters bound independently:

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

| Operation                                      | Applicable fields |
| ---------------------------------------------- | ----------------- |
| `set`                                          | All               |
| `increment`, `decrement`, `multiply`, `divide` | `int`, `bigint`, `number`, `decimal` |

- A field may specify only one operation at a time, and the divisor cannot be zero.
- Operands for an `int` field must be safe integers; a `bigint` field accepts `bigint` or a safe integer; integer division truncates toward zero.
- Operands for a `decimal` field may be a numeric string or a number, and the arithmetic runs exactly in the database.
- `NULL` involved in an operation yields `NULL`.
- When the result exceeds the safe-integer range, `NUMERIC_OVERFLOW` is raised and the whole operation rolls back.

## upsert

```ts
const user = await db.user.upsert({
  where: { email: 'alice@example.com' },
  create: { email: 'alice@example.com' },
  update: { name: { set: 'Alice' } },
  select: { email: true, name: true },
});
```

The ORM chooses an execution strategy based on the conditions:

| Strategy | When used |
| -------- | --------- |
| Single native statement | Only scalar fields are written; the unique key value in `create` equals the one in `where`; the model has no soft delete and no foreign key check against a soft-deleted model. On MySQL it additionally requires that the inserted record can only conflict on the unique key named by `where` |
| Read-then-write in one transaction | All other cases, including nested writes and soft-deleted models |

The native statement is `ON CONFLICT DO UPDATE` on SQLite and PostgreSQL, where the conflict target only includes the unique constraint named by `where`, so other unique conflicts still error. On MySQL it is `ON DUPLICATE KEY UPDATE`, which fires on any unique key conflict, so it is used only when `create` has no other non-null unique key value besides the `where` key — for example `where: { email }` with an auto-increment primary key.

::: warning Concurrent creates
The native statement is concurrency-safe by database guarantee. The read-then-write path may hit unique constraint or transaction conflicts on the first concurrent create; the ORM does not retry automatically, and callers can retry the whole transaction.
:::

## Bulk Writes

### createMany

```ts
const { count } = await db.user.createMany({
  data: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
  skipDuplicates: true,
});
```

- Accepts only scalar fields; relations are passed through foreign keys. Nested relations and auto-generated IDs are not accepted.
- Defaults, `uuid()`, `now()`, typed JSON, and soft-delete foreign key checks behave the same as a single `create`.
- Uses a multi-row `INSERT`, split into batches under a 900-parameter budget. All batches share one transaction, and any error rolls back every batch.
- Empty input returns `{ count: 0 }`.
- `count` is the number of records actually inserted. With `skipDuplicates`, unique conflicts (including duplicates within the batch) are not counted, while other validation and foreign key errors still raise.

### updateMany and deleteMany

```ts
const updated = await db.post.updateMany({
  where: { published: false },
  data: { published: true },
});

const deleted = await db.post.deleteMany({
  where: { title: { startsWith: 'draft' } },
});
```

`updateMany` accepts only scalar fields. `count` is the number of matched records, including those whose assignment changed nothing.

A single set-based `UPDATE` is used normally. When soft-delete foreign key validation or MySQL arithmetic result checking is involved, records are processed one by one to guarantee correctness.

### Returning Written Records

Return the written records directly after a bulk write:

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

- Supports `select`, `include`, `omit`, and virtual fields.
- Return order is not guaranteed; sort by a business key yourself when needed.
- The returned records are the actual write results. A record is returned even if the update changed a filter field.
- Empty input returns an empty array; empty update data returns the matched records.

### Database Differences

| Capability            | SQLite                   | PostgreSQL               | MySQL / MariaDB                    |
| --------------------- | ------------------------ | ------------------------ | ---------------------------------- |
| Multi-row `INSERT`    | Supported                | Supported                | Supported                          |
| `skipDuplicates`      | `ON CONFLICT DO NOTHING` | `ON CONFLICT DO NOTHING` | Per-row, catching only unique conflicts |
| `createManyAndReturn` | `RETURNING`              | `RETURNING`              | Per-row insert in a transaction, read back by `insertId` |
| `updateManyAndReturn` | `RETURNING`              | `RETURNING`              | Select matching primary keys in a transaction, then update and read back per row |

MySQL has no `RETURNING`, so both returning methods need more statements on MySQL and are slower on large data; the behavior and returned results match the other databases. MySQL does not use `INSERT IGNORE`, to avoid swallowing invalid values, not-null, or foreign key errors.

Unique constraints on soft-deleted models include deleted records, so `skipDuplicates` never restores them. Foreign keys pointing at soft-deleted models must still pass referential validation before deduplication.
