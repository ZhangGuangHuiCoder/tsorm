// 浮点标量的边界：严格输入契约、有限范围与负零归一。
import { describe, expect, test } from "bun:test";
import { OrmError } from "../../src/index.js";
import { finiteNumber } from "../../src/shared/scalars.js";

function databaseError(fn: () => unknown): OrmError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OrmError);
    expect((error as OrmError).code).toBe("INVALID_DATABASE_VALUE");
    return error as OrmError;
  }
  throw new Error("expected an INVALID_DATABASE_VALUE error");
}

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
