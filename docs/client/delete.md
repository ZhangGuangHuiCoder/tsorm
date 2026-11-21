---
description: Delete single and multiple records, clear a table explicitly, soft delete lifecycle, and foreign key constraints.
---

# Delete

`delete` returns the removed record and accepts `select`, `include`, and `omit`. See [Create](./create.md) and [Update](./update.md) for the other operations.

## Single Record

```ts
const removed = await db.user.delete({
  where: { id: user.id },
  select: { id: true, email: true },
});
```

- `where` must match a unique key; a missing record raises `NOT_FOUND`. A record already hidden by soft delete counts as missing.

## deleteMany

```ts
const { count } = await db.post.deleteMany({
  where: { title: { startsWith: "draft" } },
});
```

- `where` is required and non-empty (`VALIDATION` otherwise); to empty a table use [`$clear`](#clear-a-table). `count` is the number of deleted records; soft-deleted records are never matched twice.

## Clear a Table

`$clear` explicitly deletes all records in a model. Check the target model and foreign key constraints first:

```ts
await db.$clear("account"); // soft delete: only the deletion time is written
await db.$clear("account", { force: true }); // physically remove every row, deleted ones included
```

- Returns `{ count }`, the number of affected rows; available on transaction clients as `tx.$clear`.
- Without `force`, `@@softDelete` models are soft deleted; others are deleted physically. `force` ignores visibility and also removes already soft-deleted rows.
- `maxAffected` does not apply — the call itself is the confirmation, so a cleared table is never blocked by the row limit.

Top-level bulk methods require a non-empty `where`, see [Write Safety](./overview.md#write-safety).

## Soft Delete

With `@@softDelete`, `delete` and `deleteMany` write the deletion time instead of removing rows. The records disappear from default queries, keep occupying their unique keys, and reject ordinary updates (`update` raises `NOT_FOUND`, `updateMany` matches nothing).

| Method                           | Behavior                                                               |
| -------------------------------- | ---------------------------------------------------------------------- |
| `delete`, `deleteMany`           | Write the deletion time, generated on the client                       |
| `restore`, `restoreMany`         | Clear the deletion time                                                |
| `forceDelete`, `forceDeleteMany` | Run a real `DELETE`, still subject to database foreign key constraints |

`restoreMany` and `forceDeleteMany` also require a non-empty `where`. On a model without `@@softDelete`, `restore`/`restoreMany` raise `VALIDATION`, while `forceDelete`/`forceDeleteMany` are plain deletes. Query visibility follows the `deleted` option; foreign keys pointing at deleted records raise `SOFT_DELETED_REFERENCE`. See [Soft Delete](../schema/soft-delete.md).

## Referential Actions

Physical deletes run in the database, so the declared foreign key actions decide what happens to dependent rows:

- `RESTRICT` (default) blocks the delete with a foreign key error, `SET NULL` clears the referencing column, and `CASCADE` deletes the dependent rows as well.

Soft-deleted rows are not removed, so their foreign keys still resolve and no action fires. Nested deletes through relations: [Relation Writes](./relation-writes.md). Full matrix: [Referential Actions](../schema/relations/referential-actions.md).

## Next Steps

- [Soft Delete](../schema/soft-delete.md): restore records and control visibility
- [Referential Actions](../schema/relations/referential-actions.md): what happens to dependent rows
- [Update](./update.md): change records instead of removing them
