---
description: Enable soft delete with @@softDelete, control record visibility, and restore or physically delete records.
---

# Soft Delete

Soft delete turns a delete into an update of the management field, and default queries no longer return those records.

## Enabling

```ts
model Account {
  id: int @id @auto
  email: string @unique
  deletedAt?: datetime

  @@softDelete(deletedAt)
}
```

`@@softDelete()` uses `deletedAt` and adds `deletedAt?: datetime` when absent. An explicitly selected field must already exist, be nullable `datetime` or `timestamp`, default to `null`, and not be a primary or unique key.

## Operations

Use `delete` to mark a record, `restore` to make it visible again, and `forceDelete` to remove it physically. Method results, bulk variants, and `$clear` are documented in [Delete](../client/delete.md#soft-delete).

## Query Visibility

The `deleted` option controls visibility for the current query's model:

```ts
await db.account.findMany({ deleted: "include" });
await db.account.findMany({ deleted: "only" });
```

| Value     | Behavior                          |
| --------- | --------------------------------- |
| `exclude` | Omit deleted records, the default |
| `include` | Also return deleted records       |
| `only`    | Return only deleted records       |

The default exclude rule applies to lists, unique queries, `count`, aggregations, grouping, eager loading, relation filters, and relation counts.

`deleted` only affects the current model. Relation filter targets always exclude deleted records; eager loading can be configured separately:

```ts
await db.account.findMany({
  include: { entries: { deleted: "include" } },
});
```

## Write Rules

- The management field is maintained by the ORM and cannot be assigned through `update` or `updateMany`, and new records cannot carry a deletion time.
- Ordinary updates do not touch deleted records, and `upsert` does not restore them.
- `restore` must satisfy unique constraints. On conflict, the whole transaction rolls back.

## Unique Constraints

Unique constraints still include deleted records, so a deleted record keeps occupying its unique key.

## Relations

- Soft delete does not cascade; the physical foreign key still exists.
- Foreign key writes and `connect` cannot point at a deleted target, otherwise `SOFT_DELETED_REFERENCE` is raised.
- Eager loading hides deleted targets by default: a required relation that is therefore missing raises `SOFT_DELETED_RELATION`, and an optional relation returns `null`.
- A nested soft delete keeps the link so the record can be restored; explicit `disconnect` and `set` still modify links.

::: warning Deleted records stay readable
Any caller can read deleted records via `deleted: 'include'` or raw SQL, and raw SQL does not apply the soft-delete policy.
:::

## Next Steps

- [Delete](../client/delete.md): the delete operations and `$clear`
- [Referential Actions](./relations/referential-actions.md): how deleted rows affect dependent records
