---
description: How relations are declared in schema.orm, the owning side versus the inverse field, and the relation shapes you can pick.
---

# Relations

A relation field references another model, or uses `morph` to reference multiple owner models. Every relation has an **owning side**: for one-to-many and one-to-one it holds the foreign key column, and for many-to-many it declares the join table. The other side can declare an **inverse field** with `@via` to navigate back. Inverse fields add no columns.

## Relation Shapes

| Relation     | Owning side                        | Inverse field                           | Database structure                |
| ------------ | ---------------------------------- | --------------------------------------- | --------------------------------- |
| One-to-many  | `author: User`                     | `posts: Post[] @via(author)`            | `Post.authorId`                   |
| One-to-one   | `user: User @unique`               | `profile?: Profile @via(user)`          | Unique `Profile.userId`           |
| Many-to-many | `tags: Tag[]`                      | `posts: Post[] @via(tags)`              | Join table `_Post_tags`           |
| Polymorphic  | `owner: morph(ownerType, ownerId)` | `attachments: Attachment[] @via(owner)` | `ownerType` and `ownerId` columns |

Pick the page that matches the shape you are declaring:

- [One-to-Many](./one-to-many.md): one parent owns many children.
- [One-to-One](./one-to-one.md): each side can be linked to at most one row on the other side.
- [Many-to-Many](./many-to-many.md): both sides own a collection of the other.
- [Polymorphic Relations](./polymorphic.md): reference multiple owner models using a discriminator and owner key.
- [Self-Relations](./self-relations.md): a model relates to itself.
- [Multiple Relations](./multiple-relations.md): two models share more than one relation.

Two further pages cover the foreign key itself: [Foreign Key Fields](./foreign-keys.md) for declaring the column yourself, and [Referential Actions](./referential-actions.md) for what happens when a referenced row is deleted.

## Owning Side and Inverse Field

The owning side is the field that stores the link. It is a required relation field when the link must exist:

```ts
model Post {
  id: int @id @auto
  author: User
}
```

The inverse side is the field you navigate from. It carries `@via` pointing at the owning field on the other model, and it never creates a column:

```ts
model User {
  id: int @id @auto
  posts: Post[] @via(author)
}
```

- An inverse field is always optional when it is a single field (`profile?: Profile @via(user)`), because the owning side may not exist yet.
- An inverse field that is an array is always required (`posts: Post[] @via(author)`), because the collection always exists, possibly empty.
- The owning side may also be optional (`reviewer?: User`), which makes the foreign key column nullable.

## One-Way Relations

Declare inverse fields only where you need them. If you only navigate from a post to its author, `User` can leave out `posts`:

```ts
model User {
  id: int @id @auto
}

model Post {
  id: int @id @auto
  author: User
}
```

The database structure is identical to the two-way version, and adding the inverse later produces no migration.

## Quick Reference

| Field                               | Allowed syntax                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| Single relation field (owning side) | `?`, `@unique`, `@relation(field, onDelete, onUpdate)`                               |
| Array field (many-to-many owner)    | No attributes                                                                        |
| Inverse field                       | Only `@via(owningField)`; a single inverse is optional, an array inverse is required |

The target of an owning foreign key must have a single-field primary key; many-to-many requires one on both models. An inverse collection may target a child model with a composite primary key. For models with a natural composite key, see [Surrogate Keys Instead of Composite Keys](../attributes.md#surrogate-keys-instead-of-composite-keys).

## Reading and Writing

Declarations in `schema.orm` define database structure, client types, and relation metadata; inverse fields do not create physical columns. To read a relation, include it in a query; to write it, nest the operation inside a create or update:

- [Relation Filters](../../client/queries.md#relation-filters) and `include` for reading
- [Relation Writes](../../client/relation-writes.md) for nested create, connect, and disconnect

## Next Steps

- [Model Attributes](../attributes.md): composite keys, indexes, name mapping, and soft delete
