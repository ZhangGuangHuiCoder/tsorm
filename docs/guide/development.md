---
description: Development prerequisites, build and regression commands, database selection, and documentation standards.
---

# Development & Validation

The package requires Node.js 22.15+. Repository scripts, tests, example execution, and extension bundling use Bun. Server database tests also need dedicated database services.

## Test Scope

Tests cover project-owned behavior through ORM interfaces:

| Area                       | Coverage                                                               |
| -------------------------- | ---------------------------------------------------------------------- |
| Schema and types           | Parsing, constraints, client generation, type inference                |
| Queries and writes         | SQL compilation, filters, projections, relation loading, nested writes |
| Transactions and lifecycle | Commit, rollback, timeouts, resource release, client shutdown          |
| Adapters                   | Connection URLs, scalar conversion, key readback, error mapping        |
| Migrations                 | Introspection, differences, history, risk checks, failure cleanup      |
| Tooling                    | CLI and editor language features                                       |

Drivers are external dependencies. Connection probes and isolated database cleanup are test infrastructure; driver stubs inject failures to verify ORM-owned behavior.

## Install and Build

```bash
bun install
bun run build
```

`build` compiles the ORM, regenerates the example and test clients, type-checks the whole repository and extension, builds documentation, and packages the VS Code extension. Both generated clients are git-ignored artifacts; `bun run example` without a database argument refreshes the example client individually.

For focused checks:

```bash
bunx --no-install tsc -p tsconfig.types.json
bunx --no-install vitepress build docs
```

## Release

```bash
bun run release minor   # patch | minor | major | x.y.z
```

The script requires a clean `main` checkout, bumps the package version, runs the full build (including extension version synchronization), commits, tags `v<version>`, and pushes the commit and tag. The tag triggers CI builds, tests, package publishing, GitHub Release creation, and documentation deployment. The current workflow runs on a single Bun version.

## Regression Workflow

```bash
# Start compose services, wait for health checks, then run tests.
bun run test

# Forward a test path and additional Bun test options.
bun run test test/unit/schema.test.ts --timeout 10000

# Run without external database services.
TEST_DATABASES=sqlite bun test

# Require all listed services; unavailable targets fail the run.
TEST_DATABASES=sqlite,mysql,mariadb,postgres bun test

# Run a focused SQLite regression suite.
TEST_DATABASES=sqlite bun test ./test/integration/sqlite-regressions.test.ts
```

`bun test` discovers the unit, integration, and system tests under `test/`, plus `extensions/test/`. `bun run test` additionally starts `examples/compose.yaml` and therefore requires Docker.

Without `TEST_DATABASES`, the helper includes SQLite and probes the configured server databases. An explicit list selects only those targets. A SQLite-only run does not verify server-specific behavior.

| Database   | Connection variables                                       | Default test port |
| ---------- | ---------------------------------------------------------- | ----------------- |
| PostgreSQL | `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`   | 5433              |
| MySQL      | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD` | 3307              |
| MariaDB    | MySQL variables with `MARIADB_PORT`                        | 3308              |

Integration tests create and remove isolated databases or schemas. Use dedicated development services and accounts with the required permissions.

## Documentation Standards

1. State the contract and prerequisites before examples.
2. Distinguish supported behavior, database differences, and limitations.
3. Keep detailed declarations, runtime behavior, and command options in their owning sections; link instead of repeating them.
4. Keep English and Chinese paths and contracts aligned.
5. Validate documentation with `bunx --no-install vitepress build docs`; type-check navigation changes as well.
6. Record verification commands, database targets, and unverified scope when reporting results.

## Next Steps

- [Documentation Map](./documentation.md): topic locations
- [Full Example](./examples.md): example schemas and execution
