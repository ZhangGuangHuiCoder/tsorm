---
description: Declare a one-to-many relation in schema.orm, with the owning field, inverse collection, and generated foreign key column.
---

# One-to-Many

A one-to-many relation has one parent row owning many child rows; each child points back at exactly one parent. The child side stores the link and is the owning side, the parent side exposes a collection.

## Definition

The owning field is required by default (`author: User`) and optional with `?` (`reviewer?: User`). An inverse collection uses `posts: Post[] @via(author)`.

The generator derives the foreign key column from the relation:

- The column name is the relation name followed by the target's primary key name, capitalized: `author: User` with `id: int @id` produces `authorId`. The column type and length are copied from the target's primary key: a target key of `code: string(2) @id` gives `country: Country` a `countryCode: string(2)` column.
- An optional relation generates a nullable column defaulting to `NULL`; a required relation generates a non-null column.
- A non-unique relation column is indexed automatically.

## Example

```ts
model User {
  id: int @id @auto
  email: string @unique
  posts: Post[] @via(author)
}

model Post {
  id: int @id @auto
  title: string
  author: User
  reviewer?: User
}
```

```ts
await db.post.findMany({ where: { authorId: 1 } });
await db.post.create({ data: { title: "Hello", authorId: 1 } });
```

`@@unique`, `@@index`, and `@@id` accept a relation name, which stands for its foreign key column:

```ts
model Post {
  id: int @id @auto
  author: User
  slug: string(64)

  @@unique(author, slug)
}
```

## Notes

- An owning foreign key cannot reference a composite primary key; see [Surrogate Keys Instead of Composite Keys](../attributes.md#surrogate-keys-instead-of-composite-keys).
- Reading a collection is covered in [Relation Filters](../../client/queries.md#relation-filters), writing it in [Relation Writes](../../client/relation-writes.md).

## Next Steps

- [One-to-One](./one-to-one.md): when each parent may have at most one child
- [Multiple Relations](./multiple-relations.md): when two models share more than one relation
