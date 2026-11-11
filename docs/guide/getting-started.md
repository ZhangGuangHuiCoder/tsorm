---
description: Install TSORM, define your first model, generate the client, and run a query.
---

# Getting Started

This tutorial uses SQLite and requires no database server. When you are done, you will have a client that can write and query data.

## Prerequisites

- Node.js 22.15 or later; all maintained LTS lines are supported
- The tutorial uses SQLite with no extra install; other databases require at least MySQL 8.0.16, MariaDB 10.6 or PostgreSQL 14

## Install

::: code-group

```bash [npm]
npm install @ofis/tsorm
```

```bash [pnpm]
pnpm add @ofis/tsorm
```

```bash [yarn]
yarn add @ofis/tsorm
```

```bash [bun]
bun add @ofis/tsorm
```

:::

The `mariadb` and `pg` clients are installed with the package; SQLite uses the built-in `node:sqlite`.

Installing also provides the `tsorm` command; see [CLI](../reference/cli/overview.md) for how to run it.

## Define Models

Create `schema.orm`:

```ts
model User {
  id: int @id @auto
  email: string @unique
  name?: string
  posts: Post[] @via(author)
}

model Post {
  id: int @id @auto
  title: string
  published: boolean = false
  createdAt: datetime = now()
  author: User
}
```

`Post.author` automatically generates the foreign key field `authorId`. `User.posts` points at the matching relation through `@via(author)`, so the foreign key does not need to be declared twice.

## Generate the Client

```bash
tsorm generate --schema schema.orm --out generated/client.ts
```

## Write and Query

Create `main.ts`:

```ts
import { createClient } from "./generated/client.ts";
import { sqlite } from "@ofis/tsorm/adapters/sqlite";

const db = await createClient({
  adapter: sqlite({ connection: "file:./app.sqlite", initialize: true }),
  timezone: "+08:00",
});

try {
  await db.user.create({
    data: {
      email: "alice@example.com",
      posts: { create: { title: "Hello ORM" } },
    },
  });

  const users = await db.user.findMany({
    where: { posts: { some: { published: false } } },
    include: { posts: { take: 3, orderBy: { id: "desc" } } },
  });
  console.log(users);
} finally {
  await db.$close();
}
```

Run it:

```bash
node main.ts
```

::: warning Before running again
`initialize: true` only applies to creating a new database. Remove the option when reconnecting to the same `app.sqlite`, or the adapter raises `DATABASE_NOT_EMPTY`. For real projects, manage schema changes with [versioned migrations](../databases/migrations.md) instead.
:::

## Next Steps

- [Schema](../schema/overview.md): field types, relations, and constraints
- [Queries](../client/queries.md), [Create](../client/create.md), [Update](../client/update.md), and [Delete](../client/delete.md): the core client operations
- [Full example](./examples.md): run the example project covering all three databases
