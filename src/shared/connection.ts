import { availableParallelism } from "node:os";
import { fail } from "./errors.js";

// ─── Connection URLs ───────────────────────────────────────────────────────
/**
 * A query string decodes `+` to a space (form encoding), so `timezone=+08:00` arrives as ` 08:00`.
 * The value is a timezone, so a leading space followed by an offset keeps its sign.
 */
function timezone(value: string): string {
  return value.replace(/^ (\d{1,2}(?::?\d{2})?)$/, "+$1");
}
/**
 * 查询参数保留其 URL 类型：布尔值和安全整数会被转换，其余保持字符串。
 * Query parameters keep their URL type: booleans and safe integers are typed; everything else stays a string.
 */
export function parameterValue(key: string, value: string): unknown {
  if (key === "timezone") {
    return timezone(value);
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value;
  }
  return value;
}
/**
 * 在分配驱动资源前解析连接 URL；协议必须包含在 `protocols` 中。
 * Parse a connection URL before allocating driver resources; the protocol must be one of `protocols`.
 */
export function connectionURL(value: unknown, protocols: string[]): URL {
  if (typeof value !== "string" || !value) {
    return fail("Connection requires a URL string");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("Invalid connection URL");
  }
  if (!protocols.includes(url.protocol)) {
    fail("Unsupported connection URL protocol");
  }
  if (!url.pathname.slice(1)) {
    fail("Connection URL requires a database name");
  }
  return url;
}

// ─── Pool sizing ───────────────────────────────────────────────────────────
/**
 * 默认连接池大小：每个 CPU 核心两个连接，再加一个。
 * Default pool size: two connections per CPU core plus one.
 */
export const defaultPoolSize = () => 2 * availableParallelism() + 1;
/**
 * 读取整数 URL 参数并将其移除；对于可为零的计数，`floor` 为 0。
 * Reads an integer URL parameter and removes it; `floor` is 0 for counts that may be zero.
 */
export function countParameter(url: URL, name: string, floor: number): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) {
    return undefined;
  }
  url.searchParams.delete(name);
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < floor) {
    fail(`${name} requires ${floor === 0 ? "a non-negative" : "a positive"} integer`);
  }
  return value;
}
