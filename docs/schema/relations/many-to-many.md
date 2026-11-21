---
description: Declare a many-to-many relation in schema.orm with an implicit join table, and know when to use an ordinary model instead.
---

# Many-to-Many

A many-to-many relation links many rows on one side to many rows on the other, such as posts carrying tags. Neither side can hold the link in a single column, so the ORM stores it in a separate join table.

## Definition

The owning side declares `tags: Tag[]` without `@via`; the inverse uses `posts: Post[] @via(tags)`.

The join table is derived from the declaration:

- The table name is `_Model_field`, so `Post.tags` produces `_Post_tags`. It has two columns, `sourceId` pointing at the owning model and `targetId` at the other one; in `_Post_tags` they point at `Post` and `Tag`.
- Both columns form the primary key, so the same pair cannot be linked twice.

## Example

```ts
model Post {
  id: int @id @auto
  title: string
  tags: Tag[]
}

model Tag {
  id: int @id @auto
  name: string @unique
  posts: Post[] @via(tags)
}
```

Both sides support collection queries and nested relation operations, but not nested `createMany`; see [Relation Writes](../../client/relation-writes.md):

```ts
await db.post.findMany({
  where: { tags: { some: { name: "typescript" } } },
  include: { tags: true },
});

await db.post.create({
  data: { title: "Hello", tags: { connect: [{ id: 1 }] } },
});
```

## Notes

- The owning array field takes no attributes: `@via`, `@unique`, and `@relation` are not allowed on it.
- When the link itself carries data such as a role or a join date, connect the two sides through an ordinary model instead; see [Associations with Extra Fields](../attributes.md#associations-with-extra-fields).
- Both models must have a single-field primary key, because the join table stores both keys as plain columns.

## Next Steps

- [Associations with Extra Fields](../attributes.md#associations-with-extra-fields): a join model that carries its own data
- [Referential Actions](./referential-actions.md): what happens when a linked row is deleted
