import { fail } from "../../shared/errors.js";
import { connectionURL, countParameter, defaultPoolSize, parameterValue } from "../../shared/index.js";

/**
 * MySQL/MariaDB 驱动细节：标识符引用、连接 URL 解析与连接池参数。
 * 只在本适配器内部使用，不从适配器入口导出。
 *
 * MySQL/MariaDB driver details: identifier quoting, connection URL parsing, and pool parameters.
 * Internal to this adapter; not exported from its entry point.
 */

/**
 * 标识符引用：反引号风格，转义内部反引号。
 * Identifier quoting: backtick style, escaping embedded backticks.
 */
export const quoteMysqlIdentifier = (name: string) => {
  return "`" + name.replaceAll("`", "``") + "`";
};

/**
 * URL 携带的 mariadb 驱动选项；授权部分由适配器固定。
 * mariadb driver options carried by the URL; the authority is fixed by the adapter.
 */
export interface MysqlConnectionOptions {
  [driverOption: string]: any;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * 解析后的 MySQL URL：适配器从 `url` 读取连接池设置，并使用 `options` 连接。
 * A parsed MySQL URL: the adapter reads the pool settings from `url` and connects with `options`.
 */
export interface MySQLConnection {
  url: URL;
  options: MysqlConnectionOptions;
}

/**
 * 解析 MySQL 连接 URL：授权部分固定，查询参数原样交给驱动。
 * Parses a MySQL connection URL: the authority is fixed and query parameters pass through to the driver.
 */
export function mysqlConnection(value: unknown): MySQLConnection {
  const url = connectionURL(value, ["mysql:", "mariadb:"]);
  const decode = (part: string): string => {
    try {
      return decodeURIComponent(part);
    } catch {
      return fail("Invalid connection URL");
    }
  };
  const options: Record<string, any> = {};
  for (const [key, val] of url.searchParams) {
    if (["host", "port", "user", "password", "database", "socketPath", "uri"].includes(key)) {
      fail("Connection authority cannot be overridden by query parameters");
    }
    options[key] = parameterValue(key, val);
  }
  return {
    url,
    options: {
      ...options,
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || 3306),
      user: decode(url.username),
      password: decode(url.password),
      database: decode(url.pathname.slice(1)),
    },
  };
}

/**
 * mariadb 连接池参数，名称与驱动完全一致；`idleTimeout` 单位为秒。
 * mariadb pool parameters, named exactly as the driver names them; `idleTimeout` is in seconds.
 */
export interface MariadbPoolSizing {
  connectionLimit?: number;
  minimumIdle?: number;
  acquireTimeout?: number;
  idleTimeout?: number;
}

/**
 * mariadb 的连接池参数：驱动参数名直接用于连接 URL，`idleTimeout` 单位为秒。
 * Pool parameters for mariadb: the driver names go straight into the connection URL, `idleTimeout` in seconds.
 */
export function mariadbPool(url: URL): MariadbPoolSizing {
  const connectionLimit = countParameter(url, "connectionLimit", 1) ?? defaultPoolSize();
  const minimumIdle = countParameter(url, "minimumIdle", 0);
  if (minimumIdle !== undefined && minimumIdle > connectionLimit) {
    fail("minimumIdle cannot exceed connectionLimit");
  }
  const acquireTimeout = countParameter(url, "acquireTimeout", 1);
  const idleTimeout = countParameter(url, "idleTimeout", 0);
  return {
    connectionLimit,
    ...(minimumIdle === undefined ? {} : { minimumIdle }),
    ...(acquireTimeout === undefined ? {} : { acquireTimeout }),
    ...(idleTimeout === undefined ? {} : { idleTimeout }),
  };
}
