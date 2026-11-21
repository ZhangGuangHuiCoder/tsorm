// 数值标量的边界：整数的安全范围、浮点的有限范围，以及两者共用的严格输入契约。
import { describe, expect, test } from "bun:test";
import { OrmError } from "../../src/index.js";
import { finiteNumber, safeInteger } from "../../src/shared/index.js";

function ormError(code: string, fn: () => unknown): OrmError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OrmError);
    expect((error as OrmError).code).toBe(code);
    return error as OrmError;
  }
  throw new Error(`expected an ${code} error`);
}
const overflow = (fn: () => unknown) => ormError("NUMERIC_OVERFLOW", fn);
const databaseError = (fn: () => unknown) => ormError("INVALID_DATABASE_VALUE", fn);

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
    for (const value of ["9007199254740992", "-9007199254740992", 9007199254740993n, -9007199254740993n, Number.MAX_SAFE_INTEGER + 1]) {
      overflow(() => {
        return safeInteger(value);
      });
    }
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

describe("finiteNumber accepted inputs", () => {
  test("passes finite numbers through unchanged", () => {
    expect(finiteNumber(0)).toBe(0);
    expect(finiteNumber(42)).toBe(42);
    expect(finiteNumber(-7.5)).toBe(-7.5);
    expect(finiteNumber(1e21)).toBe(1e21);
    expect(finiteNumber(1e-7)).toBe(1e-7);
  });

  test("accepts plain numeric strings including sign, fraction and exponent", () => {
    expect(finiteNumber("42")).toBe(42);
    expect(finiteNumber("-7.5")).toBe(-7.5);
    expect(finiteNumber("+5")).toBe(5);
    expect(finiteNumber(".5")).toBe(0.5);
    expect(finiteNumber("1e3")).toBe(1000);
    expect(finiteNumber("1.5e-3")).toBe(0.0015);
    expect(finiteNumber(" 12 ")).toBe(12);
  });

  test("normalizes negative zero to positive zero", () => {
    expect(Object.is(finiteNumber(-0), 0)).toBeTrue();
    expect(Object.is(finiteNumber("-0"), 0)).toBeTrue();
    expect(Object.is(finiteNumber("-0.0"), 0)).toBeTrue();
  });
});

describe("finiteNumber strict input contract", () => {
  test("rejects non-finite numbers", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      databaseError(() => {
        return finiteNumber(value);
      });
    }
  });

  test("rejects values that Number() would silently coerce", () => {
    for (const value of [null, undefined, "", "   ", false, true, [], [5], {}]) {
      databaseError(() => {
        return finiteNumber(value);
      });
    }
  });

  test("rejects non-numeric and overflowing strings", () => {
    for (const value of ["0x10", "abc", "1.2.3", "1.", "NaN", "Infinity", "1e999"]) {
      databaseError(() => {
        return finiteNumber(value);
      });
    }
  });
});
