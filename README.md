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

- [Documentation site](https://tsorm.js.org/) · [中文文档站](https://tsorm.js.org/zh/)
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

Generate the client and create the tables in the SQLite database used below before running the example:

```bash
tsorm generate --schema schema.orm --out generated/client.ts
DATABASE_URL=file:./app.sqlite tsorm push --schema schema.orm
```

```ts
import { createClient } from "./generated/client.ts";

const db = createClient({
  connection: "file:./app.sqlite",
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
| `bun run release [level]` | Tags the bumped version and pushes it for CI to publish                           |
| `bun run docs`            | Serves the docs locally (English `/`, 中文 `/zh/`)                                |

Run `TEST_DATABASES=sqlite bun test` for a deterministic check. See [Development & Validation](docs/guide/development.md) for the full workflow, connection variables and server coverage.
