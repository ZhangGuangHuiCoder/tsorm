import type { Schema } from '../schema/index.js';
import type { DbColumn, DbIndex, DbModel, DbTable } from './introspect.js';
import type { TableChange } from './diff.js';

/** A rendered migration section: a comment header and the statements under it. */
export type Section = [comment: string, statements: string[]];

/**
 * Opaque per-provider connection settings. Only the provider that produced a
 * `Datasource` reads its internals; generic migration code treats it as a handle.
 */
export type Datasource = object;

/** One migration connection. `script` runs SQL text that may hold several statements. */
export interface Connection {
  readonly provider: MigrationProvider;
  readonly datasource: Datasource;
  query(sql: string, params?: unknown[]): Promise<any[]>;
  script(sql: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * A disposable database used to replay migrations and materialize the target schema.
 */
export interface Scratch {
  open(): Promise<Connection>;
  dispose(): Promise<void>;
}

/**
 * Everything a single database needs to drive the migration workflow: connecting,
 * introspecting, diffing, rendering DDL and the migration history. Implementations
 * live in `src/adapters`, keeping all database-specific SQL out of the generic layer.
 */
export interface MigrationProvider {
  readonly id: string;
  matches(url: string): boolean;
  parseDatasource(url: string, root: string): Datasource;
  describe(ds: Datasource): string;
  quote(name: string): string;
  param(index: number): string;
  now(): string;
  connect(ds: Datasource): Promise<Connection>;
  connectOrCreate(ds: Datasource): Promise<{ conn: Connection; created: boolean }>;
  databaseExists(ds: Datasource): Promise<boolean>;
  clearDatabase(conn: Connection): Promise<void>;
  resetDatabase(ds: Datasource): Promise<void>;
  createScratch(base: Datasource, shadow?: Datasource): Promise<Scratch>;
  introspect(conn: Connection): Promise<DbModel>;
  schemaDDL(schema: Schema): string[];
  renderDiff(created: DbTable[], dropped: DbTable[], changed: TableChange[]): Section[];
  indexKey(item: DbIndex): string;
  columnChanges(a: DbColumn, b: DbColumn): string[];
  historyDDL: string;
  historyExists(conn: Connection): Promise<boolean>;
  runScriptAtomically(conn: Connection, sql: string): Promise<void>;
  acquireLock(conn: Connection): Promise<void>;
  releaseLock(conn: Connection): Promise<void>;
}

/** Index identity by name, uniqueness and column list, for providers whose index DDL text is not canonical. */
export const structuralIndexKey = (item: DbIndex) => [item.name, item.unique, ...item.columns].join('\0');

/**
 * Shared column comparison used by `MigrationProvider.columnChanges`. When
 * `compareDefinition` is set, a differing raw definition counts as a change even if
 * no individual attribute differs.
 */
export function columnChanges(a: DbColumn, b: DbColumn, compareDefinition: boolean): string[] {
  const changes: string[] = [];
  if (a.type.toLowerCase() !== b.type.toLowerCase()) changes.push('type');
  if (a.nullable !== b.nullable) changes.push('nullability');
  if ((a.default ?? '') !== (b.default ?? '')) changes.push('default');
  if (a.auto !== b.auto) changes.push('autoincrement');
  if (compareDefinition && !changes.length && a.definition !== b.definition) changes.push('definition');
  return changes;
}
