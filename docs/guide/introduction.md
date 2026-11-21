---
description: TSORM positioning, workflow, supported scope, install, and versioning.
---

# Introduction

TSORM (`@ofis/tsorm`) is a TypeScript ORM: define models in a `schema.orm` file, generate a type-safe client, connect through an adapter.

## How It Works

1. **Define and generate**: describe fields, relations, and constraints in `schema.orm` — the single source of truth — then run `tsorm generate` for a database-independent client.
2. **Choose a database**: pass a `file:`, `mysql://` (or `mariadb://`), or `postgresql://` URL; switching needs no regeneration.
3. **Manage structure**: versioned migrations in real projects, `push` while prototyping.

## Supported Scope

| Item       | Minimum                                                 | Recommended |
| ---------- | ------------------------------------------------------- | ----------- |
| Node.js    | 22.15                                                   | 26 LTS      |
| SQLite     | Uses the built-in `node:sqlite`, no extra driver needed | —           |
| MySQL      | 8.0.16, via the `mariadb` client                        | 8.4 LTS     |
| MariaDB    | 10.6, via the `mariadb` client                          | 11.4 LTS    |
| PostgreSQL | 14, via the `pg` client                                 | 16          |

Requires Node.js 22.15+; adapters validate minimum server versions. Test selection: [Development & Validation](./development.md). Per-database features: [capability matrix](../databases/overview.md).

## Install

```bash
npm install @ofis/tsorm
```

Generate a client and import `createClient(options)` from `./generated/client.ts`; the adapter is chosen from the `connection` URL scheme. The root `@ofis/tsorm` entry (`internalCreateClient`) and `@ofis/tsorm/adapters/*` entries are for advanced use only — there is no aggregate adapters entry. Schema and migration APIs come from `@ofis/tsorm/schema` and `@ofis/tsorm/migrations`. Run `tsorm` via a package script or `npx tsorm`.

## Versioning

::: info 0.x releases
TSORM is `0.x`: a minor bump (for example `0.14` to `0.15`) may contain breaking changes. Pin the version and review changes before upgrading.
:::

## Next Steps

- Run your first query with the [getting started guide](./getting-started.md); full DSL syntax in the [schema reference](../schema/overview.md).
