import type { Column, Table } from "../schema/model.js";
import { fail, OrmError } from "./errors.js";
import { decodeJson, encodeJson } from "./json.js";

// ─── Datetime codec ────────────────────────────────────────────────────────
/** Requires a valid instant with a UTC year in 0001..9999. */
function supported(instant: Date): boolean {
  const year = instant.getUTCFullYear();
  return !Number.isNaN(instant.getTime()) && year >= 1 && year <= 9999;
}
/** Stored text must be timezone-aware ISO 8601: `Z` or `±HH:MM`. */
const instantText = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/;
const isDigitCode = (code: number): boolean => {
  return code >= 48 && code <= 57;
};
/**
 * Fast path for canonical UTC ISO `YYYY-MM-DDTHH:mm:ss.sssZ` (24 characters).
 * Any mismatch returns undefined, so `storedInstant` falls back to the original regex path, preserving semantics and error messages.
 */
function canonicalInstant(value: string): Date | undefined {
  if (value.length !== 24) {
    return undefined;
  }
  // Validate separators character by character: - - T : : . Z
  if (value.charCodeAt(4) !== 45 || value.charCodeAt(7) !== 45 || value.charCodeAt(10) !== 84 || value.charCodeAt(13) !== 58 || value.charCodeAt(16) !== 58 || value.charCodeAt(19) !== 46 || value.charCodeAt(23) !== 90) {
    return undefined;
  }
  // The other 17 characters must be digits; explicit checks are faster than a loop with skip logic.
  if (
    !isDigitCode(value.charCodeAt(0)) ||
    !isDigitCode(value.charCodeAt(1)) ||
    !isDigitCode(value.charCodeAt(2)) ||
    !isDigitCode(value.charCodeAt(3)) ||
    !isDigitCode(value.charCodeAt(5)) ||
    !isDigitCode(value.charCodeAt(6)) ||
    !isDigitCode(value.charCodeAt(8)) ||
    !isDigitCode(value.charCodeAt(9)) ||
    !isDigitCode(value.charCodeAt(11)) ||
    !isDigitCode(value.charCodeAt(12)) ||
    !isDigitCode(value.charCodeAt(14)) ||
    !isDigitCode(value.charCodeAt(15)) ||
    !isDigitCode(value.charCodeAt(17)) ||
    !isDigitCode(value.charCodeAt(18)) ||
    !isDigitCode(value.charCodeAt(20)) ||
    !isDigitCode(value.charCodeAt(21)) ||
    !isDigitCode(value.charCodeAt(22))
  ) {
    return undefined;
  }
  // Year 0000 is outside supported's 0001..9999 range; use the regex fallback to preserve error messages.
  if (value.charCodeAt(0) === 48 && value.charCodeAt(1) === 48 && value.charCodeAt(2) === 48 && value.charCodeAt(3) === 48) {
    return undefined;
  }
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? undefined : instant;
}
/**
 * datetime 字段的写入值必须是 Date。
 * Values written to datetime fields must be Date objects.
 */
export function writeInstant(value: unknown, name: string): Date {
  if (!(value instanceof Date) || !supported(value)) {
    return fail(`Invalid value for ${name}: expected a Date`);
  }
  return value;
}
/**
 * datetime 列的写入值：timestamp 列存整数毫秒，文本列的存储形式由方言给出。
 * 存储形态只在这里判定，core 与 query 层只处理 Date 对象。
 * For datetime column writes, timestamp columns store integer milliseconds, while the dialect determines text-column storage.
 * The storage form is decided only here; core and query layers handle Date objects only.
 */
export function encodeInstant(column: Column, value: any, text: (instant: Date) => any): any {
  const instant = writeInstant(value, column.name);
  return column.dateStorage === "timestamp" ? instant.getTime() : text(instant);
}
/**
 * 存储形式（Date、整数毫秒、带时区的 ISO 文本）→ Date。
 * Converts stored forms (Date, integer milliseconds, or timezone-aware ISO text) to Date.
 */
