<div align="center">

<img src="docs/public/logo.svg" alt="TSORM logo" width="120" />

# TSORM

**A type-safe TypeScript ORM with one API for SQLite, MySQL/MariaDB and PostgreSQL.**

[![npm version](https://img.shields.io/npm/v/@ofis/tsorm.svg)](https://www.npmjs.com/package/@ofis/tsorm)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2022.15-brightgreen.svg)](https://nodejs.org)

</div>

## Features

- **Inferred types** — `select`, `include` and relation writes are typed end to end
- **Multi-database** — SQLite via built-in `node:sqlite`; bundled `mariadb` and `pg` drivers
- **Versioned migrations** — `tsorm` CLI for schema diff, migrate, deploy and push
- **VS Code extension** — highlighting, diagnostics, formatting and completion for `.orm` files

## Documentation

- [Documentation site](https://zhangguanghuicoder.github.io/tsorm/) · [中文文档站](https://zhangguanghuicoder.github.io/tsorm/zh/)
- [Documentation Map](docs/guide/documentation.md) · [中文文档导航](docs/zh/guide/documentation.md)

## Install

```bash
npm install @ofis/tsorm
```

Requires Node.js 22.15+ (any maintained LTS line).

## Usage

`schema.orm`:

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
}
```

```bash
tsorm generate --schema schema.orm --out generated/client.ts
```

```ts
import { createClient } from "./generated/client.ts";
import { sqlite } from "@ofis/tsorm/adapters/sqlite";

const db = await createClient({
  adapter: sqlite({ connection: "file:./app.sqlite", initialize: true }),
});

await db.user.create({
  data: { email: "alice@example.com", posts: { create: { title: "Hello" } } },
});
console.log(await db.user.findMany({ include: { posts: true } }));
await db.$close();
```

## Development

```bash
bun install
bun run build
```

| Command                   | Description                                                                       |
| ------------------------- | --------------------------------------------------------------------------------- |
| `bun test`                | Unit, integration and system tests; targets come from `TEST_DATABASES`            |
| `bun run test`            | Full regression; starts the `examples/compose.yaml` databases first, needs Docker |
| `bun run release [level]` | Bumps the version, builds and pushes the tag CI publishes from                    |
| `bun run docs`            | Serves the docs locally (English `/`, 中文 `/zh/`)                                |

Run `TEST_DATABASES=sqlite bun test` for a deterministic check. See [Development & Validation](docs/guide/development.md) for the full workflow, connection variables and server coverage.
