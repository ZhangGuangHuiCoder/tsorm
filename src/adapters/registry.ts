import type { Adapter } from "../core/adapter.js";
import { MigrationError } from "../migrations/provider.js";
import type { MigrationProvider } from "../migrations/provider.js";
import { fail } from "../shared/index.js";
import { mysql, mysqlDialect } from "./mysql/index.js";
import { postgres, postgresDialect } from "./postgres/index.js";
import { sqlite, sqliteDialect } from "./sqlite/index.js";

/**
 * 一个受支持的连接 scheme。
 * A supported connection scheme.
 */
/**
 * @internal 连接 scheme 判定：适配器层内部实现。
 * Connection scheme classification: internal adapter-layer implementation.
 */
export type ConnectionScheme = "postgres" | "mysql" | "sqlite";

/**
 * 按 scheme 归类连接串：只认 `postgresql://`、`mysql://`（或 `mariadb://`）与 `file:`。
 * 其它数据库的 scheme、`jdbc:` 前缀与裸路径都判为 unsupported。适配器与迁移提供者共用这份判定。
 *
 * Classifies connection strings by scheme: only `postgresql://`, `mysql://` (or `mariadb://`),
 * and `file:` are recognized. Other database schemes, `jdbc:` prefixes, and bare paths are
 * unsupported. Adapters and migration providers share this classification.
 */
/**
 * @internal 连接 scheme 判定：适配器层内部实现。
 * Connection scheme classification: internal adapter-layer implementation.
 */
export function connectionScheme(value: string): ConnectionScheme | "unsupported" {
  if (/^postgresql:\/\//i.test(value)) {
    return "postgres";
  }
  if (/^(mysql|mariadb):\/\//i.test(value)) {
    return "mysql";
  }
  if (/^file:(?!\/\/)/i.test(value)) {
    return "sqlite";
  }
  return "unsupported";
}

/**
 * 方言注册与分派：按 URL scheme 选出适配器或迁移提供者。
 *
 * 标识的单一事实源是三个方言实现本身（`name` / `providerId`），这里只做派生视图。
 * PostgreSQL 是历史例外：provider id 是 `postgresql`（迁移文件名与 `commands.ts` 的
 * checkLock 依赖它），方言名是 `postgres`。本模块是内部模块，不进 `package.json#exports`。
 *
 * Dialect registration and dispatch: selects an adapter or migration provider by URL scheme.
 *
 * The three dialect implementations (`name` / `providerId`) are the single source of truth;
 * this module only provides derived views. PostgreSQL is the historical exception: its provider
 * id is `postgresql` (migration filenames and `checkLock` in `commands.ts` depend on it), while
 * its dialect name is `postgres`. This internal module is not in `package.json#exports`.
 */
export const PROVIDER_ID = {
  sqlite: sqliteDialect.providerId,
  mysql: mysqlDialect.providerId,
  postgres: postgresDialect.providerId,
} as const;

export const ADAPTER_NAME = {
  sqlite: sqliteDialect.name,
  mysql: mysqlDialect.name,
  postgres: postgresDialect.name,
} as const;

/**
 * 按 scheme 为连接 URL 构建适配器。只接受 `postgresql://`、`mysql://`（或 `mariadb://`）
 * 与 `file:`，其它输入以迁移层相同的消息报错。构建适配器不会触及驱动：连接与驱动模块由
 * 首次使用时运行的 `connect()` 加载，驱动选项来自 URL 本身。
 *
 * Builds the adapter for a connection URL by its scheme. Only `postgresql://`,
 * `mysql://` (or `mariadb://`) and `file:` are accepted; anything else fails with the
 * same message the migration layer uses. Adaptors are built without touching a driver: the
 * connection (and the driver module) is loaded by `connect()`, which runs on first use. Driver
 * options come from the URL itself.
 */
export function adapterFor(connection: string): Adapter {
  if (typeof connection !== "string" || !connection) {
    return fail("Connection requires a URL string");
  }
  switch (connectionScheme(connection)) {
    case "postgres":
      return postgres({ connection });
    case "mysql":
      return mysql({ connection });
    case "unsupported":
      return fail("Use a file:, postgresql:// or mysql:// url");
    case "sqlite":
      return sqlite({ connection });
  }
}

/**
 * 按 scheme 为数据源 URL 选择迁移提供者。只接受 `postgresql://`、`mysql://`（或 `mariadb://`）
 * 与 `file:`。每个提供者按需导入，因此只加载所选数据库的驱动。
 *
 * Selects the migration provider for a datasource url by its scheme. Only `postgresql://`,
 * `mysql://` (or `mariadb://`) and `file:` are accepted. Each provider is imported on demand,
 * so only the driver of the chosen database is loaded.
 */
export async function providerFor(url: string): Promise<MigrationProvider> {
  switch (connectionScheme(url)) {
    case "postgres":
      return (await import("./postgres/index.js")).postgresProvider;
    case "mysql":
      return (await import("./mysql/index.js")).mysqlProvider;
    case "unsupported":
      throw new MigrationError("INVALID_URL", "Use a file:, postgresql:// or mysql:// url");
    case "sqlite":
      return (await import("./sqlite/index.js")).sqliteProvider;
  }
}
