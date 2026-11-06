---
description: The positioning, workflow, supported scope, installation, and versioning of TSORM.
---

# Introduction

TSORM (`@ofis/tsorm`) is a TypeScript ORM: define models in a `schema.orm` file, let the generator emit a type-safe client, and connect through an adapter.

## How It Works

1. **Define models**: describe fields, relations, and constraints in `schema.orm`. This file is always the single source of truth.
2. **Generate the client**: `tsorm generate` emits a database-independent TypeScript client.
3. **Choose an adapter**: pass `sqlite()`, `mysql()`, or `postgres()` when creating the client; switching needs no regeneration.
4. **Manage structure**: schema changes are managed with versioned migrations; during prototyping you can also use `push` or `initialize`.

## Supported Scope

| Item       | Minimum                                                 | Recommended |
| ---------- | ------------------------------------------------------- | ----------- |
| Node.js    | 24.10                                                   | 24 LTS      |
| SQLite     | Uses the built-in `node:sqlite`, no extra driver needed | —           |
| MySQL      | 8.0, via the `mariadb` client                        | 8.4 LTS     |
| MariaDB    | 10.6, via the `mariadb` client                          | 11.4 LTS    |
| PostgreSQL | 14, via the `pg` client                                 | 16          |

Tests run against the minimum versions.

For per-database feature differences, see the [capability matrix](../databases/overview.md).

## Install

```bash
npm install @ofis/tsorm
```

After installation the `@ofis/tsorm`, `@ofis/tsorm/adapters`, and `@ofis/tsorm/migrations` import paths resolve, and the `tsorm` command is available.

## Versioning

::: info 0.x releases
TSORM is still in the `0.x` series, so a minor bump (for example `0.14` to `0.15`) may contain breaking changes. Pin the version you depend on and review the changes before upgrading.
:::

## Next Steps

- Follow the [getting started guide](./getting-started.md) to run your first query.
- Read the [schema reference](./schema.md) for the full DSL syntax.
