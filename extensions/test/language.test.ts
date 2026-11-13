// VS Code 扩展的语言逻辑：补全、悬停帮助与格式化。属于扩展交付物，独立于 @ofis/tsorm 库的测试。
import { describe, expect, test } from "bun:test";
import { parseSchema } from "../../src/schema/index.js";
import { completeRelations, definition, formatSchema, help, hoverText, references, renameError, resolveSymbol, suggestions, typeAliases } from "../src/language.js";

describe("comments", () => {
  test("slash comments do not break field completion", () => {
    const source = "model A {\n  id: int @id // 主键\n  name: string @";
    const labels = suggestions(source, source.length).map((s) => {
      return s.label;
    });
    expect(labels).toContain("map");
    expect(labels).not.toContain("comment");
  });
  test("comment is not an attribute suggestion", () => {
    const block = "model A { id: int @id @@";
    expect(
      suggestions(block, block.length).map((s) => {
        return s.label;
      }),
    ).not.toContain("comment");
  });
});

describe("implicit morph keys", () => {
  test("suggests generated morph columns inside @@index", () => {
    const source = "model Note {\n  id: int @id @auto\n  holder: morph\n  @@index(holderType, h";
    const labels = suggestions(source, source.length).map((s) => {
      return s.label;
    });
    expect(labels).toContain("holderId");
    expect(labels).not.toContain("holderType");
  });
  test("explicit morph binds declared columns without duplicates", () => {
    const source = "model A {\n  ownerType: string\n  ownerId: int\n  owner: morph(ownerType, ownerId)\n  @@unique(owner";
    const labels = suggestions(source, source.length).map((s) => {
      return s.label;
    });
    expect(labels).toEqual(["ownerType", "ownerId"]);
  });
});

describe("morph binding completion", () => {
  const labels = (source: string) => {
    return suggestions(source, source.length).map((s) => {
      return s.label;
    });
  };
  test("suggests the id column for the second argument", () => {
    expect(labels("model A {\n  ownerType: string\n  ownerId: int\n  owner: morph(ownerType, o")).toEqual(["ownerId"]);
  });
  test("first argument only offers non-null string columns", () => {
    expect(labels("model A {\n  ownerType: string\n  ownerId: int\n  note: string\n  owner: morph(o")).toEqual(["ownerType", "note"]);
  });
  test("excludes keys, nullable columns and relations; stops after two arguments", () => {
    const source = "model A {\n  id: int @id\n  ownerType: string\n  ownerId: int\n  nullableId?: int\n  author: User\n  owner: morph(ownerType, ";
    expect(labels(source)).toEqual(["ownerId"]);
    expect(labels("model A { ownerType: string ownerId: int owner: morph(ownerType, ownerId, ")).toEqual([]);
  });
});

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

describe("top-level statements", () => {
  test("suggests ignore and prefix at top level", () => {
    const labels = (source: string) => {
      return suggestions(source, source.length).map((s) => {
        return s.label;
      });
    };
    expect(labels("")).toEqual(["model", "type", "prefix", "ignore"]);
    expect(labels('prefix "app_"\n')).toEqual(["model", "type", "ignore"]);
    expect(labels("model A {\n  id: int @id\n}\n")).toContain("prefix");
    expect(labels("model A {\n  \n")).toEqual(["field"]);
  });
  test("hover explains ignore and prefix", () => {
    expect(hoverText('prefix "a_"', 2)).toContain("前缀");
    expect(hoverText('ignore ["a"]', 2)).toContain("迁移");
  });
  test("prefix completion is suppressed wherever declared, ignore stays available", () => {
    const labels = (source: string) => {
      return suggestions(source, source.length).map((s) => {
        return s.label;
      });
    };
    // prefix 写在模型之后同样视为已声明
    expect(labels('model A {\n  id: int @id\n}\nprefix "app_"\n')).toEqual(["model", "type", "ignore"]);
    // ignore 可多次声明，已声明后仍继续建议
    expect(labels('ignore ["legacy_*"]\n')).toEqual(["model", "type", "prefix", "ignore"]);
    // 注释里的 prefix 不算声明
    expect(labels('// prefix "app_"\n')).toEqual(["model", "type", "prefix", "ignore"]);
  });
  test("hover for ignore includes the example snippet", () => {
    const text = hoverText('ignore ["legacy_*"]', 2);
    expect(text).toContain("迁移");
    expect(text).toContain('ignore ["legacy_*", "misc"]');
  });
});

describe("top-level statement formatting", () => {
  test("puts prefix and ignore on their own lines and is idempotent", () => {
    const source = 'prefix "app_" ignore ["legacy_*",   "misc"] model A {\n id: int @id\n}\n';
    const once = formatSchema(source);
    expect(once).toBe('prefix "app_"\n\nignore ["legacy_*", "misc"]\n\nmodel A {\n  id: int @id\n}\n');
    expect(formatSchema(once)).toBe(once);
  });
  test("formats a standalone ignore declaration without any model", () => {
    const once = formatSchema('ignore ["legacy_*",   "misc"]\n');
    expect(once).toBe('ignore ["legacy_*", "misc"]\n');
    expect(formatSchema(once)).toBe(once);
  });
});