export function storedInstant(value: unknown): Date {
  if (value instanceof Date) {
    return supported(value) ? value : fail("Invalid datetime");
  }
  if (typeof value === "number") {
    const instant = new Date(value);
    return supported(instant) ? instant : fail("Invalid datetime");
  }
  if (typeof value === "string") {
    const fast = canonicalInstant(value);
    if (fast !== undefined) {
      return fast;
    }
    if (instantText.test(value)) {
      const instant = new Date(value);
      return supported(instant) ? instant : fail("Invalid datetime");
    }
  }
  return fail("Invalid datetime");
}
/**
 * 行内 datetime 列的存储值 → Date；timestamp 列先还原成安全整数毫秒。
 * Converts an inline datetime column's stored value to Date; timestamp columns first restore safe integer milliseconds.
 */
export function decodeInstant(column: Column, stored: any): Date {
  return storedInstant(column.dateStorage === "timestamp" ? safeInteger(stored) : stored);
}
/**
 * 单个存储值解码：只处理 datetime 列，NULL 与其它类型原样返回。
 * Decodes one stored value: handles only datetime columns and returns NULL and other types unchanged.
 */
export function decodeDateValue(column: Column, value: any): any {
  return column.type === "datetime" && value != null ? decodeInstant(column, value) : value;
}
/**
 * 分组/游标键：datetime 按毫秒比较，其它类型交给调用方。
 * Grouping/cursor key: compares datetimes by milliseconds and delegates other types to the caller.
 */
export function dateGroupKey(column: Column, value: any, fallback: (column: Column, value: any) => string): string {
  return column.type === "datetime" && value != null ? String(storedInstant(value).getTime()) : fallback(column, value);
}

// ─── Scalar codec ──────────────────────────────────────────────────────────
/**
 * 仅接受 number、bigint 或纯十进制字符串形式的安全整数，其它值抛出 NUMERIC_OVERFLOW；负零归一化为 0。
 * Accepts only a safe integer as a number, bigint or plain decimal string; anything else throws NUMERIC_OVERFLOW. Negative zero normalizes to 0.
 */
export function safeInteger(v: any): number {
  if (typeof v === "bigint" || (typeof v === "string" && /^-?\d+$/.test(v))) {
    const n = BigInt(v);
    if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new OrmError("NUMERIC_OVERFLOW", "Integer exceeds JavaScript safe range");
    }
    return Number(n);
  }
  if (typeof v !== "number" || !Number.isSafeInteger(v)) {
    throw new OrmError("NUMERIC_OVERFLOW", "Expected a safe integer");
  }
  return v === 0 ? 0 : v;
}
export function encode(c: Column, value: any): any {
  if (c.type === "json") {
    return encodeJson(c.json!, value, c.nullable, c.name);
  }
  if (value === null) {
    if (!c.nullable) {
      fail(`${c.name} cannot be null`);
    }
    return null;
  }
  if (c.type === "bytes") {
    if (!(value instanceof Uint8Array)) {
      fail(`Invalid value for ${c.name}: expected a Uint8Array`);
    }
    return value;
  }
  if (c.type === "datetime") {
    // The adapter determines the storage form; this only ensures an absolute instant.
    if (!(value instanceof Date)) {
      fail(`Invalid value for ${c.name}: expected a Date`);
    }
    return value;
  }
  if (c.type === "bigint") {
    return encodeBigInt(c, value);
  }
  if (c.type === "decimal") {
    return encodeDecimal(c, value);
  }
  let expected = c.type;
  if (c.type === "int" || c.type === "number") {
    expected = "number";
  } else if (c.type === "text") {
    // text is unbounded, so it shares the string value contract without the length check.
    expected = "string";
  }
  if (typeof value !== expected || (expected === "number" && (!Number.isFinite(value) || (c.type === "int" && !Number.isSafeInteger(value)))) || (c.enum && !c.enum.includes(value))) {
    fail(`Invalid value for ${c.name}`);
  }
  if (c.type === "string" && c.maxLength !== undefined) {
    let length = 0;
    for (const _ of value) {
      if (++length > c.maxLength) {
        fail(`${c.name} exceeds string limit of ${c.maxLength} characters`);
      }
    }
  }
  return c.type === "boolean" ? Number(value) : value;
}
/** Column metadata is fixed per table; cache expanded entries to avoid repeating Object.entries for every row. */
const decodedColumns = new WeakMap<Table, [string, Column][]>();
/**
 * Row decoding modes:
 * - `inlineDates`: decode datetime directly in the column loop, avoiding a second row pass.
 * - `normalize`: also normalize raw driver values (decimal text to BigInt and large integers to safe integers).
 */
