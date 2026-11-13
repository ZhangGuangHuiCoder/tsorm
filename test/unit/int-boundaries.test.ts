// 整数标量的边界：严格输入契约、安全整数范围与负零归一。
import { describe, expect, test } from "bun:test";
import { OrmError } from "../../src/index.js";
import { safeInteger } from "../../src/shared/scalars.js";

function overflow(fn: () => unknown): OrmError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OrmError);
    expect((error as OrmError).code).toBe("NUMERIC_OVERFLOW");
    return error as OrmError;
  }
  throw new Error("expected a NUMERIC_OVERFLOW error");
}

describe("safeInteger accepted inputs", () => {
  test("passes safe numbers through unchanged", () => {
    expect(safeInteger(0)).toBe(0);
    expect(safeInteger(42)).toBe(42);
    expect(safeInteger(-7)).toBe(-7);
    expect(safeInteger(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(safeInteger(Number.MIN_SAFE_INTEGER)).toBe(Number.MIN_SAFE_INTEGER);
  });

  test("accepts bigints and plain integer strings within the safe range", () => {
    expect(safeInteger(42n)).toBe(42);
    expect(safeInteger(-7n)).toBe(-7);
    expect(safeInteger("42")).toBe(42);
    expect(safeInteger("-7")).toBe(-7);
    expect(safeInteger("007")).toBe(7);
    expect(safeInteger("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    expect(safeInteger("-9007199254740991")).toBe(Number.MIN_SAFE_INTEGER);
  });

  test("normalizes negative zero to positive zero", () => {
    expect(Object.is(safeInteger(-0), 0)).toBeTrue();
    expect(Object.is(safeInteger("-0"), 0)).toBeTrue();
    expect(Object.is(safeInteger(0n), 0)).toBeTrue();
  });
});

describe("safeInteger range boundary", () => {
  test("rejects integers beyond the safe range without silent rounding", () => {
    overflow(() => {
      return safeInteger("9007199254740992");
    });
    overflow(() => {
      return safeInteger("-9007199254740992");
    });
    overflow(() => {
      return safeInteger(9007199254740993n);
    });
    overflow(() => {
      return safeInteger(-9007199254740993n);
    });
    overflow(() => {
      return safeInteger(Number.MAX_SAFE_INTEGER + 1);
    });
  });
});

describe("safeInteger strict input contract", () => {
  test("rejects non-integer numbers", () => {
    for (const value of [1.5, NaN, Infinity, -Infinity]) {
      overflow(() => {
        return safeInteger(value);
      });
    }
  });

  test("rejects values that Number() would silently coerce", () => {
    for (const value of [null, undefined, "", "   ", false, true, [], [5], {}]) {
      overflow(() => {
        return safeInteger(value);
      });
    }
  });

  test("rejects non-plain integer strings", () => {
    for (const value of [" 12 ", "0x10", "1e3", "1.5", "0.99999999999999999", "123abc", "+12"]) {
      overflow(() => {
        return safeInteger(value);
      });
    }
  });
});
