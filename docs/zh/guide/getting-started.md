---
description: 安装 TSORM，定义第一个模型，生成客户端并执行查询。
---

# 快速开始

本教程使用 SQLite，无需数据库服务，完成后即可得到能写入和查询数据的客户端。

## 前提条件

- Node.js 22.15 及以上（支持所有在维护的 LTS 版本）；本教程使用 SQLite 无需额外安装，其他数据库最低要求 MySQL 8.0.16、MariaDB 10.6、PostgreSQL 14

## 安装

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

MySQL 的 `mariadb` 与 PostgreSQL 的 `pg` 客户端随包安装，SQLite 使用内置的 `node:sqlite`。安装同时提供 `tsorm` 命令，用法见 [CLI](../reference/cli/overview.md)。

## 定义模型

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

`Post.author` 会自动生成外键字段 `authorId`；`User.posts` 通过 `@via(author)` 指向对应关系，外键无需重复声明。

## 生成客户端

```bash
tsorm generate --schema schema.orm --out generated/client.ts
```

## 创建表

```bash
DATABASE_URL=file:./app.sqlite tsorm push
```

`push` 适合原型阶段；正式项目用[版本化迁移](../databases/migrations.md)管理结构。

## 写入和查询

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

## 下一步

- [模型定义](../schema/overview.md)：字段类型、关系和约束；核心操作见[查询](../client/queries.md)、[新增](../client/create.md)、[更新](../client/update.md)、[删除](../client/delete.md)
- [完整示例](./examples.md)：运行覆盖三种数据库的示例项目