type DecodeMode = "inlineDates" | "normalize";
export function decode(t: Table, raw: any, mode: DecodeMode): any {
  let columns = decodedColumns.get(t);
  if (columns === undefined) {
    columns = Object.entries(t.columns);
    decodedColumns.set(t, columns);
  }
  const normalize = mode === "normalize";
  const result: any = {};
  for (const [k, c] of columns) {
    let value = raw[k];
    // Normalization must precede the JSON branch to preserve normalize-then-decode semantics.
    if (normalize) {
      if (c.type === "decimal" && typeof value === "string" && /^-?\d+$/.test(value)) {
        value = BigInt(value);
      } else if (typeof value === "bigint" && c.type !== "bigint" && c.type !== "decimal") {
        value = safeInteger(value);
      }
    }
    if (c.type === "json") {
      result[k] = decodeJson(c.json!, value, c.nullable, k);
      continue;
    }
    if (value === null) {
      result[k] = null;
      continue;
    }
    switch (c.type) {
      case "datetime":
        result[k] = value != null ? decodeInstant(c, value) : value;
        break;
      case "int":
        result[k] = safeInteger(value);
        break;
      case "bigint":
        result[k] = decodeBigInt(value);
        break;
      case "decimal":
        // Reuse decodeDecimal to apply scale to integer-string decimals instead of assembling strings here.
        result[k] = decodeDecimal(c, value);
        break;
      case "number":
        result[k] = finiteNumber(value);
        break;
      case "boolean":
        result[k] = !!Number(value);
        break;
      case "bytes":
        result[k] = toBytes(value);
        break;
      // Strings and enum unions are already text.
      default:
        result[k] = value;
    }
  }
  return result;
}
/**
 * 归一化行解码单遍入口：原始值归一化与 datetime 解码合并进 `decode` 的列循环，且不修改入参。
 * Single-pass normalized row decoding: raw-value normalization and datetime decoding are folded into `decode`'s column loop without mutating the input.
 */
export const decodeNormalizedRow = (t: Table, raw: any): any => {
  return decode(t, raw, "normalize");
};

