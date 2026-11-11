// 不依赖数据库的运行时单元测试：sql 片段、标识符引用和迁移提供者。
import { describe, expect, test } from "bun:test";
import { DbNull, JsonNull, OrmError, sql } from "../../src/index.js";
import { quoteIdentifier, quoteMysqlIdentifier } from "../../src/query/identifiers.js";
import { columnChanges, structuralIndexKey } from "../../src/migrations/provider.js";
import { providerFor } from "../../src/adapters/providers.js";

const validation = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OrmError);
    expect((error as OrmError).code).toBe("VALIDATION");
    return;
  }
  throw new Error("expected a VALIDATION error");
};

describe("sql fragments", () => {
  // 按顺序收集参数，并展开嵌套片段
  test("collects values in order and flattens nested fragments", () => {
    const inner = sql`b = ${2} AND c = ${3}`;
    const query = sql`SELECT * FROM t WHERE a = ${1} AND ${inner} AND d = ${4}`;
    expect(query.strings).toEqual(["SELECT * FROM t WHERE a = ", " AND b = ", " AND c = ", " AND d = ", ""]);
    expect(query.values).toEqual([1, 2, 3, 4]);
    expect(Object.isFrozen(query)).toBeTrue();
  });

  // sql 只能作为标签模板使用
  test("must be used as a tagged template", () => {
    validation(() => {
      return (sql as any)("SELECT 1");
    });
  });
});

describe("identifiers", () => {
  // ANSI 与 MySQL 标识符引用会转义内部引号
  test("ANSI and MySQL quoting escape embedded quotes", () => {
    expect(quoteIdentifier("User")).toBe('"User"');
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
    expect(quoteMysqlIdentifier("User")).toBe("`User`");
    expect(quoteMysqlIdentifier("a`b")).toBe("`a``b`");
  });
});

describe("json null markers", () => {
  // DbNull 与 JsonNull 是互不相同的冻结哨兵对象
  test("DbNull and JsonNull are distinct frozen sentinels", () => {
    expect(DbNull).not.toBe(JsonNull);
    expect(Object.isFrozen(DbNull)).toBeTrue();
    expect(Object.isFrozen(JsonNull)).toBeTrue();
  });
});

describe("migration providers", () => {
  // providerFor 根据 URL 选择迁移提供者
  test("providerFor picks the provider from the url", async () => {
    expect((await providerFor("file:./dev.db")).id).toBe("sqlite");
    expect((await providerFor("./relative.db")).id).toBe("sqlite");
    expect((await providerFor("postgresql://u:p@h/db")).id).toBe("postgresql");
    expect((await providerFor("postgres://u:p@h/db")).id).toBe("postgresql");
    expect((await providerFor("mysql://u:p@h/db")).id).toBe("mysql");
    await expect(providerFor("mongodb://h/db")).rejects.toThrow();
  });

  // 各提供者的参数占位符和标识符引用
  test("placeholders and quoting per provider", async () => {
    expect((await providerFor("postgresql://h/db")).param(3)).toBe("$3");
    expect((await providerFor("mysql://h/db")).param(3)).toBe("?");
    expect((await providerFor("mysql://h/db")).quote("t")).toBe("`t`");
    expect((await providerFor("file:x.db")).quote("t")).toBe('"t"');
  });

  const column = (over: Record<string, unknown> = {}) => {
    return {
      name: "c",
      type: "INTEGER",
      nullable: false,
      default: null,
      auto: false,
      definition: "c INTEGER",
      ...over,
    } as any;
  };

  // columnChanges 报告每个不同的列属性
  test("columnChanges reports each attribute that differs", () => {
    expect(columnChanges(column(), column(), true)).toEqual([]);
    expect(columnChanges(column(), column({ type: "integer" }), true)).toEqual([]);
    expect(columnChanges(column(), column({ type: "TEXT", nullable: true }), true)).toEqual(["type", "nullability"]);
    expect(columnChanges(column(), column({ default: "1", auto: true }), true)).toEqual(["default", "autoincrement"]);
  });

  // 只有要求时 columnChanges 才比较列定义文本
  test("columnChanges falls back to the definition only when asked", () => {
    const other = column({ definition: "c INTEGER CHECK (c > 0)" });
    expect(columnChanges(column(), other, true)).toEqual(["definition"]);
    expect(columnChanges(column(), other, false)).toEqual([]);
  });

  // structuralIndexKey 区分索引名、唯一性和列顺序
  test("structuralIndexKey distinguishes name, uniqueness and column order", () => {
    const index = (over: Record<string, unknown> = {}) => {
      return { name: "i", unique: false, columns: ["a", "b"], definition: "", ...over } as any;
    };
    expect(structuralIndexKey(index())).toBe(structuralIndexKey(index({ definition: "whatever" })));
    expect(structuralIndexKey(index())).not.toBe(structuralIndexKey(index({ unique: true })));
    expect(structuralIndexKey(index())).not.toBe(structuralIndexKey(index({ columns: ["b", "a"] })));
  });
});
