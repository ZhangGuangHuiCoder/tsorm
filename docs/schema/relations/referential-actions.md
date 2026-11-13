---
description: Configure onDelete and onUpdate on @relation in schema.orm, and understand what each referential action does when a referenced row changes.
---

# Referential Actions

Referential actions decide what happens to referencing records when the referenced record is deleted, or when its primary key changes. They are declared on the owning side of a relation.

## Definition

`onDelete` and `onUpdate` are options of `@relation`. `onDelete` defaults to `Restrict`; omitted `onUpdate` generates `RESTRICT` on MySQL / PostgreSQL and uses SQLite's default `NO ACTION`.

| Action     | Behavior                                                                          |
| ---------- | --------------------------------------------------------------------------------- |
| `Restrict` | Rejects the operation while references exist                                      |
| `NoAction` | Rejects the operation while references exist, checked at the end of the statement |
| `Cascade`  | Deletes the referencing records, or updates their foreign keys                    |
| `SetNull`  | Sets the foreign key to `NULL`; for optional relations                            |

## Example

```ts
model Post {
  id: int @id @auto
  title: string
  author: User @relation(onDelete: Cascade)
  editor?: User @relation(onDelete: SetNull)
}
```

With this schema, deleting a user deletes the posts they authored and clears the `editor` reference on the posts they edited. Deleting a user who is still referenced as an editor is allowed, because `SetNull` needs a nullable column.

## Notes

- The database carries out referential actions, so they apply to raw SQL as well.
- Primary keys rarely change, so `onUpdate` can usually stay at its default.
- [Soft delete](../soft-delete.md) only sets a deletion time and triggers no referential action.
- Join table links are always deleted together with either side.
- The action applies to the relation as declared; a one-to-one relation uses the same four actions as a one-to-many relation.

## Next Steps

- [Foreign Key Fields](./foreign-keys.md): bind the column yourself
- [Soft Delete](../soft-delete.md): hide rows without deleting them
