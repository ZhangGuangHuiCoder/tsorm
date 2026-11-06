---
description: Run the complete in-repository example project against SQLite, MySQL, and PostgreSQL.
---

# Full Example

The source repository ships a complete example in `examples/`: the same models and the same code, run against SQLite, MySQL, and PostgreSQL.

| File                     | Contents                                             |
| ------------------------ | ---------------------------------------------------- |
| `schema.orm`             | The models                                           |
| `client.ts`              | The generated client                                 |
| `demo.ts`                | Demo script, selects the database by CLI argument    |
| `compose.yaml`           | Local MySQL, MariaDB (port 3308) and PostgreSQL test instances at the minimum versions |

## Prepare

This example runs from a checkout of the source repository. In its root, run:

```bash
bun install --frozen-lockfile
bun run build
bun run generate
```

## Run

::: code-group

```bash [SQLite]
bun run example sqlite
```

```bash [MySQL]
docker compose -f examples/compose.yaml up -d --wait mysql
MYSQL_ALLOW_PUBLIC_KEY_RETRIEVAL=1 bun run example mysql
```

```bash [PostgreSQL]
docker compose -f examples/compose.yaml up -d --wait postgres
bun run example pgsql
```

:::

## Configuration

| Environment variable                                                          | Scope      | Description                                                      |
| ----------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------- |
| `ORM_INITIALIZE`                                                              | All        | Initialize an empty database by default; set `0` when matching tables already exist |
| `ORM_TIMEZONE`                                                                | All        | Client timezone, defaults to `+08:00`                            |
| `SQLITE_FILE`                                                                 | SQLite     | Database file, defaults to an in-memory database                 |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`  | MySQL      | Connection parameters, pointing at the local test instance in `compose.yaml` by default |
| `MYSQL_RSA_PUBLIC_KEY`                                                        | MySQL      | A trusted server RSA public key                                  |
| `MYSQL_ALLOW_PUBLIC_KEY_RETRIEVAL`                                            | MySQL      | When `1`, allows fetching the public key automatically, for local testing only |
| `DATABASE_URL`                                                                | PostgreSQL | Connection string, takes precedence over the parameters below    |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`                      | PostgreSQL | Connection parameters, pointing at the local test instance in `compose.yaml` by default |
| `PGSCHEMA`                                                                    | PostgreSQL | Target schema, defaults to `public`                              |

The example only cleans up records created by the current run; it never drops the whole database.

## Coverage

The example covers:

- CRUD, relation queries, and nested creates
- Bulk writes and `skipDuplicates`
- Transaction commit and rollback
- Event logging
- Typed JSON, soft delete and restore, virtual fields, and list totals
- `createManyAndReturn` and `updateManyAndReturn`
