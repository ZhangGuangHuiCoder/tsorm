---
description: Nested writes of related records inside create and update, with the rules and execution order for each operation.
---

# Relation Writes

Nested writes share one transaction with the parent write and the result projection; any failing step rolls back everything. Recursion is at most 8 levels deep.

## Writing Inside create

`create` inputs support `create`, `connect`, and `connectOrCreate`; to-many direct foreign key relations also support `createMany`.

```ts
await db.user.create({
  data: {
    email: "alice@example.com",
    posts: { create: [{ title: "First" }, { title: "Second" }] },
    profile: { create: { bio: "Hello" } },
  },
});

await db.post.create({
  data: {
    title: "Hello",
    author: { connect: { email: "alice@example.com" } },
  },
});

await db.post.create({
  data: {
    title: "Hello",
    author: { connectOrCreate: { where: { email: "a@x.com" }, create: { email: "a@x.com" } } },
    tags: { connectOrCreate: [{ where: { name: "ts" }, create: { name: "ts" } }] },
  },
});

await db.user.create({
  data: { email: "b@x.com", posts: { createMany: { data: [{ title: "One" }, { title: "Two" }] } } },
});
```

A required relation can be assigned either through the foreign key field (such as `authorId`) or the relation field (such as `author`), but not both. `connectOrCreate` creates the record when the one named by `where` is not found; under concurrency a unique conflict is still possible.

## Writing Inside update

```ts
await db.user.update({
  where: { id: 1 },
  data: {
    name: "Alice",
    profile: { update: { bio: "New bio" } },
    posts: {
      update: { where: { id: 10 }, data: { title: "Updated" } },
    },
  },
  include: { profile: true, posts: true },
});

await db.post.update({
  where: { id: 10 },
  data: { tags: { set: [{ name: "TypeScript" }] } },
});
```

### Supported Operations

| Operation         | To-one relation                  | To-many relation                                               |
| ----------------- | -------------------------------- | -------------------------------------------------------------- |
| `create`          | Create data for the target model | Create data or an array                                        |
| `connect`         | Unique condition                 | Unique condition or array                                      |
| `connectOrCreate` | `{ where, create }`              | `{ where, create }` or array                                   |
| `update`          | Update data for the target model | `{ where, data }` or array                                     |
| `upsert`          | `{ create, update }`             | `{ where, create, update }` or array                           |
| `delete`          | `true`                           | Unique condition or array                                      |
| `disconnect`      | `true`, optional relations only  | Unique condition or array, for detachable relations only       |
| `set`             | —                                | Array of unique conditions                                     |
| `updateMany`      | —                                | `{ where?, data }` or array                                    |
| `deleteMany`      | —                                | Filter condition or array                                      |
| `createMany`      | —                                | `{ data, skipDuplicates? }`, direct foreign key relations only |

A to-one relation may specify only one operation at a time. A to-many relation can combine multiple operations, and a single request can update multiple relation fields.

```ts
await db.user.update({
  where: { id: 1 },
  data: {
    profile: { upsert: { create: { bio: "New" }, update: { bio: "Existing" } } },
    posts: {
      createMany: { data: [{ title: "Batch" }] },
      updateMany: { where: { published: true }, data: { views: { increment: 1 } } },
      deleteMany: { title: { startsWith: "obsolete" } },
    },
  },
});

await db.post.update({
  where: { id: 1 },
  data: { tags: { connectOrCreate: { where: { name: "TS" }, create: { name: "TS" } } } },
});
```

### Execution Order

Operations on the same to-many relation run in this order, and each operation re-reads the current set of links:

`set` → `disconnect` → `delete` → `deleteMany` → `connect` → `connectOrCreate` → `create` → `createMany` → `update` → `updateMany` → `upsert`

Array items in nested `upsert` also run sequentially, using the relation state left by earlier items. Internal membership and key queries are unaffected by global `omit`.

## Rules

### Scope

- The targets of `update`, `delete`, and `disconnect` must already belong to the current relation, otherwise `RELATION_NOT_CONNECTED` is raised.
- Nested `updateMany` and `deleteMany` are scoped to the parent relation. Unlike top-level bulk writes, nested `updateMany` may omit `where`, and nested `deleteMany` accepts `{}` to select that relation's visible records.
- A nested `create` cannot overwrite the parent record's foreign key.
- A back `connect` cannot move over an object that belongs to another parent record.
- Polymorphic relations accept every nested operation except `connect`, `connectOrCreate`, `disconnect`, and `set`, which raise `POLYMORPHIC_OPERATION`; see [Polymorphic Relations](../schema/relations/polymorphic.md).

### Disconnect and Delete

- `disconnect` only breaks the link; `delete` removes the target record. In a many-to-many relation, `delete` also removes the target's other links.
- A required foreign key cannot be set to `null`, and a required to-one relation cannot be deleted.
- `set` disconnects removed links first, so it likewise cannot leave a required foreign key null.

### Bulk Operations

- Nested `updateMany` accepts only scalar updates.
- `createMany` works on direct foreign key relations, with scalar fields only.

::: warning Concurrent unique conflicts
`connectOrCreate` and nested `upsert` may fall back to read-then-write inside a transaction, so a concurrent unique conflict is still possible.
:::

## Next Steps

- [Queries](./queries.md): relation filters and eager loading
- [Polymorphic Relations](../schema/relations/polymorphic.md): the operations a morph relation rejects
- [Soft Delete](../schema/soft-delete.md): how nested writes treat deleted records
