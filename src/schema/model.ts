import type { JsonShape, JsonDefinition } from "../shared/index.js";
export type Scalar = "int" | "bigint" | "number" | "decimal" | "string" | "text" | "boolean" | "datetime" | "json" | "bytes";
export type ReferentialAction = "Cascade" | "Restrict" | "NoAction" | "SetNull";
/**
 * 各 ReferentialAction 的 SQL 拼写，由所有方言共享。
 * SQL spelling of each referential action, shared by every dialect.
 */
export const referentialActions: Record<ReferentialAction, string> = {
  Cascade: "CASCADE",
  Restrict: "RESTRICT",
  NoAction: "NO ACTION",
  SetNull: "SET NULL",
};
export interface Column {
  json?: JsonDefinition;
  name: string;
  type: Scalar;
  nullable: boolean;
  primary: boolean;
  auto: boolean;
  unique: boolean;
  default?:
    | string
    | number
    | boolean
    | null
    | {
        fn: "now" | "uuid";
      };
  /** Length of a string column; always set after parsing (default 191). Text columns have no length. */
  maxLength?: number;
  /** decimal(precision, scale) */
  precision?: number;
  scale?: number;
  enum?: string[];
  /** Set to the current time on create and on every update (@updatedAt). */
  updatedAt?: boolean;
  dateStorage?: "string" | "timestamp";
  /** Physical column name (@map). */
  map?: string;
  /** Column comment from the trailing // comment on the field line; dialects without comment support ignore it. */
  comment?: string;
}
export interface Relation {
  name: string;
  target: string;
  many: boolean;
  nullable: boolean;
  owner: boolean;
  source: string;
  foreign: string;
  junction?: string;
  junctionSource?: string;
  junctionTarget?: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  /** Polymorphic owner (`morph` field): the target is dynamic and resolved through the discriminator column at runtime. */
  polymorphic?: true;
  /** Discriminator column name on the polymorphic table; inverse relations fix its value with discriminatorValue. */
  discriminator?: string;
  /** Fixed discriminator value for an inverse relation: the owner model name. */
  discriminatorValue?: string;
}
export interface Table {
  virtuals?: Record<string, { needs: string[]; compute: (row: any) => unknown }>;
  softDelete?: string;
  name: string;
  columns: Record<string, Column>;
  relations: Record<string, Relation>;
  /** Single-column primary key; '' when the model uses a composite @@id. */
  primary: string;
  /** Composite primary key columns (@@id). */
  primaryKey?: string[];
  /** Physical table name (@@map). */
  map?: string;
  /** Table comment from the // comment lines preceding the model; dialects without comment support ignore it. */
  comment?: string;
  /** Global table prefix from the top-level `prefix` statement; prepended to the physical name. */
  prefix?: string;
  unique: string[][];
  indexes: string[][];
  /** Client-wide omit defaults from $extend({ omit }). */
  omit?: Record<string, boolean>;
}
/**
 * 模型的主键列，支持单列或复合主键。
 * Primary key columns of a model, single or composite.
 * @internal 供适配器与迁移模块内部共享，不在包文档承诺的公开 API 范围内。
 * Shared internally by adapters and migrations; not part of the public API promised in the package documentation.
 */
export const internalPrimaryKey = (t: Table): string[] => {
  return t.primaryKey?.length ? t.primaryKey : [t.primary];
};
/**
 * 结果中隐藏的字段：查询自身的 omit 覆盖客户端全局 omit。
 * Fields hidden from a result: the client-wide omit overridden by the query's own.
 * @internal 供查询编译器内部共享，不在包文档承诺的公开 API 范围内。
 * Shared internally by the query compiler; not part of the public API promised in the package documentation.
 */
export const internalOmitted = (t: Table, args: any): Record<string, boolean> | undefined => {
  if (args.select) {
    return undefined;
  }
  if (!t.omit) {
    return args.omit;
  }
  return { ...t.omit, ...args.omit };
};
/**
 * 生成客户端所声明的各模型类型的后缀。
 * Suffixes of the per-model types the generated client declares.
 * @internal 供模型解析器内部共享，不在包文档承诺的公开 API 范围内。
 * Shared internally by the model parser; not part of the public API promised in the package documentation.
 */
