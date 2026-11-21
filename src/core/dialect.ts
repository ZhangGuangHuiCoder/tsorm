import type { Capabilities, Dialect } from "./adapter.js";
import type { Column, Schema, Table } from "../schema/model.js";
import type { Connection, Datasource, Scratch, Section } from "../migrations/provider.js";
import type { DbColumn, DbIndex, DbModel, DbTable } from "../migrations/diff.js";
import type { TableChange } from "../migrations/diff.js";
import { dateGroupKey, decode as decodeRow, decodeDateValue, encode as encodeScalar, encodeInstant, quoteIdentifier, scalarGroupKey } from "../shared/index.js";

/**
 * 方言翻译的标准基类：把「标准能力」翻译成某个数据库方言所需的公共骨架。
 *
 * 这里只写「多数方言一致」的行为，差异全部由子类重写，因此新增方言只需描述差异。
 * 所有函数型成员一律写成箭头字段（INV-C4）：查询编译器与迁移辅助函数会把
 * `dialect.quote`、`dialect.encode` 等解构后独立调用，原型方法会丢掉 `this`。
 * Standard base class for dialect translation: a shared skeleton that maps standard capabilities to a database dialect.
 *
 * Only behavior shared by most dialects lives here; subclasses override every difference, so new dialects describe only those differences.
 * All function-valued members use arrow fields (INV-C4): the query compiler and migration helpers destructure and call
 * `dialect.quote`, `dialect.encode`, and others independently; prototype methods would lose `this`.
 */
export abstract class BaseDialect implements Dialect {
  /** Dialect label for display and debugging only; never branch on it. */
  abstract name: string;
  /** Migration provider ID; shares its origin with the dialect name, though some dialects use different values. */
  abstract providerId: string;
  /** Driver capabilities: RETURNING support and available isolation levels. */
  abstract capabilities: Capabilities;

  // ─── Identifiers and parameters ──────────────────────────────────────────
  /** Identifier quoting: ANSI double quotes by default; backtick-style dialects override this. */
  quote = quoteIdentifier;
  /** Parameter placeholder: positional by default; numbered-placeholder dialects override this with `$n`. */
  parameter = (_index: number) => "?";
  /** Migration parameter placeholder: uses the same rules as the query layer. */
  param = (index: number) => this.parameter(index);

  // ─── Value encoding and decoding ────────────────────────────────────────────────────────────
  /** Row decoding: inline datetime decoding by default; dialects needing raw-value normalization override this with single-pass decoding. */
  decode = (table: Table, row: any): any => decodeRow(table, row, "inlineDates");
  /** Single stored-value decoding: identical across all three dialects (datetime columns only). */
  decodeValue = decodeDateValue;
  /** Grouping/cursor key: datetimes compare by milliseconds; other types use standard scalar keys. */
  groupKey = (column: Column, value: any): string => dateGroupKey(column, value, scalarGroupKey);

  /** Write-value encoding: datetimes use absolute instants; other types go to dialect hooks. */
  encode = (column: Column, value: any): any => {
    if (column.type === "datetime" && value !== null) {
      return encodeInstant(column, value, this.encodeTextInstant);
    }
    return this.encodeValue(column, value);
  };
  /** Stored value for text datetime columns: passes a Date to the driver by default; text-storage dialects override this with ISO text. */
  protected encodeTextInstant = (_instant: Date): any => _instant;
  /** Write value for non-datetime columns: shared scalar encoding by default. */
  protected encodeValue = (column: Column, value: any): any => encodeScalar(column, value);

  // ─── Literals and statement fragments ────────────────────────────────────────────────────
  /** Unlimited row count: dialect-specific and supplied by subclasses. */
  abstract unlimited: number | null;
  /** Boolean literals: 1/0 by default; dialects retaining keywords override these with TRUE/FALSE. */
  trueLiteral = "1";
  falseLiteral = "0";
  /** Columnless INSERT: standard DEFAULT VALUES; dialects requiring an explicit empty value list override this. */
  emptyInsertValues = "DEFAULT VALUES";
  /** Conflict ignore: standard ON CONFLICT DO NOTHING; unsupported dialects override this with an empty string. */
  onConflictDoNothing = () => " ON CONFLICT DO NOTHING";
  /** Conflict update suffix: standard ON CONFLICT ... DO UPDATE SET; other dialects override this with their upsert syntax. */
  upsertConflictSuffix = (columns: string) => ") ON CONFLICT (" + columns + ") DO UPDATE SET ";
  /** DELETE alias keyword: unused by the standard; dialects requiring aliases override this. */
  deleteKeyword = (_alias: string) => "";
  /** Page size: unchanged by default; dialects with narrower integers override out-of-range values as BigInt. */
  pageValue: Dialect["pageValue"] = (value: number | null) => value;
  /** Bigint comparison operand: unchanged by default; dialects transporting big integers as text override this with strings. */
  bigintOperand = (value: any) => value;
  /** Decimal operand wrapper: unchanged by default; dialects requiring explicit types override this with CAST(... AS DECIMAL). */
  wrapDecimalOperand = (operand: string) => operand;
  /** Integer division: dialect-specific and supplied by subclasses. */
  abstract integerDivide: Dialect["integerDivide"];
  /** LIKE predicate: standard LIKE / LOWER LIKE; dialects with native case-insensitive comparison override this. */
  containsPredicate = (col: string, placeholder: string, insensitive: boolean) => {
    return insensitive ? `LOWER(${col}) LIKE LOWER(${placeholder}) ESCAPE '!'` : `${col} LIKE ${placeholder} ESCAPE '!'`;
  };
  /** NULLS FIRST/LAST: unsupported by default (undefined); supporting dialects override this. */
  nullsOrder = (_first: boolean): string | undefined => undefined;
  /** Boolean aggregation: standard MIN/MAX; dialects with native boolean aggregation override this with BOOL_AND/BOOL_OR. */
  booleanMinMax = (op: "MIN" | "MAX", expr: string) => {
    return op + "(" + expr + ")";
  };
  /** Default transaction isolation: dialect-specific and supplied by subclasses. */
  abstract defaultTransactionIsolation: Dialect["defaultTransactionIsolation"];
  /** JSON path predicates: dialect-specific and supplied by subclasses. */
  abstract json: Dialect["json"];

