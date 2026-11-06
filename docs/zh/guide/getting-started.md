---
description: 安装 TSORM，定义第一个模型，生成客户端并执行查询。
---

# 快速开始

本教程使用 SQLite，无需启动数据库服务。完成后，你会得到一个可以写入和查询数据的客户端。

## 前提条件

- Node.js 24.10 及以上
- 任意包管理器，下文命令以 npm 为例

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

:::

MySQL 的 `mariadb` 与 PostgreSQL 的 `pg` 客户端随包安装，SQLite 使用 Node.js 内置的 `node:sqlite`。

安装后提供 `tsorm` 命令，用法见 [CLI](../reference/cli.md)。

## 定义模型

创建 `schema.orm`：

```ts
model User {
  id: int @id @auto
  email: string(191) @unique
  name?: string
  posts: Post[] @via(author)
}

model Post {
  id: int @id @auto
  title: string
  published: boolean = false
  createdAt: date = now()
  author: User
}
```

`Post.author` 会自动生成外键字段 `authorId`。`User.posts` 通过 `@via(author)` 指向对应的关系，不需要重复定义外键。

## 生成客户端

```bash
tsorm generate --schema schema.orm --out generated/client.ts
```

## 写入和查询

创建 `main.ts`：

```ts
import { createClient } from './generated/client.ts';
import { sqlite } from '@ofis/tsorm/adapters/sqlite';

const db = await createClient({
  adapter: sqlite({ filename: './app.sqlite', initialize: true }),
  timezone: '+08:00',
});

try {
  await db.user.create({
    data: {
      email: 'alice@example.com',
      posts: { create: { title: 'Hello ORM' } },
    },
  });

  const users = await db.user.findMany({
    where: { posts: { some: { published: false } } },
    include: { posts: { take: 3, orderBy: { id: 'desc' } } },
  });
  console.log(users);
} finally {
  await db.$close();
}
```

运行：

```bash
node main.ts
```

::: warning 再次运行前
`initialize: true` 只用于创建新数据库。再次连接同一个 `app.sqlite` 时要去掉该选项，否则建表语句会因表已存在而失败。正式项目请改用[版本化迁移](../databases/migrations.md)管理结构。
:::

## 下一步

- [模型定义](./schema.md)：字段类型、关系和约束
- [查询](../client/queries.md)与[写入](../client/writes.md)：客户端的核心操作
- [完整示例](./examples.md)：运行覆盖三种数据库的示例项目
