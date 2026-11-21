---
description: How relations are declared in schema.orm, the owning side versus the inverse field, and the relation shapes.
---

# Relations

A relation field references another model, or uses `morph` to reference multiple owner models. Every relation has an **owning side**: for one-to-many and one-to-one it holds the foreign key column, for many-to-many it declares the join table. The other side may declare an **inverse field** with `@via` to navigate back; inverse fields add no columns.

## Relation Shapes

| Relation     | Owning side                        | Inverse field                           | Database structure                |
| ------------ | ---------------------------------- | --------------------------------------- | --------------------------------- |
| One-to-many  | `author: User`                     | `posts: Post[] @via(author)`            | `Post.authorId`                   |
| One-to-one   | `user: User @unique`               | `profile?: Profile @via(user)`          | Unique `Profile.userId`           |
| Many-to-many | `tags: Tag[]`                      | `posts: Post[] @via(tags)`              | Join table `_Post_tags`           |
| Polymorphic  | `owner: morph(ownerType, ownerId)` | `attachments: Attachment[] @via(owner)` | `ownerType` and `ownerId` columns |

- [One-to-Many](./one-to-many.md): one parent owns many children.
- [One-to-One](./one-to-one.md): each side can be linked to at most one row on the other side.
- [Many-to-Many](./many-to-many.md): both sides own a collection of the other.
- [Polymorphic Relations](./polymorphic.md): reference multiple owner models with a discriminator and owner key.
- [Self-Relations](./self-relations.md): a model relates to itself.
- [Multiple Relations](./multiple-relations.md): two models share more than one relation.

Also: [Foreign Key Fields](./foreign-keys.md) for declaring the column yourself, and [Referential Actions](./referential-actions.md) for what happens when a referenced row is deleted.

## Owning Side and Inverse Field

The owning side stores the link. It is a required relation field when the link must exist:

```ts
model Post {
  id: int @id @auto
  author: User
}
```

```ts
model User {
  id: int @id @auto
  posts: Post[] @via(author)
}
```

- A single inverse field is always optional (`profile?: Profile @via(user)`) because the owning side may not exist yet; an array inverse field is always required (`posts: Post[] @via(author)`) because the collection always exists, possibly empty.
- The owning side may also be optional (`reviewer?: User`), which makes the foreign key column nullable.

## One-Way Relations

```ts
model User {
  id: int @id @auto
}

model Post {
  id: int @id @auto
  author: User
}
```

Declare inverse fields only where you need them; the database structure is identical to the two-way version, and adding the inverse later produces no migration.

## Quick Reference

| Field                               | Allowed syntax                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| Single relation field (owning side) | `?`, `@unique`, `@relation(field: ..., onDelete: ..., onUpdate: ...)`                |
| Array field (many-to-many owner)    | No attributes                                                                        |
| Inverse field                       | Only `@via(owningField)`; a single inverse is optional, an array inverse is required |

The target of an owning foreign key must have a single-field primary key; many-to-many requires one on both models. An inverse collection may target a child model with a composite primary key; see [Surrogate Keys Instead of Composite Keys](../attributes.md#surrogate-keys-instead-of-composite-keys).

## Reading and Writing

- [Relation Filters](../../client/queries.md#relation-filters) and `include` for reading
- [Relation Writes](../../client/relation-writes.md) for nested create, connect, and disconnect

## Next Steps

- [Model Attributes](../attributes.md): composite keys, indexes, name mapping, and soft delete