  // ─── Dialect translation for migrations ────────────────────────────────────────────────────
  /** Current-time expression for migrations. */
  abstract now: () => string;
  /** Display description of a datasource. */
  abstract describe: (ds: Datasource) => string;
  /** Datasource URL to datasource description. */
  abstract parseDatasource: (url: string, root: string) => Datasource;
  /** Opens a migration connection. */
  abstract connectMigration: (ds: Datasource) => Promise<Connection>;
  /** Connects (creating the database when needed) and returns whether it was created. */
  abstract connectOrCreate: (ds: Datasource) => Promise<{ conn: Connection; created: boolean }>;
  /** Whether the database exists. */
  abstract databaseExists: (ds: Datasource) => Promise<boolean>;
  /** Clears the database, preserving objects in datasource.ignore. */
  abstract clearDatabase: (conn: Connection) => Promise<void>;
  /** Creates a shadow / scratch database. */
  abstract createScratch: (base: Datasource, shadow?: Datasource) => Promise<Scratch>;
  /** Reads the current database's table structure. */
  abstract introspect: (conn: Connection) => Promise<DbModel>;
  /** Migration history table DDL. */
  abstract historyDDL: (table: string) => string;
  /** Whether the migration history table exists. */
  abstract historyExists: (conn: Connection) => Promise<boolean>;
  /** Executes a script in a single transaction. */
  abstract runScriptAtomically: (conn: Connection, sql: string) => Promise<void>;
  /** Acquires the migration lock. */
  abstract acquireLock: (conn: Connection) => Promise<void>;
  /** Releases the migration lock. */
  abstract releaseLock: (conn: Connection) => Promise<void>;
  /** Index identity. */
  abstract indexKey: (item: DbIndex) => string;
  /** Column definition differences. */
  abstract columnChanges: (a: DbColumn, b: DbColumn) => string[];

  // ─── Remaining dialect translation surface ────────────────────────────────────────────────────
  /** Driver error to OrmError mapping: dialect-specific and supplied by subclasses. */
  abstract translate: (error: any) => Error;
  /** Table-creation DDL: dialect-specific SQL syntax supplied by subclasses. */
  abstract schemaDDL: (schema: Schema) => string[];
  /** Migration diff SQL rendering: dialect-specific and supplied by subclasses. */
  abstract renderDiffSQL: (created: DbTable[], dropped: DbTable[], changed: TableChange[]) => Section[];
}

/**
 * 方言实现对 core 暴露的完整契约：标准转换 + 能力声明 + 错误翻译。
 * 公开的 `Dialect` 类型不变，这里只是 core 内部更宽的视图。
 * Full contract exposed by dialect implementations to core: standard translation + capabilities + error translation.
 * The public `Dialect` type is unchanged; this is only core's wider internal view.
 */
export interface DialectImplementation extends Dialect {
  readonly capabilities: Capabilities;
  readonly translate: (error: any) => Error;
}

/**
 * 迁移侧对 core 暴露的方言契约：标准迁移管线需要的全部翻译。
 * Dialect contract exposed to core for migrations: all translations required by the standard migration pipeline.
 */
export interface MigrationDialect extends Dialect {
  readonly providerId: string;
  readonly param: (index: number) => string;
  readonly now: () => string;
  readonly describe: (ds: Datasource) => string;
  readonly parseDatasource: (url: string, root: string) => Datasource;
  readonly connectMigration: (ds: Datasource) => Promise<Connection>;
  readonly connectOrCreate: (ds: Datasource) => Promise<{ conn: Connection; created: boolean }>;
  readonly databaseExists: (ds: Datasource) => Promise<boolean>;
  readonly clearDatabase: (conn: Connection) => Promise<void>;
  readonly createScratch: (base: Datasource, shadow?: Datasource) => Promise<Scratch>;
  readonly introspect: (conn: Connection) => Promise<DbModel>;
  readonly schemaDDL: (schema: Schema) => string[];
  readonly renderDiffSQL: (created: DbTable[], dropped: DbTable[], changed: TableChange[]) => Section[];
  readonly historyDDL: (table: string) => string;
  readonly historyExists: (conn: Connection) => Promise<boolean>;
  readonly runScriptAtomically: (conn: Connection, sql: string) => Promise<void>;
  readonly acquireLock: (conn: Connection) => Promise<void>;
  readonly releaseLock: (conn: Connection) => Promise<void>;
  readonly indexKey: (item: DbIndex) => string;
  readonly columnChanges: (a: DbColumn, b: DbColumn) => string[];
}
