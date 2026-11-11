---
description: Bind an explicit foreign key field to a relation with @relation(field), so the column name, type, and nullability stay under your control.
---

# Foreign Key Fields

By default the generator names and types the foreign key column for you. When you need a different column name, or the table already carries that column, declare the field yourself and bind it with `@relation(field: ...)`.

## Definition

```ts
model Post {
  id: int @id @auto
  authorId: int @map("author_id")
  author: User @relation(field: authorId)
}
```

The rules for the bound field:

- Its type, length, decimal precision/scale, and date storage (`datetime` or `timestamp`) match the target's primary key, and its nullability matches the relation: an optional relation takes a nullable field.
- It is an ordinary scalar field, so it can carry `@map` or `@unique`; it cannot be `@id`, `@auto`, or an enum.
- Each foreign key field belongs to exactly one relation.
- When the model already has a field with the generated name, such as `authorId` above, bind it with `field` instead of letting the generator create a second column.

## Example

The first example maps client `authorId` to database `author_id`. For one-to-one, make the bound column unique with `@unique` on the scalar or relation field; using both is also valid:

```ts
model Profile {
  id: int @id @auto
  userId: int @unique @map("user_id")
  user: User @unique @relation(field: userId)
}
```

## Notes

- The foreign key still behaves like any other relation column: it is indexed automatically when it is not unique, and it appears in the client next to the relation.
- Binding an explicit field does not change the relation shape. Whether it is one-to-one still depends on `@unique`.
- Referential actions are configured on the relation, not on the bound field; see [Referential Actions](./referential-actions.md).
- A mismatched bound field or a field bound to multiple relations raises a schema validation error.

## Next Steps

- [Referential Actions](./referential-actions.md): configure `onDelete` and `onUpdate`
- [Name Mapping](../attributes.md#name-mapping): rename columns with `@map`
