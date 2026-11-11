// VS Code 扩展的语言逻辑：补全、悬停帮助与格式化。属于扩展交付物，独立于 @ofis/tsorm 库的测试。
import { describe, expect, test } from "bun:test";
import { parseSchema } from "../../src/schema/index.js";
import { completeRelations, formatSchema, help, suggestions } from "../src/language.js";

describe("extension language review", () => {
  test("datetime help describes local datetime strings", () => {
    expect(help.datetime).toContain("字符串");
    expect(help.datetime).not.toContain("返回 Date");
  });
  test("completes independent missing unique constraints together", () => {
    const source = "model User { id: int @id profile?: Profile @via(user) } model Profile { id: int @id user: User } model Team { id: int @id info?: Info @via(team) } model Info { id: int @id team: Team }";
    expect(() => {
      return parseSchema(completeRelations(source));
    }).not.toThrow();
  });
  test.each(["index", "unique", "id"])("@@%s completion excludes unsupported key types", (attribute) => {
    const source = "model Item { id: int @id data: json<string> payload: bytes body: text @@" + attribute + "(";
    const labels = suggestions(source, source.length).map((item) => {
      return item.label;
    });
    expect(labels).not.toContain("data");
    expect(labels).not.toContain("payload");
    expect(labels).not.toContain("body");
  });
  test("required relation completion excludes SetNull", () => {
    const source = "model User { id: int @id } model Post { id: int @id author: User @relation(onDelete: ";
    expect(
      suggestions(source, source.length).map((item) => {
        return item.label;
      }),
    ).not.toContain("SetNull");
  });
  test("formatting preserves parsed semantics and is idempotent", () => {
    const source = "// example\nmodel Item { id:int @id @auto data?:json<{ value: string; count?: number }> }";
    const formatted = formatSchema(source);
    expect(parseSchema(formatted)).toEqual(parseSchema(source));
    expect(formatSchema(formatted)).toBe(formatted);
  });
});
