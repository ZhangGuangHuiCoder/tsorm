// 十进制标量的边界：驱动返回值解码、精度/标度校验与分组键规范化。
import { describe, expect, test } from "bun:test";
import { OrmError } from "../../src/index.js";
import { decodeDecimal, encode, scalarGroupKey } from "../../src/shared/scalars.js";

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

const validation = (fn: () => unknown) => {
  return ormError("VALIDATION", fn);
};
const databaseError = (fn: () => unknown) => {
  return ormError("INVALID_DATABASE_VALUE", fn);
};

/** decodeDecimal 只读取类型的 scale；其余字段用最小列对象补齐。 */
const decimal = (scale?: number) => {
  return { type: "decimal", name: "value", ...(scale === undefined ? {} : { scale }) } as any;
};
/** 带精度约束的列，用于 encode 的精度边界。 */
const bounded = (precision: number, scale: number) => {
  return { type: "decimal", name: "value", precision, scale, nullable: false } as any;
};

describe("decodeDecimal column values", () => {
  test("pads integer strings to the declared scale", () => {
    expect(decodeDecimal(decimal(2), "4")).toBe("4.00");
    expect(decodeDecimal(decimal(2), "-4")).toBe("-4.00");
    expect(decodeDecimal(decimal(2), "0")).toBe("0.00");
    expect(decodeDecimal(decimal(2), "-0")).toBe("-0.00");
    expect(decodeDecimal(decimal(3), "4")).toBe("4.000");
    expect(decodeDecimal(decimal(0), "4")).toBe("4");
  });

  test("keeps fractional strings exactly as the driver returned them", () => {
    expect(decodeDecimal(decimal(2), "4.5")).toBe("4.5");
    expect(decodeDecimal(decimal(2), "-4.50")).toBe("-4.50");
    expect(decodeDecimal(decimal(3), "001.500")).toBe("001.500");
  });

  test("treats an absent scale as no padding", () => {
    expect(decodeDecimal(decimal(), "4")).toBe("4");
    expect(decodeDecimal(decimal(), "4.50")).toBe("4.50");
  });

  test("handles bigint drivers with and without a scale", () => {
    expect(decodeDecimal(decimal(2), 4n)).toBe("4.00");
    expect(decodeDecimal(decimal(0), 4n)).toBe("4");
    expect(decodeDecimal(decimal(2), -4n)).toBe("-4.00");
  });

  test("formats finite numbers without exponent notation", () => {
    expect(decodeDecimal(decimal(2), 4)).toBe("4.00");
    expect(decodeDecimal(decimal(2), 4.5)).toBe("4.50");
    expect(decodeDecimal(decimal(2), 1e-7)).toBe("0.00");
    expect(decodeDecimal(decimal(), 1e-7)).toBe("0.0000001");
    expect(decodeDecimal(decimal(2), 1e21)).toBe("1000000000000000000000");
    expect(decodeDecimal(decimal(), -1e21)).toBe("-1000000000000000000000");
  });

  test("rejects non-decimal driver values", () => {
    for (const value of [null, undefined, true, {}, [], "abc", "1e3", ".5", "1.", "", "1.2.3"]) {
      databaseError(() => {
        return decodeDecimal(decimal(2), value);
      });
    }
    databaseError(() => {
      return decodeDecimal(decimal(2), NaN);
    });
    databaseError(() => {
      return decodeDecimal(decimal(2), Infinity);
    });
    databaseError(() => {
      return decodeDecimal(decimal(2), -Infinity);
    });
  });
});

describe("decimal encoding precision boundaries", () => {
  test("accepts exactly the declared integer and fractional digits", () => {
    expect(encode(bounded(10, 2), "12345678.99")).toBe("12345678.99");
    expect(encode(bounded(10, 2), "-12345678.99")).toBe("-12345678.99");
    expect(encode(bounded(10, 2), "0000000012345678.99")).toBe("0000000012345678.99");
    expect(encode(bounded(10, 0), "1234567890")).toBe("1234567890");
  });

  test("rejects one extra integer digit or one extra fraction digit", () => {
    validation(() => {
      return encode(bounded(10, 2), "123456789.00");
    });
    validation(() => {
      return encode(bounded(10, 2), "-123456789.00");
    });
    validation(() => {
      return encode(bounded(10, 2), "1.999");
    });
    validation(() => {
      return encode(bounded(10, 2), "0.001");
    });
    validation(() => {
      return encode(bounded(10, 0), "4.0");
    });
  });

  test("normalizes whitespace and finite number inputs", () => {
    expect(encode(bounded(10, 2), " 1.5 ")).toBe("1.5");
    expect(encode(bounded(10, 2), 1.5)).toBe("1.5");
    expect(encode(bounded(10, 2), 2)).toBe("2");
    expect(encode({ type: "decimal", name: "value", nullable: false } as any, 1e-7)).toBe("0.0000001");
  });

  test("without precision only the decimal shape is enforced", () => {
    const unbounded = { type: "decimal", name: "value", scale: 2, nullable: false } as any;
    expect(encode(unbounded, "12345678901234567890.99")).toBe("12345678901234567890.99");
    expect(encode(unbounded, 1e21)).toBe("1000000000000000000000");
  });

  test("rejects exponent notation, malformed strings and null", () => {
    for (const value of ["1e3", "NaN", ".5", "1.", "", null]) {
      validation(() => {
        return encode(bounded(10, 2), value);
      });
    }
    validation(() => {
      return encode(bounded(10, 2), Infinity);
    });
    validation(() => {
      return encode(bounded(10, 2), -Infinity);
    });
  });
});

describe("decimal group key normalization", () => {
  const column = decimal(2);

  test("normalizes signed zero", () => {
    for (const value of ["0", "-0", "0.00", "-0.00", "000"]) {
      expect(scalarGroupKey(column, value)).toBe("0");
    }
  });

  test("drops insignificant leading and trailing zeros", () => {
    expect(scalarGroupKey(column, "1.50")).toBe("1.5");
    expect(scalarGroupKey(column, "1.5")).toBe("1.5");
    expect(scalarGroupKey(column, "001.50")).toBe("1.5");
    expect(scalarGroupKey(column, "4")).toBe("4");
    expect(scalarGroupKey(column, "-1.50")).toBe("-1.5");
    expect(scalarGroupKey(column, "-0.01")).toBe("-0.01");
  });

  test("preserves NULL as a distinct group", () => {
    expect(scalarGroupKey(column, null)).toBe("null");
  });
});
