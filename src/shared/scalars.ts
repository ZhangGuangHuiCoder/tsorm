import { encodeJson, decodeJson } from './json.js';
import { localDateTime, validateDateTime } from './datetime.js';
import type { Table, Column } from '../schema/index.js';
import { OrmError, fail } from './errors.js';
export function safeInteger(v: any): number {
  if ((typeof v === 'string' && /^-?\d+$/.test(v)) || typeof v === 'bigint') {
    const n = BigInt(v);
    if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER))
      throw new OrmError('NUMERIC_OVERFLOW', 'Integer exceeds JavaScript safe range');
  }
  const n = Number(v);
  if (!Number.isSafeInteger(n))
    throw new OrmError('NUMERIC_OVERFLOW', 'Integer exceeds JavaScript safe range');
  return n;
}
export function encode(c: Column, value: any): any {
  if (c.type === 'json') return encodeJson(c.json!, value, c.nullable, c.name);
  if (value === null) {
    if (!c.nullable) fail(`${c.name} cannot be null`);
    return null;
  }
  if (c.type === 'bytes') {
    if (!(value instanceof Uint8Array)) fail(`Invalid value for ${c.name}: expected a Uint8Array`);
    return value;
  }
  if (c.type === 'date') return localDateTime(value);
  if (c.type === 'bigint') return encodeBigInt(c, value);
  if (c.type === 'decimal') return encodeDecimal(c, value);
  const expected = ['int', 'number'].includes(c.type) ? 'number' : c.type;
  if (
    typeof value !== expected ||
    (expected === 'number' &&
      (!Number.isFinite(value) || (c.type === 'int' && !Number.isSafeInteger(value)))) ||
    (c.enum && !c.enum.includes(value))
  )
    fail(`Invalid value for ${c.name}`);
  if (c.type === 'string' && c.maxLength !== undefined && [...value].length > c.maxLength)
    fail(`${c.name} exceeds string limit of ${c.maxLength} characters`);
  return c.type === 'boolean' ? Number(value) : value;
}
export function decode(t: Table, raw: any): any {
  const result: any = {};
  for (const [k, c] of Object.entries(t.columns)) {
    const value = raw[k];
    if (c.type === 'json') {
      result[k] = decodeJson(c.json!, value, c.nullable, k);
      continue;
    }
    if (value === null) {
      result[k] = null;
      continue;
    }
    switch (c.type) {
      case 'date': result[k] = validateDateTime(value); break;
      case 'int': result[k] = safeInteger(value); break;
      case 'bigint': result[k] = decodeBigInt(value); break;
      case 'decimal': result[k] = decodeDecimal(c, value); break;
      case 'number': result[k] = finiteNumber(value); break;
      case 'boolean': result[k] = !!value; break;
      case 'bytes': result[k] = toBytes(value); break;
      // Strings and enum unions are already text.
      default: result[k] = value;
    }
  }
  return result;
}

function encodeBigInt(c: Column, value: any): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  return fail(`Invalid value for ${c.name}: expected a bigint or a safe integer`);
}
export function decodeBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if ((typeof value === 'number' && Number.isInteger(value)) || (typeof value === 'string' && /^-?\d+$/.test(value)))
    return BigInt(value);
  throw new OrmError('INVALID_DATABASE_VALUE', 'Invalid bigint value from the database');
}
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
/** A finite number in plain positional notation; String() switches to exponents below 1e-6 and from 1e21. */
function plainNumber(value: number): string {
  const text = String(value);
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!match) return text;
  const [, sign, head, tail = '', power] = match;
  const digits = head + tail;
  const point = 1 + Number(power);
  return (
    sign +
    (point <= 0
      ? '0.' + '0'.repeat(-point) + digits
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : digits.slice(0, point) + '.' + digits.slice(point))
  );
}
/** Decimals travel as strings so no precision is lost on the way to the database. */
function encodeDecimal(c: Column, value: any): string {
  const text =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'number' && Number.isFinite(value)
        ? plainNumber(value)
        : '';
  const match = DECIMAL.exec(text);
  if (!match) return fail(`Invalid value for ${c.name}: expected a decimal string or finite number`);
  const [, sign, whole, fraction = ''] = match;
  if (c.precision !== undefined) {
    const integerDigits = whole.replace(/^0+(?=\d)/, '').length;
    if (fraction.length > c.scale! || (whole !== '0' && integerDigits > c.precision - c.scale!))
      fail(`${c.name} exceeds decimal(${c.precision}, ${c.scale})`);
  }
  return sign + whole + (fraction ? '.' + fraction : '');
}
export function decodeDecimal(c: Column, value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new OrmError('INVALID_DATABASE_VALUE', 'Invalid decimal value');
    // toFixed also switches to exponents from 1e21.
    return c.scale !== undefined && Math.abs(value) < 1e21 ? value.toFixed(c.scale) : plainNumber(value);
  }
  if (typeof value === 'bigint') return c.scale ? value + '.' + '0'.repeat(c.scale) : String(value);
  if (typeof value === 'string' && DECIMAL.test(value)) return value;
  throw new OrmError('INVALID_DATABASE_VALUE', 'Invalid decimal value from the database');
}

export function finiteNumber(value: unknown): number {
  const result = Number(value);
  if (!Number.isFinite(result))
    throw new OrmError('NUMERIC_OVERFLOW', 'Number exceeds finite JavaScript range');
  return result;
}
/** Normalizes any driver binary (Buffer, Uint8Array, ArrayBuffer) to a plain Uint8Array view. */
export function toBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new OrmError('INVALID_DATABASE_VALUE', 'Invalid bytes value from the database');
}
