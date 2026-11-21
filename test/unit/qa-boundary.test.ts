// 行解码与 JSON 编码的边界：timestamp、超长 decimal、负零、原型链/不可枚举属性与入参不可变。
import { describe, expect, test } from "bun:test";
import { isDeepStrictEqual } from "node:util";
import { parseSchema, type Column, type Table } from "../../src/schema/index.js";
import { decode, decodeNormalizedRow, encodeJson, type JsonDefinition } from "../../src/shared/index.js";

type Outcome = { ok: true; value: unknown } | { ok: false; code?: string; message?: string };
const outcome = (fn: () => unknown): Outcome => {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { ok: false, code: e.code, message: e.message };
  }
};

const jsonDef: JsonDefinition = {
  root: { kind: "object", fields: { tag: { optional: false, shape: { kind: "primitive", name: "string" } } } },
  definitions: {},
};
const encode = (value: any) => encodeJson(jsonDef, value, false, "meta");

const base = parseSchema("model Q {\n id: int @id @auto\n score: number\n count: int\n amount: decimal(40, 2)\n big: bigint\n createdAt: datetime\n}").tables.Q;
const tsBase = parseSchema("model TS {\n id: int @id @auto\n createdAt: datetime\n}").tables.TS;
const tsTable: Table = {
  ...tsBase,
  columns: { ...tsBase.columns, createdAt: { ...tsBase.columns.createdAt, dateStorage: "timestamp" } as Column },
};
const ISO = new Date(Date.UTC(2024, 0, 1)).toISOString();

describe("JSON 属性校验边界", () => {
  test("自有 getter 被拒绝", () => {
    const value = {
      get tag() {
        return "x";
      },
    };
    expect(outcome(() => encode(value))).toEqual({ ok: false, code: "VALIDATION", message: "meta.tag: expected an enumerable data property" });
  });

  test("自有不可枚举属性被拒绝", () => {
    const value: Record<string, unknown> = { tag: "x" };
    Object.defineProperty(value, "extra", { value: 1, enumerable: false, configurable: true });
    expect(outcome(() => encode(value))).toEqual({ ok: false, code: "VALIDATION", message: "meta.extra: expected an enumerable data property" });
  });

  test("带污染原型的对象在 plain-object 检查处被拒绝", () => {
    const value = Object.assign(Object.create({ inherited: 1 }), { tag: "x" });
    expect(outcome(() => encode(value))).toEqual({ ok: false, code: "VALIDATION", message: "meta: expected plain object" });
  });

  test("Object.create(null) 原型仍视为 plain object，自有属性校验正常", () => {
    const value = Object.assign(Object.create(null), { tag: "x" });
    expect(encode(value)).toBe('{"tag":"x"}');
  });

  test("JSON.parse 的 __proto__ 自有属性按 unknown property 拒绝", () => {
    const value = JSON.parse('{"tag":"x","__proto__":{"polluted":true}}');
    expect(outcome(() => encode(value))).toEqual({ ok: false, code: "VALIDATION", message: "meta.__proto__: unknown property" });
  });
});

describe("SQLite 单遍解码边界", () => {
  test("timestamp 列的整数毫秒解码为 Date", () => {
    const row = { id: 1, createdAt: 1704067200000 };
    expect(decodeNormalizedRow(tsTable, structuredClone(row)).createdAt).toEqual(new Date(1704067200000));
  });

  test("超长整数字符串 decimal 复用 scale 补齐", () => {
    const row = { id: 1, score: 1, count: 1, amount: "123456789012345678901234567890", big: 1n, createdAt: null };
    expect(decodeNormalizedRow(base, structuredClone(row)).amount).toBe("123456789012345678901234567890.00");
  });

  test("负零归一化为正零", () => {
    const row = { id: 1, score: -0, count: 1, amount: "1", big: 1n, createdAt: null };
    const result = decodeNormalizedRow(base, structuredClone(row));
    expect(Object.is(result.score, 0)).toBe(true);
  });

  test("bigint 落在 number 列按 safeInteger 归一化", () => {
    const row = { id: 1, score: 5n, count: 2, amount: "1", big: 3n, createdAt: null };
    expect(decodeNormalizedRow(base, structuredClone(row)).score).toBe(5);
  });

  test("decode 与 decodeNormalizedRow 均不修改入参", () => {
    const row = { id: 1, score: 1, count: 1, amount: "1", big: 1n, createdAt: ISO };
    const original = structuredClone(row);
    const decoded = decode(base, row, "inlineDates");
    expect(decoded).not.toBe(row);
    expect(isDeepStrictEqual(row, original)).toBe(true);
    const sqliteRow = { ...row };
    const sqliteOriginal = structuredClone(sqliteRow);
    expect(decodeNormalizedRow(base, sqliteRow)).not.toBe(sqliteRow);
    expect(isDeepStrictEqual(sqliteRow, sqliteOriginal)).toBe(true);
  });
});
