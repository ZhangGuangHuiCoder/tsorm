---
description: Delete single and multiple records, clear a table explicitly, soft delete lifecycle, and foreign key constraints.
---

# Delete

`delete` returns the record as it was removed and accepts `select`, `include`, and `omit`. Creating records is covered in [Create](./create.md), updates in [Update](./update.md).

## Single Record

```ts
const removed = await db.user.delete({
  where: { id: user.id },
  select: { id: true, email: true },
});
```

- `where` must match a unique key.
- A missing record raises `NOT_FOUND`; a record already hidden by soft delete counts as missing.

## deleteMany

```ts
const { count } = await db.post.deleteMany({
  where: { title: { startsWith: "draft" } },
});
```

- `where` is required and must not be empty; `{}` raises `VALIDATION`. To empty a table use [`$clear`](#clear-a-table).
- `count` is the number of deleted records.
- Soft-deleted records are not matched, so they are never deleted twice.

## Clear a Table

`$clear` explicitly deletes all records in a model. Check the target model and foreign key constraints before calling it:

```ts
await db.$clear("account"); // soft delete: only the deletion time is written
await db.$clear("account", { force: true }); // physically remove every row, deleted ones included
```

- Returns `{ count }`, the number of affected rows.
- Without `force`, models with `@@softDelete` are soft deleted; unaffected models are deleted physically.
- `force` ignores visibility, so it also removes rows that are already soft deleted.
- Available on transaction clients as `tx.$clear`.
- `maxAffected` does not apply: the call itself is the confirmation, so a cleared table is never blocked by the row limit.

Top-level bulk methods stay strict: `deleteMany`, `forceDeleteMany`, `restoreMany`, `updateMany`, and `updateManyAndReturn` all reject a missing or empty `where` with `VALIDATION`.

## Soft Delete

With `@@softDelete`, `delete` and `deleteMany` write the deletion time instead of removing rows. The records disappear from default queries, keep occupying their unique keys, and reject ordinary updates — `update` raises `NOT_FOUND` and `updateMany` matches nothing.

| Method                           | Behavior                                                               |
| -------------------------------- | ---------------------------------------------------------------------- |
| `delete`, `deleteMany`           | Write the deletion time, generated in the client timezone              |
| `restore`, `restoreMany`         | Clear the deletion time                                                |
| `forceDelete`, `forceDeleteMany` | Run a real `DELETE`, still subject to database foreign key constraints |

`restoreMany` and `forceDeleteMany` also require a non-empty `where`, just like `deleteMany`. `restore` and `restoreMany` raise `VALIDATION` on a model without `@@softDelete`, while `forceDelete` and `forceDeleteMany` are plain deletes there. Visibility is controlled by the `deleted` option in queries, and foreign keys pointing at deleted records raise `SOFT_DELETED_REFERENCE`; details are in [Soft Delete](../schema/soft-delete.md).

## Referential Actions

Physical deletes are carried out by the database, so the declared foreign key actions decide what happens to dependent rows:

- `RESTRICT` (default) blocks the delete with a foreign key error.
- `SET NULL` clears the referencing column.
- `CASCADE` deletes the dependent rows as well.

Soft-deleted rows are not removed, so their foreign keys still resolve and no action fires. Nested deletes through relations are described in [Relation Writes](./relation-writes.md), and the full matrix is in [Referential Actions](../schema/relations/referential-actions.md).

## Next Steps

- [Soft Delete](../schema/soft-delete.md): restore records and control visibility
- [Referential Actions](../schema/relations/referential-actions.md): what happens to dependent rows
- [Update](./update.md): change records instead of removing them
