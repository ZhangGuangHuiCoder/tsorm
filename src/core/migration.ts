import type { MigrationDialect } from "./dialect.js";
import type { Connection, Datasource, Scratch, Section, MigrationProvider } from "../migrations/provider.js";
import { scratchDatabase, MigrationError } from "../migrations/provider.js";

/**
 * 标准迁移管线：把一个方言的翻译装成统一的 `MigrationProvider`。
 *
 * 提供者的 21 个成员在这里只写一次，方言只提供差异（SQL、参数、锁、目录查询），
 * 通用流程（建库、影子库、历史表、差异渲染）不再散落在三份适配器文件里。
 * Standard migration pipeline: adapts a dialect's translations into a uniform `MigrationProvider`.
 *
 * The provider's 21 members are defined here once; dialects supply only differences (SQL, parameters, locks, catalog queries),
 * while shared flows (database creation, shadow databases, history tables, diff rendering) no longer live across three adapter files.
 */
export function createProvider(dialect: MigrationDialect): MigrationProvider {
  return {
    id: dialect.providerId,
    parseDatasource: dialect.parseDatasource,
    describe: dialect.describe,
    quote: dialect.quote,
    param: dialect.param,
    now: dialect.now,
    connect: (ds) => dialect.connectMigration(ds),
    connectOrCreate: (ds) => dialect.connectOrCreate(ds),
    databaseExists: (ds) => dialect.databaseExists(ds),
    clearDatabase: (conn) => dialect.clearDatabase(conn),
    createScratch: (base, shadow) => dialect.createScratch(base, shadow),
    introspect: (conn) => dialect.introspect(conn),
    schemaDDL: (schema) => dialect.schemaDDL(schema),
    renderDiff: (created, dropped, changed) => dialect.renderDiffSQL(created, dropped, changed),
    indexKey: (item) => dialect.indexKey(item),
    columnChanges: (a, b) => dialect.columnChanges(a, b),
    historyDDL: (table) => dialect.historyDDL(table),
    historyExists: (conn) => dialect.historyExists(conn),
    runScriptAtomically: (conn, sql) => dialect.runScriptAtomically(conn, sql),
    acquireLock: (conn) => dialect.acquireLock(conn),
    releaseLock: (conn) => dialect.releaseLock(conn),
  };
}

// ─── Migration sections ────────────────────────────────────────────────────
/**
 * 仅当渲染后的迁移分节包含语句时才追加它。
 * 三个 `renderDiff` 实现原先都使用相同的局部辅助函数；
 * 将其集中到这里可消除重复条件，同时不改动任何
 * SQL、错误文本或差异控制流。
 * Appends a rendered migration section only when it carries statements.
 * All three `renderDiff` implementations used the identical local helper;
 * keeping it here removes the duplicated conditional without touching any
 * SQL, error text or diff control flow.
 */
export function pushSection(sections: Section[], comment: string, statements: string[]): void {
  if (statements.length) {
    sections.push([comment, statements]);
  }
}

// ─── Database creation flow ────────────────────────────────────────────────
/**
 * 通用流程能够按名称定位数据库的数据源。
 * A datasource the generic flow can name a database on.
 */
export interface DatabaseDatasource extends Datasource {
  database: string;
}

/**
 * 数据库创建与临时库（影子库）的方言钩子。只有
 * SQL 文本、管理连接和身份规则不同；编排流程共享。
 * Dialect hooks for database creation and scratch (shadow) databases. Only the
 * SQL text, admin connection and identity rules vary; the orchestration is shared.
 */
