---
description: Run the complete in-repository example project against SQLite, MySQL, and PostgreSQL.
---

# Full Example

The source repository ships a complete example in `examples/`: the same models and the same code, run against SQLite, MySQL, and PostgreSQL.

| File           | Contents                                                                               |
| -------------- | -------------------------------------------------------------------------------------- |
| `schema.orm`   | The models                                                                             |
| `client.ts`    | The generated client                                                                   |
| `demo.ts`      | Demo script, selects the database by CLI argument                                      |
| `compose.yaml` | Local MySQL, MariaDB (port 3308) and PostgreSQL test instances at the minimum versions |

## Prepare

This example runs from a checkout of the source repository. In its root, run:

```bash
bun install
bun run build
```

Each run regenerates the clients first: `bun run example` without a database argument stops after regeneration, which is the way to refresh `examples/client.ts` and `test/fixtures/client.ts`.

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

The example needs no environment variables: the connection strings are built into `demo.ts`, pointing at the local `compose.yaml` instances by default (SQLite uses an in-memory database), and the client timezone is fixed at `+08:00`.

The example creates its tables in an empty database. After success or an intermediate failure, it attempts to clean up the current run's records, including soft-deleted records, in a transaction. The connection is closed even if cleanup fails. The example does not drop tables or reset databases; prepare an empty database before re-running against MySQL or PostgreSQL.

## Reading Order

The entry point at the bottom of `demo.ts` calls named functions for queries, writes, transactions, relations, scalars, raw SQL, and soft delete, followed by deletion and foreign-key cascades. `cleanup` handles final cleanup, and section headings separate each stage in the output.

## Coverage

The example covers:

- CRUD, relation queries, and nested creates
- Bulk writes and `skipDuplicates`
- Transaction commit and rollback
- Event logging: `query`, `transaction`, and `client` events
- Typed JSON, soft delete and restore, virtual fields, and list totals
- `createManyAndReturn` and `updateManyAndReturn`
- Referential actions (`Cascade`, `SetNull`) and self-relations (a `Category` tree plus the `User.following` many-to-many)
- Polymorphic relations, both the explicit `Attachment.owner` form and the short `Note.holder` form
- Composite unique keys (`@@unique`), model-level indexes (`@@index`), and name mapping (`@map`, `@@map`)
- Non-auto ids (`string(36) = uuid()`) and the scalar types this example uses (`int`, `bigint`, `decimal`, `bytes`, `boolean`, `datetime`, `string(n)`, `text`, literal unions)
- `@updatedAt` timestamps and literal-union defaults
- Relation writes: `connect`, `connectOrCreate`, `set`, and `disconnect`
- `$executeRaw` and `sql` fragments for dialect-aware writes with static identifiers and bound values
- `$extend` chaining: virtuals on the base client and `omit` layered on top

## Next Steps

- [Getting Started](./getting-started.md): the same workflow in a minimal project
- [Documentation Map](./documentation.md): where each feature is documented
