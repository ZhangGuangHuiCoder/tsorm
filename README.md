# TSORM

A type-safe TypeScript ORM. Describe models in a small schema language, generate a typed client, and query SQLite, MySQL/MariaDB or PostgreSQL through the same API.

- Generated client with inferred types for `select`, `include` and relation writes
- Built-in SQLite via `node:sqlite`; `mariadb` and `pg` drivers for the others
- `tsorm` CLI for versioned migrations, schema diff and push
- VS Code extension for `.orm` files: highlighting, diagnostics, formatting, completion

## Install

```bash
npm install @ofis/tsorm
```

Requires Node.js 24.10+. The `mariadb` and `pg` drivers come with the package; SQLite uses the built-in `node:sqlite`.

## Usage

`schema.orm`:

```ts
model User {
  id: int @id @auto
  email: string(191) @unique
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
import { createClient } from './generated/client.ts';
import { sqlite } from '@ofis/tsorm/adapters/sqlite';

const db = await createClient({ adapter: sqlite({ filename: './app.sqlite', initialize: true }) });

await db.user.create({
  data: { email: 'alice@example.com', posts: { create: { title: 'Hello' } } },
});
console.log(await db.user.findMany({ include: { posts: true } }));
await db.$close();
```

## Development

```bash
bun install
bun run build
```

| Command | Description |
| --- | --- |
| `bun run build` | Compiles the ORM to `dist/` and packages the VS Code extension to `artifacts/tsorm-vscode.vsix` |
| `bun test` | Runs the full suite: unit, integration and VS Code tests, plus the `mysql`/`postgres` suites when `TSORM_MYSQL_TEST=1` / `TSORM_PG_TEST=1` (see `examples/compose.yaml`) |
| `bun run example <database>` | Runs `examples/demo.ts`. Databases: `sqlite`, `mysql`, `pgsql` |
| `bun run generate` | Regenerates `examples/client.ts` from `examples/schema.orm` |
| `bun run check` | Build, generate, type check, non-database tests, SQLite example and docs build; run before committing |
| `bun run clean` | Removes build output, the docs cache and `artifacts/` |
| `bun run docs:dev` / `docs:build` | Docs site (English at `/`, 中文 at `/zh/`) |

Tests and examples that need a real database are opt-in (`TSORM_MYSQL_TEST=1`, `TSORM_PG_TEST=1`) and connect via `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` and `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.

The extension version follows `version` in the root `package.json`. To try a local build, install it with `code --install-extension artifacts/tsorm-vscode.vsix`.
