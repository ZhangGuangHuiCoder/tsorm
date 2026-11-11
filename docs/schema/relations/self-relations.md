---
description: Relate a model to itself in schema.orm, with a parent and children collection for trees and a many-to-many form for follower graphs.
---

# Self-Relations

A relation can target its own model. Trees use a parent pointer with an inverse collection of children; social graphs use a many-to-many relation on the same model.

## Definition

Use a single optional parent field with an inverse collection for a tree, or an owning array with an inverse array for a directed many-to-many graph. In either case, the relation target is the current model.

## Example

A category tree:

```ts
model Category {
  id: int @id @auto
  name: string(64)
  parent?: Category @relation(onDelete: SetNull)
  children: Category[] @via(parent)
}
```

`onDelete: SetNull` promotes children to root level when their parent is deleted. It does not detect cycles; enforce an acyclic tree in application code when needed.

A follower graph, where both sides live on the same model:

```ts
model User {
  id: int @id @auto
  email: string @unique
  following: User[]
  followers: User[] @via(following)
}
```

## Notes

- To represent roots without a parent, the tree's parent field must be optional.
- Both arrays in a self-referencing many-to-many are required. The join table is named after the owning array, so `User.following` produces `_User_following`.
- A self-relation still needs a single-field primary key on the model.
- Reading a tree is an ordinary relation filter; see [Relation Filters](../../client/queries.md#relation-filters).

## Next Steps

- [Multiple Relations](./multiple-relations.md): two different models sharing several relations
- [Referential Actions](./referential-actions.md): what happens when a row is deleted
