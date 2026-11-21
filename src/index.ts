/**
 * `@ofis/tsorm` 根入口：生成客户端依赖这里导出的类型，符号清单为公开 API 契约。
 *
 * 公开符号（值）：internalCreateClient、OrmError、DbNull、JsonNull、sql
 * 公开符号（类型）：ClientOptions、Client 及下列全部 type 导出
 * 本文件不删减任何导出；schema helper 与适配器连接接口均为内部实现，见各自模块的 @internal 标注。
 *
 * `@ofis/tsorm` root entry: generated clients depend on the types exported here, and the symbol list is the public API contract.
 *
 * Public value symbols: internalCreateClient, OrmError, DbNull, JsonNull, sql
 * Public type symbols: ClientOptions, Client, and all type exports below
 * No exports are removed from this file; schema helpers and adapter connection interfaces are internal implementation details, as marked by @internal in their modules.
 */
import * as core from "./core/client.js";
import { adapterFor } from "./adapters/registry.js";
import type { Client, Spec } from "./core/client-types.js";
import type { Schema } from "./schema/model.js";

// ─── 运行时值：客户端构造、错误与哨兵 ──────────────────────────────────────
// ─── Runtime values: client construction, errors, and sentinels ────────────
export { OrmError, DbNull, JsonNull } from "./shared/index.js";

/**
 * {@link internalCreateClient} 的选项；适配器始终根据连接 URL 选择。
 * Options for {@link internalCreateClient}; the adapter is always chosen from the connection URL.
 */
export type ClientOptions = Omit<core.ClientOptions, "adapter"> & {
  /**
   * 连接 URL；根据协议选择适配器，所有驱动选项均来自该 URL。
   * Connection URL; the adapter is chosen from the scheme and all driver options come from it.
   */
  connection: string;
};
/**
 * 供生成客户端使用的内部组装辅助函数。它根据显式 schema 和 `connection` URL 同步创建客户端，
 * 接受 `postgresql://`、`mysql://`（或 `mariadb://`）以及 SQLite `file:` URL，并根据协议选择适配器。
 * 调用不会打开连接或加载驱动，二者都推迟到首次数据库操作。
 *
 * 此函数仅供生成客户端组装及其他高级用途。常规用户应调用生成客户端导出的 `createClient(options)`。
 *
 * Internal assembly helper used by generated clients. It creates a client synchronously from an
 * explicit schema and a `connection` URL: `postgresql://`, `mysql://` and SQLite `file:` URLs are
 * accepted: `postgresql://`, `mysql://` (or `mariadb://`) and `file:`. The adapter is picked
 * from the scheme. The call opens no connection and loads no driver: both happen on the first
 * database operation.
 *
 * This function is for generated-client assembly and other advanced use only. Regular users should
 * call the `createClient(options)` exported by their generated client instead.
 */
export function internalCreateClient<S extends Spec = Spec>(schema: Schema, options: ClientOptions): Client<S> {
  return core.createClient<S>(schema, { adapter: adapterFor(options.connection), logger: options.logger, maxAffected: options.maxAffected });
}

// ─── 客户端与核心契约类型 ──────────────────────────────────────────────────
// ─── Client and core contract types ────────────────────────────────────────
export type { Client, TxClient, Spec, Query, Payload, Where, OrderBy, JsonFilter } from "./core/client-types.js";
export type { Adapter, RuntimeAdapter, Dialect, Session, CompiledSQL, QueryResult, Capabilities, TransactionOptions, IsolationLevel } from "./core/adapter.js";
export type { Logger, ClientEvent } from "./core/events.js";
export type { FieldUpdate, DecimalUpdate, Invalid } from "./core/client-types.js";
export type { OmitFields, GlobalOmit, WithOmit, SortOrder } from "./core/client-types.js";
export type { DeletedMode } from "./query/predicates.js";

// ─── 原生查询 ─────────────────────────────────────────────────────────────
// ─── Raw queries ───────────────────────────────────────────────────────────
export { sql } from "./core/raw.js";
export type { SqlQuery, RawClient } from "./core/raw.js";

// ─── 分析与扩展 ───────────────────────────────────────────────────────────
// ─── Analytics and extensions ──────────────────────────────────────────────
export type { AggregateArgs, AggregateResult, GroupByArgs, GroupByResult } from "./core/analytics.js";
export type { Virtuals, WithVirtuals } from "./core/client-types.js";

// ─── 公共值类型与结构 ─────────────────────────────────────────────────────
// ─── Public value types and structures ─────────────────────────────────────
export type { JsonInput, JsonShape } from "./shared/index.js";
export type { Schema } from "./schema/model.js";
