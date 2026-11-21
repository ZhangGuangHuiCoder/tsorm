// 适配器层的日期时间入口：写入只接受 Date，读取把存储形式换成 Date。
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { OrmError } from "../../src/index.js";
import { storedInstant, writeInstant } from "../../src/shared/index.js";
import { sqlite } from "../../src/adapters/sqlite/index.js";
import { parseSchema } from "../../src/schema/index.js";

const srcRoot = fileURLToPath(new URL("../../src/", import.meta.url));

/** 源码目录下的全部 TypeScript 文件。 */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

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

const min = new Date("0001-01-01T00:00:00.000Z");
const max = new Date("9999-12-31T23:59:59.999Z");

describe("writeInstant", () => {
  test("accepts Date values inside the supported UTC range", () => {
    const instant = new Date("2026-11-17T00:00:00.000Z");
    expect(writeInstant(instant, "createdAt")).toBe(instant);
    expect(writeInstant(min, "at")).toBe(min);
    expect(writeInstant(max, "at")).toBe(max);
  });

  test("rejects non-Date, invalid and out-of-range values", () => {
    for (const value of ["2026-11-17T00:00:00.000Z", 0, NaN, Infinity, null, undefined, new Date(NaN), new Date("0000-12-31T23:59:59.999Z"), new Date(Date.UTC(10000, 0, 1))]) {
      validation(() => {
        return writeInstant(value, "at");
      });
    }
    expect(validation(() => writeInstant("2026-01-01T00:00:00.000Z", "at")).message).toContain("expected a Date");
  });
});

describe("storedInstant", () => {
  test("reads Date, epoch milliseconds and zoned ISO text", () => {
    const instant = new Date("2026-11-17T00:00:00.000Z");
    expect(storedInstant(instant)).toBe(instant);
    expect(storedInstant(instant.getTime())).toEqual(instant);
    expect(storedInstant("2026-11-17T00:00:00.000Z")).toEqual(instant);
    expect(storedInstant("2026-11-17T08:00:00+08:00")).toEqual(instant);
    expect(storedInstant("2024-02-29T12:34:56.789Z")).toEqual(new Date("2024-02-29T12:34:56.789Z"));
  });

  test("keeps the supported UTC year range", () => {
    expect(storedInstant(min.getTime())).toEqual(min);
    expect(storedInstant(max.getTime())).toEqual(max);
    expect(storedInstant("0001-01-01T00:00:00.000Z")).toEqual(min);
    expect(storedInstant("9999-12-31T23:59:59.999Z")).toEqual(max);
  });

  test("rejects wall-clock text, unparsable values and unsafe milliseconds", () => {
    for (const value of ["2026-11-17 08:00:00.000", "2026-11-17T08:00:00", "nope", new Date("nope"), new Date(8.64e15), NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
      validation(() => {
        return storedInstant(value);
      });
    }
    expect(validation(() => storedInstant("0000-01-01T00:00:00.000Z")).message).toBe("Invalid datetime");
  });
});

describe("legacy storage upgrade", () => {
  const table = parseSchema("model Event {\n id: int @id @auto\n at: datetime\n}").tables.Event;
  const decode = sqlite().dialect.decode;

  test("SQLite wall-clock rows must be converted to zoned ISO before upgrading", () => {
    // 旧版把 +08:00 墙钟写成 "2026-11-17 08:00:00.000"，新版只接受带时区的时间戳。
    expect(() => {
      return decode(table, { id: 1, at: "2026-11-17 08:00:00.000" });
    }).toThrow("Invalid datetime");
    const upgraded = decode(table, { id: 1, at: "2026-11-17T08:00:00.000+08:00" });
    expect(upgraded.at).toEqual(new Date("2026-11-17T00:00:00.000Z"));
  });
});

describe("datetime storage framing", () => {
  test("the storage form stays in adapters, schema and shared helpers", () => {
    // 存储细节只允许出现在存储边界与工具层；core/query 等业务层只处理 Date 对象。
    const framing = /\bdateStorage\b/;
    const allowed = ["adapters/", "schema/", "shared/"];
    const offenders = sources(srcRoot)
      .map((path) => {
        return { name: relative(srcRoot, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") };
      })
      .filter((file) => {
        return !allowed.some((prefix) => file.name.startsWith(prefix)) && framing.test(file.text);
      })
      .map((file) => {
        return file.name;
      });
    expect(offenders).toEqual([]);
  });
});
