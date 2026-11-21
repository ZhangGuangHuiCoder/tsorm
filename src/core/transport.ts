import type { Adapter, QueryResult, RuntimeAdapter, Session, TransactionOptions } from "./adapter.js";
import type { DialectImplementation } from "./dialect.js";
import { fail } from "../shared/index.js";

/**
 * 标准连接与会话能力：池化与单连接两种传输的骨架都在这里，
 * 方言只提供「怎么执行、怎么开关事务、怎么归还连接」这些命令。
 * Standard connection and session capabilities: the shared skeleton for pooled and single-connection transports lives here;
 * dialects provide only commands for execution, transaction begin/end, and connection return.
 */

// ─── Pooled connection open flow ───────────────────────────────────────────
/**
 * 池化方言连接的声明式描述。每个字段都是普通
 * 闭包：不依赖 `this`，因此整个配置都可捕获并复用。
 * 驱动始终只通过 `loadDriver` 访问，既保留动态导入的打包行为，
 * 也使通用流程无需引入驱动。
 * Declarative description of a pooled dialect connection. Every field is a plain
 * closure: no `this`, so the whole config can be captured and reused. The driver
 * is only ever reached through `loadDriver`, which keeps dynamic-import bundling
 * intact and the generic flow free of driver imports.
 */
export interface ConnectConfig {
  /** Error prefix, used to build "Provide <label> connection options". */
  label: string;
  /** URL → pool arguments plus any dialect extras the later hooks need. */
  parse: (raw: string) => any;
  /** The single lazy driver import point. */
  loadDriver: () => Promise<any>;
  /** Build the pool and attach dialect-specific listeners. */
  createPool: (driver: any, poolArg: any) => any;
  /** Lease one connection and apply session settings; may use `parsed`. */
  acquire: (pool: any, parsed: any) => Promise<any>;
  /** Return a probe connection to the pool. */
  release: (connection: any) => void | Promise<void>;
  /** Version / additional server checks; throws the verbatim dialect error. */
  probe: (connection: any, parsed: any) => Promise<void>;
  /** Wrap the validated pool into the dialect runtime. */
  makeRuntime: (pool: any, driver: any, parsed: any) => RuntimeAdapter;
  /** Driver error → OrmError mapping. */
  translate: (error: any) => Error;
}

/**
 * 共享连接骨架：校验 → 解析 → 懒加载驱动 → 创建连接池 →
 * 租借 → 探测 → 归还 → 运行时，并通过唯一失败路径关闭
 * 连接池和翻译错误。各方言注入自身差异；
 * 同步存储保留各自的连接器。
 * Shared connect skeleton: validate → parse → lazy-load driver → create pool →
 * acquire → probe → release → runtime, with a single failure path that closes the
 * pool and translates the error. Each dialect injects its own differences;
 * synchronous stores keep their own connector.
 */
export async function openRuntime(cfg: ConnectConfig, raw: string | undefined): Promise<RuntimeAdapter> {
  if (!raw) {
    fail(`Provide ${cfg.label} connection options`);
  }
  const parsed = cfg.parse(raw as string);
  const driver = await cfg.loadDriver();
  const pool = cfg.createPool(driver, parsed.poolArg);
  try {
    const connection = await cfg.acquire(pool, parsed);
    try {
      await cfg.probe(connection, parsed);
    } finally {
      await cfg.release(connection);
    }
  } catch (error) {
    await pool.end();
    throw cfg.translate(error);
  }
  return cfg.makeRuntime(pool, driver, parsed);
}

// ─── Session and pool runtimes ─────────────────────────────────────────────

/**
 * 池化连接的标准会话命令。
 * Standard session commands for pooled connections.
 */
export interface SessionHooks {
  /** Executes one statement and returns a standard result. */
  execute(connection: any, sql: string, values: any[]): Promise<QueryResult>;
  /** Begins a transaction, optionally with an isolation level and read-only flag. */
  begin(connection: any, options?: TransactionOptions & { readOnly?: boolean }): Promise<void>;
  commit(connection: any): Promise<void>;
  rollback(connection: any): Promise<void>;
  /** Best-effort cancellation of the running server statement over a separate connection. */
  cancel?(connection: any): Promise<void>;
}

/**
 * 池化连接的标准运行时命令：租借、归还、关闭。
 * Standard runtime commands for pooled connections: lease, release, and close.
 */
export interface PoolHooks extends SessionHooks {
  /** Leases a connection from the pool and applies session settings. */
  lease(pool: any): Promise<any>;
  /** Returns a connection; broken means it can no longer be used. */
  release(connection: any, broken?: boolean): void | Promise<void>;
  /** Closes the entire pool. */
  close(pool: any): Promise<void>;
}

/**
 * 标准池化运行时：租一条连接开一会话，归还或销毁，最后关池。
 * Standard pooled runtime: lease a connection for a session, return or destroy it, then close the pool.
 */
export function createPoolRuntime(dialect: DialectImplementation, hooks: PoolHooks, pool: any): RuntimeAdapter {
  return {
    dialect,
    capabilities: dialect.capabilities,
    translate: dialect.translate,
    acquire: async (): Promise<Session> => {
      const connection = await hooks.lease(pool);
      return {
        execute: async ({ text, values }) => hooks.execute(connection, text, values),
        begin: async (options) => hooks.begin(connection, options),
        commit: async () => hooks.commit(connection),
        rollback: async () => hooks.rollback(connection),
        release: async (broken?: boolean) => hooks.release(connection, broken),
        cancel: hooks.cancel
          ? async () => {
              await hooks.cancel!(connection);
            }
          : undefined,
      };
    },
    close: async (): Promise<void> => {
      await hooks.close(pool);
    },
  };
}

/**
 * 标准适配器装配：方言 + 连接入口 → 公开的 Adapter。
 * Standard adapter assembly: dialect + connection entry point → public Adapter.
 */
export function createAdapter(dialect: DialectImplementation, connect: () => RuntimeAdapter | Promise<RuntimeAdapter>): Adapter {
  return {
    name: dialect.name,
    dialect,
    capabilities: dialect.capabilities,
    translate: dialect.translate,
    connect,
  };
}
