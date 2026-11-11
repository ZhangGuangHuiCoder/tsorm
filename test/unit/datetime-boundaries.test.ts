// 日期时间工具函数的边界：时区范围、日历边界、时间戳范围与 UTC 输入格式。
import { describe, expect, test } from "bun:test";
import { OrmError } from "../../src/index.js";
import { dateTimeInput, localDateTime, timezoneOffset, utcDateTime, validateDateTime } from "../../src/shared/datetime.js";

/** 断言调用以 VALIDATION 错误失败，并返回该错误。 */
function validation(fn: () => unknown): OrmError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OrmError);
    expect((error as OrmError).code).toBe("VALIDATION");
    return error as OrmError;
  }
  throw new Error("expected a VALIDATION error");
}

describe("timezoneOffset boundaries", () => {
  test("accepts the full supported range and both signs", () => {
    expect(timezoneOffset("+00:00")).toBe(0);
    expect(timezoneOffset("-00:00")).toBe(-0);
    expect(timezoneOffset("+13:59")).toBe(839);
    expect(timezoneOffset("-13:59")).toBe(-839);
    expect(timezoneOffset("+14:00")).toBe(840);
    expect(timezoneOffset("-14:00")).toBe(-840);
  });

  test("rejects offsets beyond ±14:00 or with invalid minutes", () => {
    validation(() => {
      return timezoneOffset("+14:01");
    });
    validation(() => {
      return timezoneOffset("-14:01");
    });
    validation(() => {
      return timezoneOffset("+14:59");
    });
    validation(() => {
      return timezoneOffset("+15:00");
    });
    validation(() => {
      return timezoneOffset("-15:00");
    });
    validation(() => {
      return timezoneOffset("+00:60");
    });
    validation(() => {
      return timezoneOffset("-08:99");
    });
  });

  test("rejects malformed offsets instead of guessing", () => {
    for (const value of ["UTC", "Z", "8:00", "+8:00", "+0800", "+08", "+08:", "+08:0", " +08:00", "+08:00 "]) {
      validation(() => {
        return timezoneOffset(value);
      });
    }
  });
});

describe("validateDateTime boundaries", () => {
  test("accepts the supported year and calendar range", () => {
    expect(validateDateTime("0001-01-01 00:00:00")).toBe("0001-01-01 00:00:00.000");
    expect(validateDateTime("9999-12-31 23:59:59.999")).toBe("9999-12-31 23:59:59.999");
    expect(validateDateTime("2024-02-29 12:34:56")).toBe("2024-02-29 12:34:56.000");
    expect(validateDateTime("2000-02-29 00:00:00")).toBe("2000-02-29 00:00:00.000");
    expect(validateDateTime("2026-01-31 23:59:59")).toBe("2026-01-31 23:59:59.000");
    expect(validateDateTime("2026-04-30 23:59:59")).toBe("2026-04-30 23:59:59.000");
  });

  test("rejects years outside 0001..9999", () => {
    validation(() => {
      return validateDateTime("0000-01-01 00:00:00");
    });
    validation(() => {
      return validateDateTime("10000-01-01 00:00:00");
    });
    validation(() => {
      return validateDateTime("999-01-01 00:00:00");
    });
  });

  test("rejects non-leap February 29 and respects the century rule", () => {
    validation(() => {
      return validateDateTime("2023-02-29 00:00:00");
    });
    validation(() => {
      return validateDateTime("1900-02-29 00:00:00");
    });
    validation(() => {
      return validateDateTime("2100-02-29 00:00:00");
    });
    expect(validateDateTime("2400-02-29 00:00:00")).toBe("2400-02-29 00:00:00.000");
  });

  test("rejects month, day and time components at their limits", () => {
    validation(() => {
      return validateDateTime("2026-00-01 00:00:00");
    });
    validation(() => {
      return validateDateTime("2026-13-01 00:00:00");
    });
    validation(() => {
      return validateDateTime("2026-01-00 00:00:00");
    });
    validation(() => {
      return validateDateTime("2026-01-32 00:00:00");
    });
    validation(() => {
      return validateDateTime("2026-04-31 00:00:00");
    });
    validation(() => {
      return validateDateTime("2026-01-01 24:00:00");
    });
    validation(() => {
      return validateDateTime("2026-01-01 00:60:00");
    });
    validation(() => {
      return validateDateTime("2026-01-01 00:00:60");
    });
    validation(() => {
      return validateDateTime("2026-01-01 23:59:60");
    });
  });

  test("normalizes one to three fractional digits and rejects four", () => {
    expect(validateDateTime("2026-01-01 00:00:00.1")).toBe("2026-01-01 00:00:00.100");
    expect(validateDateTime("2026-01-01 00:00:00.12")).toBe("2026-01-01 00:00:00.120");
    expect(validateDateTime("2026-01-01 00:00:00.123")).toBe("2026-01-01 00:00:00.123");
    validation(() => {
      return validateDateTime("2026-01-01 00:00:00.1234");
    });
    validation(() => {
      return validateDateTime("2026-01-01 00:00:00.");
    });
  });

  test("accepts space or T separators, and rejects timezone suffixes and other shapes", () => {
    expect(validateDateTime("2026-01-01T00:00:00")).toBe("2026-01-01 00:00:00.000");
    for (const value of ["2026-01-01t00:00:00", "2026-01-01", "2026-01-01 00:00", "2026-1-01 00:00:00", "2026-01-01 0:00:00", "2026-01-01 00:00:00Z", "2026-01-01 00:00:00+08:00", "2026-01-01 00:00:00 ", " 2026-01-01 00:00:00"]) {
      validation(() => {
        return validateDateTime(value);
      });
    }
  });

  test("rejects non-string values", () => {
    for (const value of [null, undefined, 0, new Date(), true, {}]) {
      validation(() => {
        return validateDateTime(value);
      });
    }
  });
});