describe("hoisting top-level statements", () => {
  test("moves prefix and ignore to the top of the file", () => {
    const source = 'model A {\n  id: int @id\n}\n\n// tables owned by the legacy system\nignore ["legacy_*"]\n\nmodel B {\n  id: int @id\n}\n\nprefix "app_"\n';
    const once = formatSchema(source);
    expect(once).toBe('// tables owned by the legacy system\nignore ["legacy_*"]\n\nprefix "app_"\n\nmodel A {\n  id: int @id\n}\n\nmodel B {\n  id: int @id\n}\n');
    expect(formatSchema(once)).toBe(once);
    expect(formatSchema('prefix "a_"\n\nmodel A {\n  id: int @id\n}\n')).toBe('prefix "a_"\n\nmodel A {\n  id: int @id\n}\n');
  });
  test("hoists multiple ignore declarations together in order", () => {
    const source = 'model A {\n  id: int @id\n}\nignore ["legacy_*"]\nignore ["misc"]\n';
    const once = formatSchema(source);
    expect(once).toBe('ignore ["legacy_*"]\n\nignore ["misc"]\n\nmodel A {\n  id: int @id\n}\n');
    expect(formatSchema(once)).toBe(once);
  });
  test("hoists a comment separated by blank lines together with ignore", () => {
    const source = 'model A {\n  id: int @id\n}\n\n// detached\n\nignore ["legacy_*"]\n';
    const once = formatSchema(source);
    expect(once).toBe('// detached\n\nignore ["legacy_*"]\n\nmodel A {\n  id: int @id\n}\n');
    expect(formatSchema(once)).toBe(once);
  });
  test("hoists a tight comment together with prefix", () => {
    const source = '// prefix comment\nprefix "app_"\nmodel A {\n  id: int @id\n}\n';
    const once = formatSchema(source);
    expect(once).toBe('// prefix comment\nprefix "app_"\n\nmodel A {\n  id: int @id\n}\n');
    expect(formatSchema(once)).toBe(once);
  });
});

describe("type aliases", () => {
  const source = 'type Preferences = {\n  theme: "light" | "dark"\n}\n\nmodel Account {\n  id: int @id @auto\n  preferences?: json<Preferences>\n}\n';
  test("parses alias name and declaration span", () => {
    const aliases = typeAliases(source);
    expect(aliases.length).toBe(1);
    expect(aliases[0].name).toBe("Preferences");
    expect(source.slice(aliases[0].declStart, aliases[0].end)).toBe('type Preferences = {\n  theme: "light" | "dark"\n}');
  });
  test("hover shows the alias declaration", () => {
    const text = hoverText(source, source.indexOf("Preferences>"));
    expect(text).toContain("JSON 类型");
    expect(text).toContain("theme");
  });
  test("definition jumps from json reference to the alias", () => {
    expect(definition(source, source.indexOf("Preferences>"))).toBe(source.indexOf("Preferences"));
  });
  test("references include declaration and json usages", () => {
    expect(references(source, source.indexOf("Preferences")).length).toBe(2);
  });
  test("type keyword has hover help", () => {
    expect(hoverText("type X = {}", 1)).toContain("JSON");
  });
  test("field named type is not an alias", () => {
    expect(typeAliases("model A {\n  id: int @id\n  type: string\n}")).toEqual([]);
  });
});

describe("field hover", () => {
  test("shows the full field declaration", () => {
    const source = "model User {\n  id: int @id @auto\n  email: string @unique\n}\n";
    const text = hoverText(source, source.indexOf("email"));
    expect(text).toContain("字段 **email**");
    expect(text).toContain("email: string @unique");
  });
  test("field end covers default value", () => {
    const source = "model A {\n  id: int @id\n  enabled: boolean = true\n}\n";
    const text = hoverText(source, source.indexOf("enabled"));
    expect(text).toContain("enabled: boolean = true");
  });
});

describe("references and rename", () => {
  const source = ["model User {", "  id: int @id @auto", "  posts: Post[] @via(author)", "}", "model Post {", "  id: int @id @auto", "  authorId: int", "  author: User @relation(field: authorId)", "  @@index(authorId)", "}"].join("\n");
  test("model references include declaration and field types", () => {
    expect(references(source, source.indexOf("User")).length).toBe(2);
  });
  test("field references span relation binding and index", () => {
    expect(references(source, source.indexOf("authorId")).length).toBe(3);
  });
  test("via argument resolves to the target model field", () => {
    const offset = source.indexOf("@via(author)") + "@via(".length;
    expect(resolveSymbol(source, offset)).toEqual({ kind: "field", model: "Post", name: "author" });
    expect(references(source, offset).length).toBe(2);
  });
  test("morph bound columns are references", () => {
    const morph = 'model Comment {\n  id: int @id @auto\n  ownerType: "Post" | "User"\n  ownerId: int\n  owner: morph(ownerType, ownerId)\n}\n';
    expect(references(morph, morph.indexOf("ownerId")).length).toBe(2);
  });
  test("softDelete argument is a field reference", () => {
    const soft = "model A {\n  id: int @id\n  deletedAt?: datetime\n\n  @@softDelete(deletedAt)\n}\n";
    expect(references(soft, soft.indexOf("deletedAt")).length).toBe(2);
  });
  test("keywords are not symbols", () => {
    expect(resolveSymbol(source, source.indexOf("model"))).toBeUndefined();
    expect(references(source, source.indexOf("model"))).toEqual([]);
  });
  test("rename validates names like the parser", () => {
    expect(renameError({ kind: "model", name: "User" }, "Account")).toBeUndefined();
    expect(renameError({ kind: "model", name: "User" }, "int")).toBeDefined();
    expect(renameError({ kind: "model", name: "User" }, "$x")).toBeDefined();
    expect(renameError({ kind: "field", model: "User", name: "id" }, "$x")).toBeDefined();
    expect(renameError({ kind: "field", model: "User", name: "id" }, "__orm_x")).toBeDefined();
    expect(renameError({ kind: "field", model: "User", name: "id" }, "AND")).toBeDefined();
    expect(renameError({ kind: "field", model: "User", name: "id" }, "bad name")).toBeDefined();
  });
});
