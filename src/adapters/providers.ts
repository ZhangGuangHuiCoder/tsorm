import { MigrationError } from "../migrations/errors.js";
import type { MigrationProvider } from "../migrations/provider.js";
import { isMysqlUrl, isPostgresUrl, isSqliteUrl } from "./urls.js";

/**
 * Selects the migration provider for a datasource url by its scheme; bare paths are SQLite.
 * Each provider is imported on demand, so only the driver of the chosen database is loaded.
 */
export async function providerFor(url: string): Promise<MigrationProvider> {
  if (isPostgresUrl(url)) {
    return (await import("./postgres/migration.js")).postgresProvider;
  }
  if (isMysqlUrl(url)) {
    return (await import("./mysql/migration.js")).mysqlProvider;
  }
  if (!isSqliteUrl(url)) {
    throw new MigrationError("INVALID_URL", "Use a file:, postgresql:// or mysql:// url");
  }
  return (await import("./sqlite/migration.js")).sqliteProvider;
}