describe("localDateTime boundaries", () => {
  test("maps epoch and pre-epoch milliseconds in either direction", () => {
    expect(localDateTime(0, "+08:00")).toBe("1970-01-01 08:00:00.000");
    expect(localDateTime(-1, "+08:00")).toBe("1970-01-01 07:59:59.999");
    expect(localDateTime(0, "-03:00")).toBe("1969-12-31 21:00:00.000");
    expect(localDateTime(-1, "+14:00")).toBe("1970-01-01 13:59:59.999");
    expect(localDateTime(0, "-14:00")).toBe("1969-12-31 10:00:00.000");
  });

  test("converts Date values including leap days and milliseconds", () => {
    expect(localDateTime(new Date("2024-02-29T00:00:00.999Z"), "+08:00")).toBe("2024-02-29 08:00:00.999");
    expect(localDateTime(new Date("2026-12-31T20:00:00.000Z"), "+08:00")).toBe("2027-01-01 04:00:00.000");
    expect(localDateTime(new Date("1969-12-31T23:59:59.999Z"), "+00:00")).toBe("1969-12-31 23:59:59.999");
  });

  test("treats string inputs as already-local values and does not shift them", () => {
    expect(localDateTime("2026-01-01 00:00:00", "+08:00")).toBe("2026-01-01 00:00:00.000");
    expect(localDateTime("2026-01-01T00:00:00.4", "-14:00")).toBe("2026-01-01 00:00:00.400");
  });

  test("rejects numbers outside the safe integer range or Date range", () => {
    validation(() => {
      return localDateTime(Number.MAX_SAFE_INTEGER);
    });
    validation(() => {
      return localDateTime(Number.MAX_SAFE_INTEGER + 1);
    });
    validation(() => {
      return localDateTime(Number.MIN_SAFE_INTEGER - 1);
    });
    validation(() => {
      return localDateTime(8.64e15);
    });
    validation(() => {
      return localDateTime(-8.64e15);
    });
    validation(() => {
      return localDateTime(NaN);
    });
    validation(() => {
      return localDateTime(Infinity);
    });
    validation(() => {
      return localDateTime(-Infinity);
    });
  });

  test("rejects invalid dates, invalid local strings and invalid timezones", () => {
    validation(() => {
      return localDateTime(new Date("nope"));
    });
    validation(() => {
      return localDateTime("2026-02-30 00:00:00");
    });
    validation(() => {
      return localDateTime("2026-01-01 24:00:00");
    });
    validation(() => {
      return localDateTime(0, "UTC");
    });
    validation(() => {
      return localDateTime("2026-01-01 00:00:00", "+14:30");
    });
  });
});