export const internalGeneratedSuffixes = ["Row", "Create", "Update", "Unique", "ScalarCreate", "ScalarUpdate"];
/**
 * 默认迁移历史表名。
 * Default migration history table name.
 * @internal 供迁移模块内部共享，不在包文档承诺的公开 API 范围内。
 * Shared internally by migrations; not part of the public API promised in the package documentation.
 */
export const internalHistoryTable = "_tsorm_migrations";
/**
 * 模式 `prefix` 对应的迁移历史表名。
 * Migration history table name for a schema `prefix`.
 * @internal 供迁移模块内部共享，不在包文档承诺的公开 API 范围内。
 * Shared internally by migrations; not part of the public API promised in the package documentation.
 */
export const internalHistoryTableName = (prefix: string | undefined): string => {
  return (prefix ?? "") + internalHistoryTable;
};
/**
 * 模型在客户端属性与选项中的键：模型名首字母小写。
 * Client property and option key of a model: its name with a lowercase first letter.
 * @internal 供解析器与生成器内部共享，不在包文档承诺的公开 API 范围内。
 * Shared internally by the parser and generator; not part of the public API promised in the package documentation.
 */
export const internalModelKey = (t: { name: string }): string => {
  return t.name[0].toLowerCase() + t.name.slice(1);
};
/**
 * 客户端键（如 `user`）所对应的模型。
 * The model addressed by a client key such as `user`.
 * @internal 供查询编译器内部共享，不在包文档承诺的公开 API 范围内。
 * Shared internally by the query compiler; not part of the public API promised in the package documentation.
 */
export const internalModelTable = (schema: Schema, key: string): Table | undefined => {
  return Object.values(schema.tables).find((t) => {
    return internalModelKey(t) === key;
  });
};
/**
 * 物理表名。
 * Physical table name.
 * @internal 供适配器与迁移模块内部共享，不在包文档承诺的公开 API 范围内。
 * Shared internally by adapters and migrations; not part of the public API promised in the package documentation.
 */
export const internalTableName = (t: Table): string => {
  return (t.prefix ?? "") + (t.map ?? t.name);
};
/**
 * 索引与约束名称的基础：表前缀与模型名的组合。
 * Base for index and constraint names: the model name behind the table prefix.
 * @internal 供适配器内部共享，不在包文档承诺的公开 API 范围内。
 * Shared internally by adapters; not part of the public API promised in the package documentation.
 */
export const internalObjectName = (t: Table): string => {
  return (t.prefix ?? "") + t.name;
};
/**
 * 物理列名。
 * Physical column name.
 * @internal 供适配器与迁移模块内部共享，不在包文档承诺的公开 API 范围内。
 * Shared internally by adapters and migrations; not part of the public API promised in the package documentation.
 */
export const internalColumnName = (c: Column): string => {
  return c.map ?? c.name;
};
export interface Schema {
  jsonTypes?: Record<string, JsonShape>;
  /** Physical table name patterns migrations never touch. `*` matches any run of characters; matching ignores case. */
  ignore?: string[];
  /** Global table prefix; it also names the migration history table. */
  prefix?: string;
  version: 1;
  tables: Record<string, Table>;
}
/**
 * 用于判断物理表名是否匹配 `ignore` 模式的谓词。`*` 匹配任意字符序列，其余字符按字面匹配且忽略大小写。
 * Predicate for physical table names covered by `ignore` patterns. `*` matches any
 * run of characters; everything else matches literally, ignoring case.
 * @internal 供模型解析器内部共享，不在包文档承诺的公开 API 范围内。
 * Shared internally by the model parser; not part of the public API promised in the package documentation.
 */
export function internalIgnoredTable(patterns: readonly string[] = []): (name: string) => boolean {
  const regexes = patterns.map((pattern) => {
    const source = pattern
      .split("*")
      .map((part) => {
        return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("[\\s\\S]*");
    return new RegExp("^" + source + "$", "i");
  });
  return (name) => {
    return regexes.some((r) => {
      return r.test(name);
    });
  };
}
