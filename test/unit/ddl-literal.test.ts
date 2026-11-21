// DDL 字面量的转义与方言差异：单引号必须加倍闭合，空值与布尔在三库写法不同，
// 默认值、枚举约束与注释三条渲染路径共用同一套转义。
import { describe, expect, test } from "bun:test";
import { literal } from "../../src/shared/index.js";
import { postgresLiteral } from "../../src/adapters/postgres/driver.js";
import { mysqlSchemaSQL } from "../../src/adapters/mysql/index.js";
import { postgresSchemaSQL } from "../../src/adapters/postgres/index.js";
import { sqliteSchemaSQL } from "../../src/adapters/sqlite/index.js";
import { parseSchema } from "../../src/schema/index.js";

describe("literal", () => {
  test("wraps strings in single quotes and doubles inner quotes", () => {
    expect(literal("hello")).toBe("'hello'");
    expect(literal("O'Brien")).toBe("'O''Brien'");
    expect(literal("'")).toBe("''''");
    expect(literal("")).toBe("''");
  });

  test("keeps backslashes as ordinary characters", () => {
    expect(literal("back\\slash")).toBe("'back\\slash'");
  });

  test("renders null, booleans and numbers", () => {
    expect(literal(null)).toBe("NULL");
    expect(literal(true)).toBe(1);
    expect(literal(false)).toBe(0);
    expect(literal(42)).toBe(42);
  });
});

describe("PostgreSQL literal", () => {
  test("uses real booleans instead of 1/0", () => {
    expect(postgresLiteral(true)).toBe("TRUE");
    expect(postgresLiteral(false)).toBe("FALSE");
  });

  test("shares the shared escaping for everything else", () => {
    expect(postgresLiteral(null)).toBe("NULL");
    expect(postgresLiteral("O'Brien")).toBe("'O''Brien'");
    expect(postgresLiteral(42)).toBe(42);
  });
});

describe("DDL rendering of quoted values", () => {
  const schema = parseSchema(`// 表注释里有引号
model Note {
  id: int @id @auto
  title: string = "O'Brien" // it's a title
  status: "it's" | "ok" = "it's"
  flag: boolean = true
}`);

  test("MySQL closes quotes in defaults, checks and comments", () => {
    const sql = mysqlSchemaSQL(schema).join("\n");
    expect(sql).toContain("DEFAULT 'O''Brien'");
    expect(sql).toContain("CHECK (`status` IN ('it''s','ok'))");
    expect(sql).toContain("COMMENT 'it''s a title'");
    expect(sql).toContain("COMMENT='表注释里有引号'");
  });

  test("PostgreSQL closes quotes in defaults, checks and comments", () => {
    const sql = postgresSchemaSQL(schema).join("\n");
    expect(sql).toContain("DEFAULT 'O''Brien'");
    expect(sql).toContain("CHECK (\"status\" IN ('it''s','ok'))");
    expect(sql).toContain("IS 'it''s a title'");
    expect(sql).toContain("IS '表注释里有引号'");
  });

  test("SQLite closes quotes in defaults and checks", () => {
    const sql = sqliteSchemaSQL(schema).join("\n");
    expect(sql).toContain("DEFAULT 'O''Brien'");
    expect(sql).toContain("CHECK (\"status\" IN ('it''s','ok'))");
  });

  test("boolean defaults follow each dialect", () => {
    expect(mysqlSchemaSQL(schema).join("\n")).toContain("DEFAULT 1");
    expect(sqliteSchemaSQL(schema).join("\n")).toContain("DEFAULT 1");
    expect(postgresSchemaSQL(schema).join("\n")).toContain("DEFAULT TRUE");
  });

  test("a quoted value cannot terminate the surrounding literal early", () => {
    // 未转义时 `DEFAULT 'O'Brien'` 会在 O 之后闭合，后面的内容会被当成 SQL 解析。
    for (const sql of [mysqlSchemaSQL(schema), postgresSchemaSQL(schema), sqliteSchemaSQL(schema)]) {
      expect(sql.join("\n")).not.toContain("'O'Brien'");
    }
  });
});
