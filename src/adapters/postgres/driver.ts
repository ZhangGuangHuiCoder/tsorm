import { fail } from "../../shared/errors.js";
import { countParameter, defaultPoolSize } from "../../shared/index.js";
import { literal as ansiLiteral } from "../../shared/sql.js";

/**
 * PostgreSQL 驱动细节：SQL 字面量与连接池参数。
 * 只在本适配器内部使用，不从适配器入口导出。
 *
 * PostgreSQL driver details: SQL literals and connection pool parameters.
 * Internal to this adapter; not exported from its entry point.
 */

/**
 * PostgreSQL 方言的 SQL 字面量：布尔值写成 TRUE/FALSE，其余复用共享转义规则。
 * SQL literals for the PostgreSQL dialect: booleans use TRUE/FALSE; other values reuse shared escaping.
 */
export const postgresLiteral = (v: any) => {
  return typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : ansiLiteral(v);
};

/**
 * node-postgres 连接池参数，名称与驱动完全一致；时间单位为毫秒。
 * node-postgres pool parameters, named exactly as the driver names them; times are milliseconds.
 */
export interface PostgresPoolSizing {
  max?: number;
  min?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
}

/**
 * node-postgres 的连接池参数：驱动参数名直接用于连接 URL，时间单位为毫秒。
 * Pool parameters for node-postgres: the driver names go straight into the connection URL, times in milliseconds.
 */
export function postgresPool(url: URL): PostgresPoolSizing {
  const max = countParameter(url, "max", 1) ?? defaultPoolSize();
  const min = countParameter(url, "min", 0);
  if (min !== undefined && min > max) {
    fail("min cannot exceed max");
  }
  const connectionTimeoutMillis = countParameter(url, "connectionTimeoutMillis", 1);
  const idleTimeoutMillis = countParameter(url, "idleTimeoutMillis", 0);
  return {
    max,
    ...(min === undefined ? {} : { min }),
    ...(connectionTimeoutMillis === undefined ? {} : { connectionTimeoutMillis }),
    ...(idleTimeoutMillis === undefined ? {} : { idleTimeoutMillis }),
  };
}
