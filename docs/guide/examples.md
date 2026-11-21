---
description: Run the complete in-repository example project against SQLite, MySQL, and PostgreSQL.
---

# Full Example

The repository ships a complete example in `examples/`: one set of models and code, run against SQLite, MySQL, and PostgreSQL.

| File           | Contents                                                                               |
| -------------- | -------------------------------------------------------------------------------------- |
| `schema.orm`   | The models                                                                             |
| `client.ts`    | The generated client                                                                   |
| `demo.ts`      | Demo script, selects the database by CLI argument                                      |
| `compose.yaml` | Local MySQL, MariaDB (port 3308) and PostgreSQL test instances at the minimum versions |

## Prepare

Run from a checkout of the source repository, in its root:

```bash
bun install
bun run build
```

Each run regenerates the example client; `bun run example` without a database argument only does that (refreshes `examples/client.ts`). The test client `test/fixtures/client.ts` is regenerated only by `bun run build`. Both are git-ignored.

## Run

::: code-group

```bash [SQLite]
bun run example sqlite
```

```bash [MySQL]
docker compose -f examples/compose.yaml up -d --wait mysql
bun run example mysql
```

```bash [PostgreSQL]
docker compose -f examples/compose.yaml up -d --wait postgres
bun run example pgsql
```

:::

## Configuration

Connection strings are built into `demo.ts`, pointing at the local `compose.yaml` instances (SQLite uses a temporary file); `datetime` columns come back as `Date` objects. Tables are created at startup via the migration API and `reset` (which empties the model's tables), so every run starts clean and re-running needs no manual preparation. On exit only the connection is closed.

## Reading Order

The entry point at the bottom of `demo.ts` runs one section after another — nested creates and relation queries, writes and updates, transactions, relation writes and referential actions, composite keys and scalars, parameterized SQL, typed JSON with soft delete and restore, and deletion with cascades — with headings separating each stage in the output.

## Coverage

- CRUD, relation queries, and nested creates; transactions with commit, deliberate rollback, and error rethrow
- Event logging (`query`, `transaction`, `client`); typed JSON, soft delete and restore
- Referential actions (`Cascade`, `SetNull`) and composite unique keys (`@@unique`)
- Non-auto ids (`string(36) = uuid()`) and the scalar types used (`int`, `bigint`, `decimal`, `bytes`, `boolean`, `datetime`, `string(n)`, `text`, literal unions)
- Relation writes (`connect`, `connectOrCreate`); `$queryRaw`, `$executeRaw`, and `sql` fragments for dialect-aware writes

## Next Steps

- The same workflow in a minimal project: [Getting Started](./getting-started.md); feature locations: [Documentation Map](./documentation.md).
