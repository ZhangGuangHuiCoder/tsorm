---
description: Install TSORM, define your first model, generate the client, and run a query.
---

# Getting Started

This tutorial uses SQLite — no database server needed — and ends with a client that writes and queries data.

## Prerequisites

- Node.js 22.15 or later (all maintained LTS lines); this tutorial uses SQLite with no extra install — other databases require MySQL 8.0.16, MariaDB 10.6, or PostgreSQL 14

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

The `mariadb` and `pg` clients ship with the package; SQLite uses the built-in `node:sqlite`. Installing also provides the `tsorm` command — see [CLI](../reference/cli/overview.md).

## Define Models

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

`Post.author` auto-generates the foreign key `authorId`; `User.posts` points back via `@via(author)`, so the foreign key is not declared twice.

## Generate the Client

```bash
tsorm generate --schema schema.orm --out generated/client.ts
```

## Create the Tables

```bash
DATABASE_URL=file:./app.sqlite tsorm push
```

`push` is for prototyping; real projects manage schema changes with [versioned migrations](../databases/migrations.md).

## Write and Query

```ts
import { createClient } from "./generated/client.ts";

const db = createClient({
  connection: "file:./app.sqlite",
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

```bash
node main.ts
```

## Next Steps

- [Schema](../schema/overview.md): field types, relations, and constraints; core operations in [Queries](../client/queries.md), [Create](../client/create.md), [Update](../client/update.md), [Delete](../client/delete.md)
- [Full example](./examples.md): run the example project covering all three databases