function encodeBigInt(c: Column, value: any): bigint {
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  return fail(`Invalid value for ${c.name}: expected an integer string, bigint or safe integer`);
}
export function decodeBigInt(value: unknown): string {
  if (typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new OrmError("NUMERIC_OVERFLOW", "Bigint received as an unsafe JavaScript number");
  }
  if ((typeof value === "number" && Number.isSafeInteger(value)) || (typeof value === "string" && /^-?\d+$/.test(value))) {
    return String(BigInt(value));
  }
  throw new OrmError("INVALID_DATABASE_VALUE", "Invalid bigint value from the database");
}
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
/** A finite number in plain positional notation; String() switches to exponents below 1e-6 and from 1e21. */
function plainNumber(value: number): string {
  const text = String(value);
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!match) {
    return text;
  }
  const [, sign, head, tail = "", power] = match;
  const digits = head + tail;
  const point = 1 + Number(power);
  if (point <= 0) {
    return sign + "0." + "0".repeat(-point) + digits;
  }
  if (point >= digits.length) {
    return sign + digits + "0".repeat(point - digits.length);
  }
  return sign + digits.slice(0, point) + "." + digits.slice(point);
}
/** Decimals travel as strings so no precision is lost on the way to the database. */
function encodeDecimal(c: Column, value: any): string {
  let text = "";
  if (typeof value === "string") {
    text = value.trim();
  } else if (typeof value === "number" && Number.isFinite(value)) {
    text = plainNumber(value);
  }
  const match = DECIMAL.exec(text);
  if (!match) {
    return fail(`Invalid value for ${c.name}: expected a decimal string or finite number`);
  }
  const [, sign, whole, fraction = ""] = match;
  if (c.precision !== undefined) {
    const integerDigits = whole.replace(/^0+/, "").length;
    if (fraction.length > c.scale! || integerDigits > c.precision - c.scale!) {
      fail(`${c.name} exceeds decimal(${c.precision}, ${c.scale})`);
    }
  }
  return sign + whole + (fraction ? "." + fraction : "");
}
export function decodeDecimal(c: Column, value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new OrmError("INVALID_DATABASE_VALUE", "Invalid decimal value");
    }
    // toFixed also switches to exponents from 1e21.
    return c.scale !== undefined && Math.abs(value) < 1e21 ? value.toFixed(c.scale) : plainNumber(value);
  }
  if (typeof value === "bigint") {
    return c.scale ? value + "." + "0".repeat(c.scale) : String(value);
  }
  // Aggregates over integer-valued decimals arrive as integer strings; apply the declared scale.
  if (typeof value === "string" && DECIMAL.test(value)) {
    return c.scale && /^-?\d+$/.test(value) ? value + "." + "0".repeat(c.scale) : value;
  }
  throw new OrmError("INVALID_DATABASE_VALUE", "Invalid decimal value from the database");
}

const NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;
/**
 * 仅接受有限数字或纯数字字符串（带符号、小数或指数），其它值抛出 INVALID_DATABASE_VALUE；负零归一化为 0。
 * Accepts only a finite number or a plain numeric string (signed, fractional or exponent); anything else throws INVALID_DATABASE_VALUE. Negative zero normalizes to 0.
 */
export function finiteNumber(value: unknown): number {
  if (typeof value !== "number" && !(typeof value === "string" && NUMBER.test(value.trim()))) {
    throw new OrmError("INVALID_DATABASE_VALUE", "Invalid number value from the database");
  }
  const result = Number(value);
  if (!Number.isFinite(result)) {
    throw new OrmError("INVALID_DATABASE_VALUE", "Invalid number value from the database");
  }
  return result === 0 ? 0 : result;
}
/**
 * 将任意驱动二进制值（Buffer、Uint8Array、ArrayBuffer）归一化为普通 Uint8Array 视图。
 * Normalizes any driver binary (Buffer, Uint8Array, ArrayBuffer) to a plain Uint8Array view.
 */
export function toBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new OrmError("INVALID_DATABASE_VALUE", "Invalid bytes value from the database");
}

/**
 * 解码值与原始驱动投影共用的规范关系键。
 * Canonical relation key shared by decoded values and raw driver projections.
 */
export function scalarGroupKey(c: Column, value: any): string {
  if (value === null) {
    return "null";
  }
  if (c.type === "boolean") {
    return String(Number(value));
  }
  if (c.type === "decimal") {
    const text = decodeDecimal(c, value);
    const negative = text.startsWith("-");
    const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
    const integer = whole.replace(/^0+/, "") || "0";
    const digits = fraction.replace(/0+$/, "");
    return (negative && (integer !== "0" || digits) ? "-" : "") + integer + (digits ? "." + digits : "");
  }
  return String(value);
}
/**
 * 驱动将整数返回为 bigint；在列类型解码前，行内以文本保存。
 * Drivers return integers as bigint; rows carry them as text until the column type decodes them.
 */
export const bigintsAsText = (row: Record<string, unknown>) => {
  let result: Record<string, unknown> | undefined;
  // for-in is about 4x faster than Object.entries; Object.hasOwn filters the prototype chain, preserving the same key set as entries.
  for (const key in row) {
    if (!Object.hasOwn(row, key)) {
      continue;
    }
    const value = row[key];
    if (typeof value === "bigint") {
      result ??= { ...row };
      result[key] = String(value);
    }
  }
  return result ?? row;
};