export interface DatabaseFlowConfig<DS extends DatabaseDatasource = DatabaseDatasource> {
  quote: (name: string) => string;
  /** Different in each dialect (direct admin socket vs. maintenance database). */
  adminConnection: (ds: DS) => Promise<Connection>;
  /** Existence probe: `[sql, params]`. */
  existsSQL: (ds: DS) => [string, unknown[]];
  createSQL: (database: string) => string;
  dropSQL: (database: string) => string;
  shadowName: () => string;
  /** Fail-closed comparison for an explicit shadow datasource. */
  sameDatabase: (base: DS, shadow: DS) => boolean;
  shadowMismatchMessage: string;
  connect: (ds: DS) => Promise<Connection>;
  withDatabase: (ds: DS, database: string) => DS;
  /** Optional schema check/creation after connecting to the target database. */
  afterConnect?: (conn: Connection, ds: DS) => Promise<void>;
}

export interface DatabaseFlow<DS extends DatabaseDatasource = DatabaseDatasource> {
  databaseExists: (ds: DS) => Promise<boolean>;
  createDatabase: (ds: DS, database: string) => Promise<void>;
  dropDatabase: (ds: DS, database: string) => Promise<void>;
  connectOrCreate: (ds: DS) => Promise<{ conn: Connection; created: boolean }>;
  createScratch: (base: DS, shadow?: Datasource) => Promise<Scratch>;
}

/**
 * 迁移连接、创建和临时库生命周期的统一实现。每个
 * 错误码、消息和 SQL 片段都来自配置，因此其文本与
 * 原方言函数逐字节一致。
 * One implementation of the migration connect/create/scratch lifecycle. Every
 * error code, message and SQL fragment comes from the config so the text is
 * byte-for-byte identical to the original dialect functions.
 */
export function createDatabaseFlow<DS extends DatabaseDatasource = DatabaseDatasource>(cfg: DatabaseFlowConfig<DS>): DatabaseFlow<DS> {
  const databaseExists = async (ds: DS): Promise<boolean> => {
    const admin = await cfg.adminConnection(ds);
    try {
      const [sql, params] = cfg.existsSQL(ds);
      const rows = await admin.query(sql, params);
      return rows.length > 0;
    } finally {
      await admin.close();
    }
  };

  const createDatabase = async (ds: DS, database: string): Promise<void> => {
    const admin = await cfg.adminConnection(ds);
    try {
      await admin.script(cfg.createSQL(database));
    } catch (error) {
      throw new MigrationError("DATABASE_CREATE_FAILED", `Failed to create database ${database}`, { cause: error });
    } finally {
      await admin.close();
    }
  };

  const dropDatabase = async (ds: DS, database: string): Promise<void> => {
    const admin = await cfg.adminConnection(ds);
    try {
      await admin.script(cfg.dropSQL(database));
    } finally {
      await admin.close();
    }
  };

  const connectOrCreate = async (ds: DS): Promise<{ conn: Connection; created: boolean }> => {
    let created = false;
    if (!(await databaseExists(ds))) {
      await createDatabase(ds, ds.database);
      created = true;
    }
    const conn = await cfg.connect(ds);
    try {
      await cfg.afterConnect?.(conn, ds);
      return { conn, created };
    } catch (error) {
      await conn.close();
      throw error;
    }
  };

  const createScratch = async (base: DS, shadow?: Datasource): Promise<Scratch> => {
    if (shadow) {
      const shadowDs = shadow as DS;
      // Fail closed for matching database names even across host aliases or proxies.
      if (cfg.sameDatabase(base, shadowDs)) {
        throw new MigrationError("INVALID_URL", cfg.shadowMismatchMessage);
      }
      return scratchDatabase(async () => {
        return (await connectOrCreate(shadowDs)).conn;
      });
    }
    const name = cfg.shadowName();
    try {
      await createDatabase(base, name);
    } catch (error) {
      throw new MigrationError("SHADOW_DATABASE_CREATE_FAILED", "Could not create the shadow database. Grant the database user permission to create databases, or set SHADOW_DATABASE_URL", { cause: error });
    }
    return scratchDatabase(
      () => {
        return cfg.connect(cfg.withDatabase(base, name));
      },
      () => {
        return dropDatabase(base, name);
      },
    );
  };

  return { databaseExists, createDatabase, dropDatabase, connectOrCreate, createScratch };
}
