---
description: Development prerequisites, build and regression commands, database selection, and documentation standards.
---

# Development & Validation

Requires Node.js 22.15+. Scripts, tests, example runs, and extension bundling use Bun; server database tests need dedicated database services.

## Test Scope

| Area                       | Coverage                                                               |
| -------------------------- | ---------------------------------------------------------------------- |
| Schema and types           | Parsing, constraints, client generation, type inference                |
| Queries and writes         | SQL compilation, filters, projections, relation loading, nested writes |
| Transactions and lifecycle | Commit, rollback, timeouts, resource release, client shutdown          |
| Adapters                   | Connection URLs, scalar conversion, key readback, error mapping        |
| Migrations                 | Introspection, differences, history, risk checks, failure cleanup      |
| Tooling                    | CLI and editor language features                                       |

## Install and Build

```bash
bun install
bun run build
```

`build` compiles the ORM, regenerates the example and test clients, type-checks the repo and extension, builds docs, and packages the VS Code extension. Generated clients are git-ignored; `bun run example` without a database argument refreshes the example client. Focused checks:

```bash
bunx --no-install tsc -p tsconfig.types.json
bunx --no-install vitepress build docs
```

## Benchmarks and API Surface

Both report `ns/op = (ms × 1e6) / samples` (1 decimal). The first argument sets the run count; when comparing machines, take the median of several runs.

```bash
bun test/bench/bench.ts            # decode hot paths, 40 runs by default
bun test/bench/bench.ts 5          # 5 runs
bun test/bench/bench-datetime.ts   # 1,000,000 datetime values, 1 run by default
bun test/bench/bench-datetime.ts 3 # 3 runs
```

`bench.ts` also covers `bigintsAsText` (with and without bigint values) and JSON validation via `encodeJson`. Reference thresholds — SQLite full decode < 500 ns/row, `bigintsAsText` < 80 ns/row, ISO `storedInstant` < 45 ns/value — are measurement goals, not assertions; record real numbers and explain misses.

Tests guard the entrypoint symbol tables in the [Client API](../reference/client-api.md) against actual exports (`@internal` helpers excluded). Run after changing any `export`:

```bash
TEST_DATABASES=sqlite bun test test/unit/runtime.test.ts
```

## Release

```bash
bun run release          # tag the current package.json version
bun run release minor    # patch | minor | major: bump, commit, then tag
```

A dirty worktree is refused. A bump is committed as `chore: release v<version>` before tagging, and `main` plus the tag are pushed. The tag triggers CI build, tests, publishing, GitHub Release, and docs deployment on a single Bun version.

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

`bun test` discovers tests under `test/` and `extensions/test/`; `bun run test` also starts `examples/compose.yaml` (requires Docker). Without `TEST_DATABASES`, the helper includes SQLite and probes configured server databases; an explicit list selects only those targets. SQLite-only runs do not verify server-specific behavior.

| Database   | Connection variables                                       | Default test port |
| ---------- | ---------------------------------------------------------- | ----------------- |
| PostgreSQL | `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`   | 5433              |
| MySQL      | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD` | 3307              |
| MariaDB    | MySQL variables with `MARIADB_PORT`                        | 3308              |

Integration tests create and remove isolated databases or schemas; use dedicated development services and accounts with the required permissions.

## Documentation Standards

1. State the contract and prerequisites before examples; distinguish supported behavior, database differences, and limitations; keep declarations, runtime behavior, and command options in their owning sections with links instead of repeats.
2. Keep English and Chinese paths and contracts aligned; validate with `bunx --no-install vitepress build docs` (type-check navigation changes), and record verification commands, database targets, and unverified scope when reporting.

## Next Steps

- [Documentation Map](./documentation.md): topic locations
- [Full Example](./examples.md): example schemas and execution
