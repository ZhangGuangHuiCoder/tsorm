---
description: Declare more than one relation between the same two models in schema.orm, each owning field generating its own foreign key.
---

# Multiple Relations

Two models can share several relations — a post has an author and a reviewer, a user has a billing and a shipping address. Each relation is declared separately, and each owning field generates its own foreign key column.

## Definition

Every relation is a separate owning field. Each inverse names its counterpart with `@via`: `authored` refers to `author`, `reviewed` to `reviewer`.

## Example

```ts
model User {
  id: int @id @auto
  email: string @unique
  authored: Post[] @via(author)
  reviewed: Post[] @via(reviewer)
}

model Post {
  id: int @id @auto
  title: string
  author: User
  reviewer?: User
}
```

```ts
await db.post.findMany({
  where: { authorId: 1, reviewerId: 2 },
  include: { author: true, reviewer: true },
});
```

## Notes

- Inverse fields must use distinct names, and each `@via` must point at an owning field that exists.
- The same rules apply when both models point at each other, and to self-relations; see [Self-Relations](./self-relations.md).

## Next Steps

- [One-to-Many](./one-to-many.md): the basic relation shape
- [Foreign Key Fields](./foreign-keys.md): control the column names yourself
