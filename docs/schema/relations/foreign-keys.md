---
description: "Bind an explicit foreign key field to a relation with @relation(field: ...) to control the column name, type, and nullability."
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

- The bound field's type, length, decimal precision/scale, and date storage (`datetime` or `timestamp`) match the target's primary key, and its nullability matches the relation: an optional relation takes a nullable field.
- It is an ordinary scalar field, so it can carry `@map` or `@unique` but not `@id`, `@auto`, or an enum; each foreign key field belongs to exactly one relation.
- When the model already has a field with the generated name, such as `authorId` above, bind it with `field`; leaving it unbound causes a generated-field collision error.

## Example

For one-to-one, make the bound column unique with `@unique` on the scalar or relation field; using both is also valid:

```ts
model Profile {
  id: int @id @auto
  userId: int @unique @map("user_id")
  user: User @unique @relation(field: userId)
}
```

## Notes

- Binding an explicit field does not change the relation shape; whether it is one-to-one still depends on `@unique`. A non-unique relation column is indexed automatically, and the field appears in the client next to the relation.
- Referential actions are configured on the relation, not on the bound field; see [Referential Actions](./referential-actions.md).
- A mismatched bound field or a field bound to multiple relations raises a schema validation error.

## Next Steps

- [Referential Actions](./referential-actions.md): configure `onDelete` and `onUpdate`
- [Name Mapping](../attributes.md#name-mapping): rename columns with `@map`
