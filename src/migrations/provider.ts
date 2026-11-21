import type { Schema } from "../schema/model.js";
import type { DbColumn, DbIndex, DbModel, DbTable } from "./diff.js";
import type { TableChange } from "./diff.js";

export class MigrationError extends Error {
  constructor(
    public code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MigrationError";
  }
}

/**
 * 对迁移必须保留的物理表名返回 true。
 * True for physical table names migrations must leave alone.
 */
export type KeepTable = (name: string) => boolean;

/**
 * 渲染后的迁移分节：一个注释标题及其下的语句。
 * A rendered migration section: a comment header and the statements under it.
 */
export type Section = [comment: string, statements: string[]];

/**
 * 各提供者的连接设置。只有生成 `Datasource` 的提供者读取其内部字段；通用迁移代码仅设置 `historyTable`。
 * Per-provider connection settings. Only the provider that produced a `Datasource`
 * reads its internals; generic migration code only sets `historyTable`.
 */
export interface Datasource {
  /** Migration history table name; defaults to `_tsorm_migrations`. */
  readonly historyTable?: string;
  /** Tables migrations never read or drop: introspection skips them and clearing keeps them. */
  readonly ignore?: KeepTable;
}

/**
 * 一个迁移连接。`script` 运行可包含多条语句的 SQL 文本。
 * One migration connection. `script` runs SQL text that may hold several statements.
 */
export interface Connection {
  readonly provider: MigrationProvider;
  readonly datasource: Datasource;
  query(sql: string, params?: unknown[]): Promise<any[]>;
  script(sql: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * 一次性数据库，用于重放迁移并物化目标模式。
 * A disposable database used to replay migrations and materialize the target schema.
 */
export interface Scratch {
  open(): Promise<Connection>;
  dispose(): Promise<void>;
}

/**
 * 单个数据库驱动迁移工作流所需的全部能力：连接、内省、差异比较、DDL 渲染与迁移历史。
 * 实现位于 `src/adapters`，使数据库特定 SQL 不进入通用层。
 * Everything a single database needs to drive the migration workflow: connecting,
 * introspecting, diffing, rendering DDL and the migration history. Implementations
 * live in `src/adapters`, keeping all database-specific SQL out of the generic layer.
 */
export interface MigrationProvider {
  readonly id: string;
  parseDatasource(url: string, root: string): Datasource;
  describe(ds: Datasource): string;
  quote(name: string): string;
  param(index: number): string;
  now(): string;
  connect(ds: Datasource): Promise<Connection>;
  connectOrCreate(ds: Datasource): Promise<{ conn: Connection; created: boolean }>;
  databaseExists(ds: Datasource): Promise<boolean>;
  /** Drops every table and view except the ones the datasource ignores. */
  clearDatabase(conn: Connection): Promise<void>;
  createScratch(base: Datasource, shadow?: Datasource): Promise<Scratch>;
  introspect(conn: Connection): Promise<DbModel>;
  schemaDDL(schema: Schema): string[];
  renderDiff(created: DbTable[], dropped: DbTable[], changed: TableChange[]): Section[];
  indexKey(item: DbIndex): string;
  columnChanges(a: DbColumn, b: DbColumn): string[];
  historyDDL(table: string): string;
  historyExists(conn: Connection): Promise<boolean>;
  runScriptAtomically(conn: Connection, sql: string): Promise<void>;
  acquireLock(conn: Connection): Promise<void>;
  releaseLock(conn: Connection): Promise<void>;
}

/** A scratch database that is emptied each time it is opened; `drop` removes it for good. */
class ScratchDatabase implements Scratch {
  private current?: Connection;

  constructor(
    private readonly connect: () => Promise<Connection>,
    private readonly drop?: () => Promise<void>,
  ) {}

  open = async (): Promise<Connection> => {
    await this.current?.close();
    this.current = await this.connect();
    await this.current.provider.clearDatabase(this.current);
    return this.current;
  };
  dispose = async (): Promise<void> => {
    try {
      await this.current?.close();
    } finally {
      await this.drop?.();
    }
  };
}

export function scratchDatabase(connect: () => Promise<Connection>, drop?: () => Promise<void>): Scratch {
  return new ScratchDatabase(connect, drop);
}

/**
 * 按名称、唯一性和列列表确定索引标识，适用于索引 DDL 文本非规范化的提供者。
 * Index identity by name, uniqueness and column list, for providers whose index DDL text is not canonical.
 */
export const structuralIndexKey = (item: DbIndex) => {
  return [item.name, item.unique, ...item.columns].join("\0");
};

/**
 * 供 `MigrationProvider.columnChanges` 使用的共享列比较。设置 `compareDefinition` 时，
 * 即使各属性均未变化，原始定义不同也计为变化。
 * Shared column comparison used by `MigrationProvider.columnChanges`. When
 * `compareDefinition` is set, a differing raw definition counts as a change even if
 * no individual attribute differs.
 */
export function columnChanges(a: DbColumn, b: DbColumn, compareDefinition: boolean): string[] {
  const changes: string[] = [];
  if (a.type.toLowerCase() !== b.type.toLowerCase()) {
    changes.push("type");
  }
  if (a.nullable !== b.nullable) {
    changes.push("nullability");
  }
  if (a.default !== b.default) {
    changes.push("default");
  }
  if (a.auto !== b.auto) {
    changes.push("autoincrement");
  }
  if ((a.comment ?? "") !== (b.comment ?? "")) {
    changes.push("comment");
  }
  if (compareDefinition && !changes.length && a.definition !== b.definition) {
    changes.push("definition");
  }
  return changes;
}
