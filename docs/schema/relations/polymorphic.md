---
description: Point one relation at several models with morph, covering schema syntax, nested writes, filters, and the limits of the polymorphic shape.
---

# Polymorphic Relations

A polymorphic relation references multiple owner models through a discriminator column and an owner key column. For example, an attachment can belong to either a post or a user. The database stores both columns without a foreign key constraint.

## Declaring a Morph

```ts
model Post {
  id: int @id @auto
  title: string(200)
  attachments: Attachment[] @via(owner)
}

model User {
  id: int @id @auto
  attachments: Attachment[] @via(owner)
}

model Attachment {
  id: int @id @auto
  name: string
  ownerType: "Post" | "User"
  ownerId: int
  owner: morph(ownerType, ownerId)
}
```

- `owner: morph(ownerType, ownerId)` binds two existing scalar fields: the discriminator (a non-null `string`, typically a literal union) and the owner key (non-null, with the same type as the owners' primary key).
- Every owner declares the inverse as a required array with `@via(owner)`, the same form as an ordinary back relation. The inverse's discriminator value is the owner's model name, so `Post.attachments` only ever returns rows whose `ownerType` is `"Post"`.
- The short form `owner: morph` generates both columns: `ownerType` as `string(191)` and `ownerId` in the owners' key type. The generated names are the morph field's name plus `Type` and `Id`.
- All owners must share one single-field primary key type.
- A literal-union discriminator must exactly cover the owner models: every owner appears in the union, and every union member has an inverse. This keeps the possible owners visible right in the schema.

The morph field itself takes no attributes and no default, and cannot be optional or an array. The discriminator cannot be a key. Owner models need a single-field primary key, and a morph cannot share either column with another morph or relation.

## Writing

The inverse side accepts nested `create`, `createMany`, `update`, `upsert`, `updateMany`, `delete`, and `deleteMany`, exactly like a to-many relation. The discriminator and owner key are filled in automatically and cannot be overridden:

```ts
await db.post.create({
  data: {
    title: "Hello",
    attachments: { create: { name: "a.png" } },
  },
});

await db.post.update({
  where: { id: 1 },
  data: {
    attachments: {
      createMany: { data: [{ name: "b.png" }] },
      updateMany: { where: { name: "a.png" }, data: { name: "renamed.png" } },
      deleteMany: { name: "c.png" },
    },
  },
});
```

Created directly, both columns are yours to set:

```ts
await db.attachment.create({
  data: { name: "a.png", ownerType: "Post", ownerId: 1 },
});
```

Operations that move ownership — `connect`, `connectOrCreate`, `disconnect`, and `set` — are rejected with `POLYMORPHIC_OPERATION`. Reattaching a record to another owner has no single obvious rule, so write the two columns explicitly instead.

## Reading

`include`, `_count`, relation filters (`some`, `none`, `every`), and ordering by `_count` work like an ordinary to-many relation, with the discriminator always part of the generated SQL:

```ts
await db.post.findMany({
  where: { attachments: { some: { name: { endsWith: ".png" } } } },
  include: { attachments: true, _count: { select: { attachments: true } } },
  orderBy: { attachments: { _count: "desc" } },
});
```

A row belongs to exactly one owner at a time. Even when two owners share the same key value — a post and a user both with `id: 7` — each only sees rows carrying its own discriminator value.

The forward side is not queryable: `include: { owner: true }` raises `POLYMORPHIC_INCLUDE`, and filtering or ordering by `owner` raises `VALIDATION`. Resolve the owner in application code:

```ts
const attachment = await db.attachment.findUniqueOrThrow({ where: { id: 1 } });
const owner = attachment.ownerType === "Post" ? await db.post.findUnique({ where: { id: attachment.ownerId } }) : await db.user.findUnique({ where: { id: attachment.ownerId } });
```

## Database Representation

- The two columns are plain columns with no foreign key constraint. Referential actions do not apply: deleting an owner leaves its rows behind, and `ownerId` may point at nothing.
- A composite unique constraint can restrict `(ownerType, ownerId)`, but cannot verify that the referenced owner exists.
- The id column of a morph relation is indexed automatically, like any other relation column. Index the discriminator together with it for owner lookups with `@@index(ownerType, ownerId)`.
- Migrations treat both columns as ordinary columns. With a literal-union discriminator, adding an owner widens that union and changes its CHECK constraint. A plain string discriminator, including the shorthand form, does not require that constraint change.

::: warning Referential Integrity
The database cannot verify that `ownerId` exists in the table named by `ownerType`, and cannot cascade deletes. When rows must never outlive their owner, delete them in the same transaction as the owner, or prefer an ordinary relation.
:::

## Quick Reference

| Side                    | Capabilities                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Inverse (owner models)  | `include`, `_count`, filters, `orderBy _count`, nested writes except ownership transfers |
| Forward (`owner` field) | Writes through the two columns only; no `include`, filters, or ordering                  |

## Next Steps

- [Relation Overview](./overview.md): how every relation shape is declared
- [Relation Writes](../../client/relation-writes.md): the nested operations a morph relation accepts
- [Transactions](../../client/transactions.md): deleting a record together with its attachments
