import { fail } from "./errors.js";
/** Query parameters keep their URL type: booleans and safe integers are typed; everything else stays a string. */
export function parameterValue(value: string): unknown {
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
/** Parse a connection URL before allocating driver resources. */
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
export function mysqlConnection(value: unknown) {
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
    options[key] = parameterValue(val);
  }
  return {
    ...options,
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 3306),
    user: decode(url.username),
    password: decode(url.password),
    database: decode(url.pathname.slice(1)),
  };
}
