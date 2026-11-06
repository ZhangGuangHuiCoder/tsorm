import { MigrationError } from '../migrations/errors.js';
import type { MigrationProvider } from '../migrations/provider.js';
import { sqliteProvider } from './migration-sqlite.js';
import { postgresProvider } from './migration-postgres.js';
import { mysqlProvider } from './migration-mysql.js';

export { sqliteProvider, postgresProvider, mysqlProvider };

/** Selects the migration provider for a datasource url by its scheme; bare paths are SQLite. */
export function providerFor(url: string): MigrationProvider {
  if (postgresProvider.matches(url)) return postgresProvider;
  if (mysqlProvider.matches(url)) return mysqlProvider;
  if (!sqliteProvider.matches(url))
    throw new MigrationError('INVALID_URL', 'Use a file:, postgresql:// or mysql:// url');
  return sqliteProvider;
}