describe("utcDateTime boundaries", () => {
  test("applies positive and negative offsets and keeps milliseconds", () => {
    expect(utcDateTime("2026-01-01 01:30:00", "+08:00")).toBe("2025-12-31T17:30:00.000Z");
    expect(utcDateTime("2026-01-01 01:30:00.4", "+08:00")).toBe("2025-12-31T17:30:00.400Z");
    expect(utcDateTime("2026-01-01 23:30:00", "-05:00")).toBe("2026-01-02T04:30:00.000Z");
    expect(utcDateTime("2026-01-01 00:00:00", "+14:00")).toBe("2025-12-31T10:00:00.000Z");
    expect(utcDateTime("2026-01-01 00:00:00", "-14:00")).toBe("2026-01-01T14:00:00.000Z");
  });

  test("keeps years 0001 and 9999 when the result stays in range", () => {
    expect(utcDateTime("0001-01-01 00:00:00", "+00:00")).toBe("0001-01-01T00:00:00.000Z");
    expect(utcDateTime("9999-12-31 23:59:59", "+00:00")).toBe("9999-12-31T23:59:59.000Z");
  });

  test("rejects offsets that push the UTC result outside years 0001..9999", () => {
    validation(() => {
      return utcDateTime("0001-01-01 00:00:00", "+00:01");
    });
    validation(() => {
      return utcDateTime("0001-01-01 00:00:00", "+14:00");
    });
    validation(() => {
      return utcDateTime("9999-12-31 23:59:59", "-00:01");
    });
    validation(() => {
      return utcDateTime("9999-12-31 23:59:59", "-14:00");
    });
  });

  test("rejects invalid local values and invalid timezones", () => {
    validation(() => {
      return utcDateTime("2026-02-29 00:00:00", "+08:00");
    });
    validation(() => {
      return utcDateTime("2026-01-01 24:00:00", "+08:00");
    });
    validation(() => {
      return utcDateTime("2026-01-01 00:00:00", "UTC");
    });
    validation(() => {
      return utcDateTime("2026-01-01 00:00:00", "+15:00");
    });
  });
});

describe("dateTimeInput boundaries", () => {
  test("UTC mode accepts its own zero, short and long fraction output", () => {
    expect(dateTimeInput("1970-01-01T00:00:00Z", "+08:00", "utc")).toBe("1970-01-01 08:00:00.000");
    expect(dateTimeInput("2026-01-01T00:00:00.4Z", "+08:00", "utc")).toBe("2026-01-01 08:00:00.400");
    expect(dateTimeInput("2026-01-01T00:00:00.12Z", "+08:00", "utc")).toBe("2026-01-01 08:00:00.120");
    expect(dateTimeInput("2026-01-01T00:00:00.123Z", "+08:00", "utc")).toBe("2026-01-01 08:00:00.123");
  });

  test("UTC mode still accepts plain local strings, numbers and Date values", () => {
    expect(dateTimeInput("2026-01-01 00:00:00", "+08:00", "utc")).toBe("2026-01-01 00:00:00.000");
    expect(dateTimeInput("2026-01-01T00:00:00", "+08:00", "utc")).toBe("2026-01-01 00:00:00.000");
    expect(dateTimeInput(0, "+08:00", "utc")).toBe("1970-01-01 08:00:00.000");
    expect(dateTimeInput(new Date("2026-01-01T00:00:00.000Z"), "+08:00", "utc")).toBe("2026-01-01 08:00:00.000");
  });

  test("rejects malformed UTC strings instead of falling back", () => {
    validation(() => {
      return dateTimeInput("2026-01-01T00:00:00z", "+08:00", "utc");
    });
    validation(() => {
      return dateTimeInput("2026-01-01T00:00:00+08:00", "+08:00", "utc");
    });
    validation(() => {
      return dateTimeInput("2026-01-01T00:00:00.1234Z", "+08:00", "utc");
    });
    validation(() => {
      return dateTimeInput("2026-01-01T00:00Z", "+08:00", "utc");
    });
    validation(() => {
      return dateTimeInput("2026-02-30T00:00:00Z", "+08:00", "utc");
    });
    validation(() => {
      return dateTimeInput("0000-01-01T00:00:00Z", "+08:00", "utc");
    });
    validation(() => {
      return dateTimeInput("0001-01-01T00:00:00Z", "-14:00", "utc");
    });
    validation(() => {
      return dateTimeInput("9999-12-31T23:59:59Z", "+14:00", "utc");
    });
  });

  test("local mode only accepts local strings and rejects Z suffixes", () => {
    expect(dateTimeInput("2026-01-01T00:00:00", "+08:00", "local")).toBe("2026-01-01 00:00:00.000");
    validation(() => {
      return dateTimeInput("2026-01-01T00:00:00Z", "+08:00", "local");
    });
    validation(() => {
      return dateTimeInput("2026-01-01T00:00:00+08:00", "+08:00", "local");
    });
  });

  test("validates the timezone even for string-only inputs", () => {
    validation(() => {
      return dateTimeInput("2026-01-01 00:00:00", "+14:30", "utc");
    });
    validation(() => {
      return dateTimeInput("2026-01-01 00:00:00", "UTC", "local");
    });
  });
});
