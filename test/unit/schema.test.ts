// 模型解析、客户端生成与各数据库建表语句，含 datetime / timestamp 在其中的边界。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { generateClient, ignoredTable, parseSchema, schemaErrors, SchemaError, tableName, type Schema } from "../../src/schema/index.js";
import { encode } from "../../src/shared/scalars.js";
import { OrmError } from "../../src/index.js";
import { mysqlSchemaSQL } from "../../src/adapters/mysql/index.js";
import { postgresSchemaSQL } from "../../src/adapters/postgres/index.js";
import { sqliteSchemaSQL } from "../../src/adapters/sqlite/index.js";

const fixture = new URL("../fixtures/", import.meta.url);
const read = (name: string) => {
  return readFileSync(new URL(name, fixture), "utf8");
};

/** 解析预期失败的模型文本，并返回 SchemaError。 */
function parseError(text: string): SchemaError {
  try {
    parseSchema(text);
  } catch (error) {
    expect(error).toBeInstanceOf(SchemaError);
    return error as SchemaError;
  }
  throw new Error("Expected a SchemaError");
}

const ddl = (schema: Schema, dialect: "sqlite" | "postgres" | "mysql") => {
  if (dialect === "sqlite") {
    return sqliteSchemaSQL(schema).join("\n");
  }
  if (dialect === "postgres") {
    return postgresSchemaSQL(schema).join("\n");
  }
  return mysqlSchemaSQL(schema).join("\n");
};

describe("parseSchema", () => {
  const schema = parseSchema(read("schema.orm"));

  // 模型、列与主键
  test("models, columns and keys", () => {
    const user = schema.tables.User;
    expect(user.primary).toBe("id");
    expect(user.columns.id).toMatchObject({ type: "int", auto: true, primary: true });
    expect(user.columns.email).toMatchObject({ type: "string", unique: true, nullable: false });
    expect(user.columns.name.nullable).toBeTrue();
    expect(schema.tables.Membership.primaryKey).toEqual(["organization", "email"]);
  });

  // 关系按关系名生成外键列
  test("relations generate foreign keys named after the relation", () => {
    const post = schema.tables.Post;
    expect(post.columns.authorId).toMatchObject({ type: "int", nullable: false });
    expect(post.columns.reviewerId.nullable).toBeTrue();
    expect(post.relations.author).toMatchObject({ target: "User", owner: true, many: false });
    expect(schema.tables.User.relations.posts).toMatchObject({
      target: "Post",
      many: true,
      owner: false,
    });
    expect(schema.tables.Profile.columns.userId.unique).toBeTrue();
  });

  // 名称映射、软删除和 JSON 类型声明
  test("name mapping, soft delete and json types", () => {
    const product = schema.tables.Product;
    expect(product.map).toBe("products");
    expect(product.columns.sku.map).toBe("product_sku");
    expect(schema.tables.Account.softDelete).toBe("deletedAt");
    expect(schema.tables.Account.columns.deletedAt).toMatchObject({
      type: "datetime",
      nullable: true,
    });
    expect(schema.jsonTypes?.Settings).toBeDefined();
  });

  // 夹具声明全局前缀与忽略模式，且任何模型表或中间表都不落在忽略范围内
  test("the fixture declares a prefix and ignore patterns that match no model table", () => {
    expect(schema.prefix).toBe("app_");
    expect(schema.ignore).toEqual(["legacy_*", "misc"]);
    const ignored = ignoredTable(schema.ignore);
    const physical = Object.values(schema.tables).flatMap((t) => {
      return [
        tableName(t),
        ...Object.values(t.relations).flatMap((r) => {
          return r.junction ? [r.junction] : [];
        }),
      ];
    });
    expect(physical.filter(ignored)).toEqual([]);
  });

  // 语法错误带行号和列号
  test("syntax errors carry line and column numbers", () => {
    const error = parseError("model User {\n  id: int @id @auto\n  email: strin\n}");
    expect(error.line).toBe(3);
    expect(error.column).toBeGreaterThan(0);
    expect(error.message).toMatch(/^3:\d+ /);
  });

  // 各类非法模型写法都会被拒绝
  test.each([
    ["a model without a primary key", "model A {\n  name: string\n}"],
    ["an unknown relation target", "model A {\n  id: int @id\n  b: B\n}"],
    ["a duplicate field", "model A {\n  id: int @id\n  id: int\n}"],
    ["a reserved field name", "model A {\n  id: int @id\n  AND: int\n}"],
    ["a field starting with $", "model A {\n  id: int @id\n  $x: int\n}"],
    ["@auto on a string", "model A {\n  id: string(36) @id @auto\n}"],
    ["uuid() on a short string", "model A {\n  id: string(10) = uuid() @id\n}"],
    ["a default of the wrong type", 'model A {\n  id: int @id\n  n: int = "x"\n}'],
    ["bracketed index field lists", "model A {\n  id: int @id\n  e: string(9)\n  @@index([e])\n}"],
    ["an out-of-range string length", "model A {\n  id: int @id\n  s: string(20000)\n}"],
    ["an out-of-range decimal precision", "model A {\n  id: int @id\n  d: decimal(70, 2)\n}"],
    ["bytes as a key", "model A {\n  id: bytes @id\n}"],
  ])("rejects %s", (_, text) => {
    parseError(text);
  });
});

describe("morph", () => {
  const schema = parseSchema(read("schema.orm"));
  const attachment = schema.tables.Attachment;

  // 显式 morph：绑定列保持原样，双向关系携带判别元数据
  test("an explicit morph keeps the bound columns and registers both directions", () => {
    expect(attachment.columns.ownerType).toMatchObject({ type: "string", nullable: false });
    expect(attachment.columns.ownerType.enum).toEqual(["Post", "User"]);
    expect(attachment.columns.ownerId).toMatchObject({ type: "int", nullable: false });
    expect(attachment.relations.owner).toMatchObject({
      target: "",
      owner: true,
      many: false,
      polymorphic: true,
      source: "ownerId",
      discriminator: "ownerType",
    });
    expect(schema.tables.Post.relations.attachments).toMatchObject({
      target: "Attachment",
      owner: false,
      many: true,
      polymorphic: true,
      source: "id",
      foreign: "ownerId",
      discriminator: "ownerType",
      discriminatorValue: "Post",
    });
    expect(schema.tables.User.relations.attachments.discriminatorValue).toBe("User");
  });

  // 隐式 morph：自动生成 string(191) 判别列与与拥有方主键同型的 id 列
  test("an implicit morph generates the discriminator and id columns", () => {
    const note = schema.tables.Note;
    expect(note.columns.holderType).toMatchObject({
      type: "string",
      maxLength: 191,
      nullable: false,
    });
    expect(note.columns.holderId).toMatchObject({ type: "int", nullable: false });
    expect(note.relations.holder).toMatchObject({
      polymorphic: true,
      source: "holderId",
      discriminator: "holderType",
    });
  });

  // 最小多态模型：Post 为拥有方，file 为 morph 字段文本
  const poly = (file: string, post = "") => {
    return `model Post {\n  id: int @id @auto\n${post}}\nmodel File {\n  id: int @id @auto\n${file}}`;
  };

  test.each([
    ["an optional morph", poly("  h?: morph\n"), "required and singular"],
    ["a plural morph", poly("  hs: morph[]\n"), "required and singular"],
    ["a morph with a default", poly('  h: morph = "x"\n'), "cannot have a default"],
    ["a morph with attributes", poly("  h: morph @unique\n"), "take no attributes"],
    ["one bound column", poly("  t: string\n  k: int\n  h: morph(t)\n"), "two column names or none"],
    ["missing bound columns", poly("  h: morph(type, ref)\n"), "requires existing columns"],
    ["a nullable discriminator", poly("  t?: string\n  k: int\n  h: morph(t, k)\n"), "non-null string column"],
    ["a nullable morph id", poly("  t: string\n  k?: int\n  h: morph(t, k)\n"), "id column must be non-null"],
    ["key-bound morph columns", poly("  t: string @unique\n  k: int\n  h: morph(t, k)\n"), "cannot be keys"],
    ["morph without an inverse", poly("  h: morph\n"), "requires at least one inverse"],
    ["a singular inverse", poly("  h: morph\n", "  f?: File @via(h)\n"), "must be a required array"],
    ["a composite-key owner", "model Post {\n  code: string\n  n: int\n  @@id(code, n)\n  fs: File[] @via(h)\n}\nmodel File {\n  id: int @id @auto\n  h: morph\n}", "single-column primary key"],
    ["owners with different key types", "model Post {\n  id: int @id @auto\n  fs: File[] @via(h)\n}\nmodel User {\n  id: string @id\n  fs: File[] @via(h)\n}\nmodel File {\n  id: int @id @auto\n  h: morph\n}", "share one primary key type"],
    ["a morph id unlike the owner key", poly("  t: string\n  k: string\n  h: morph(t, k)\n", "  fs: File[] @via(h)\n"), "does not match the owners' primary key"],
    [
      "an enum missing an owner",
      'model Post {\n  id: int @id @auto\n  fs: File[] @via(h)\n}\nmodel User {\n  id: int @id @auto\n  fs: File[] @via(h)\n}\nmodel File {\n  id: int @id @auto\n  t: "Post" | "Other"\n  k: int\n  h: morph(t, k)\n}',
      "does not cover owner User",
    ],
    ["mixed implicit columns", poly("  holderType: string\n  holder: morph\n", "  fs: File[] @via(holder)\n"), "both columns explicit or both implicit"],
    ["two morphs on one discriminator", poly("  t: string\n  k1: int\n  k2: int\n  a: morph(t, k1)\n  b: morph(t, k2)\n", "  fs: File[] @via(a)\n"), "cannot serve multiple morph fields"],
    ["a model named morph", "model morph {\n  id: int @id\n}", "Invalid or duplicate model"],
  ])("rejects %s", (_, text, message) => {
    expect(parseError(text).message).toContain(message);
  });
});

describe("prefix", () => {
  const source = 'prefix "app_"\nmodel User {\n  id: int @id @auto\n  tags: Tag[]\n  @@index(id)\n}\nmodel Tag {\n  id: int @id @auto\n  users: User[] @via(tags)\n  @@map("labels")\n}';

  // 前缀加在所有物理表名上，包括 @@map 名称和多对多中间表；模型名不变
  test("prefixes every physical table name", () => {
    const schema = parseSchema(source);
    expect(schema.prefix).toBe("app_");
    expect(Object.keys(schema.tables)).toEqual(["User", "Tag"]);
    expect(tableName(schema.tables.User)).toBe("app_User");
    expect(tableName(schema.tables.Tag)).toBe("app_labels");
    expect(schema.tables.User.relations.tags.junction).toBe("app__User_tags");
    expect(schema.tables.Tag.relations.users.junction).toBe("app__User_tags");
    expect(parseSchema("model User {\n  id: int @id @auto\n}").prefix).toBeUndefined();
  });

  // 建表语句中的表名、索引名和外键引用都带前缀
  test.each(["sqlite", "postgres", "mysql"] as const)("%s DDL uses prefixed tables and index names", (dialect) => {
    const prefixed = ddl(parseSchema(source), dialect);
    const plain = ddl(parseSchema(source.replace('prefix "app_"\n', "")), dialect);
    expect(prefixed).toMatch(/CREATE TABLE ["`]app_User["`]/);
    expect(prefixed).toMatch(/CREATE TABLE ["`]app_labels["`]/);
    expect(prefixed).toMatch(/CREATE TABLE ["`]app__User_tags["`]/);
    expect(prefixed).not.toMatch(/["`](User|labels|_User_tags)["`]/);
    const indexNames = (sql: string) => {
      return [...sql.matchAll(/INDEX ["`]([^"`]+)["`]/g)].map((m) => {
        return m[1];
      });
    };
    expect(indexNames(prefixed).length).toBeGreaterThan(0);
    expect(
      indexNames(prefixed).filter((name) => {
        return indexNames(plain).includes(name);
      }),
    ).toEqual([]);
  });

  // ignore 按加前缀后的物理表名判断
  test("ignore patterns see prefixed names", () => {
    expect(parseError('prefix "a_"\nignore ["a_*"]\nmodel User {\n  id: int @id @auto\n}').message).toContain("Table a_User matches an ignore pattern");
    expect(parseSchema('prefix "a_"\nignore ["User"]\nmodel User {\n  id: int @id @auto\n}').prefix).toBe("a_");
  });

  test.each([
    ["a duplicate prefix", 'prefix "a_"\nprefix "b_"', "Duplicate prefix"],
    ["an empty prefix", 'prefix ""', "prefix requires a string"],
    ["a prefix with symbols", 'prefix "a-b"', "prefix requires a string"],
    ["a bare identifier", "prefix app", "prefix requires a string"],
  ])("rejects %s", (_, text, message) => {
    expect(parseError(text).message).toContain(message);
  });
});

describe("ignore", () => {
  // 顶层 ignore 声明其他系统的表，可多次出现并合并
  test("collects patterns from every ignore statement", () => {
    const schema = parseSchema('ignore ["legacy_*", "misc"]\nmodel User {\n  id: int @id @auto\n}\nignore ["shared"];');
    expect(schema.ignore).toEqual(["legacy_*", "misc", "shared"]);
    expect(parseSchema("model User {\n  id: int @id @auto\n}").ignore).toBeUndefined();
  });

  // * 匹配任意字符，其余字符（包括正则元字符）按字面匹配，不区分大小写
  test("matches * as a wildcard and everything else literally", () => {
    const ignored = ignoredTable(["legacy_*", "a.b", "*_misc"]);
    expect(["legacy_posts", "LEGACY_Posts", "legacy_", "a.b", "DATA_MISC"].filter(ignored)).toEqual(["legacy_posts", "LEGACY_Posts", "legacy_", "a.b", "DATA_MISC"]);
    expect(["axb", "legacy", "misc_x"].some(ignored)).toBeFalse();
    expect(ignoredTable(undefined)("anything")).toBeFalse();
  });

  // 模型表、@@map 和隐式多对多中间表都不能落在忽略范围内
  test.each([
    ["a model table", 'ignore ["User"]\nmodel User {\n  id: int @id @auto\n}', "Table User matches an ignore pattern"],
    ["a mapped table", 'ignore ["legacy_*"]\nmodel User {\n  id: int @id @auto\n  @@map("legacy_users")\n}', "Table legacy_users matches an ignore pattern"],
    ["a junction table", 'ignore ["_*"]\nmodel Post {\n  id: int @id @auto\n  tags: Tag[]\n}\nmodel Tag {\n  id: int @id @auto\n  posts: Post[] @via(tags)\n}', "matches an ignore pattern"],
    ["an empty list", "ignore []", "ignore requires a non-empty list"],
    ["a non-string entry", "ignore [1]", "ignore requires a non-empty list"],
    ["an empty pattern", 'ignore [""]', "ignore requires a non-empty list"],
    ["a bare string", 'ignore "legacy_*"', "ignore requires a non-empty list"],
    ["a duplicate pattern", 'ignore ["a", "A"]', "Duplicate ignore pattern A"],
    ["a table differing only in case", 'ignore ["user"]\nmodel User {\n  id: int @id @auto\n}', "Table User matches an ignore pattern"],
  ])("rejects %s", (_, text, message) => {
    expect(parseError(text).message).toContain(message);
  });
});

describe("generateClient", () => {
  /** 比较客户端语法结构，保留类型和字面量，忽略缩进、分隔符与属性名引号等格式差异。 */
  function syntax(source: string): unknown {
    const file = ts.createSourceFile("client.ts", source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): unknown => {
      if (ts.isParenthesizedTypeNode(node)) {
        return visit(node.type);
      }
      if (ts.isIdentifier(node) || ts.isLiteralExpression(node)) {
        const parent = node.parent;
        const property = (ts.isPropertySignature(parent) || ts.isPropertyAssignment(parent)) && parent.name === node;
        return [property ? "property" : node.kind, node.text];
      }
      const children: unknown[] = [];
      ts.forEachChild(node, (child) => {
        children.push(visit(child));
      });
      if (ts.isImportClause(node) || ts.isImportSpecifier(node)) {
        children.unshift(node.isTypeOnly);
      }
      if (ts.isVariableDeclarationList(node)) {
        children.unshift(node.flags & ts.NodeFlags.BlockScoped);
      }
      return [node.kind, children];
    };
    return visit(file);
  }

  // 提交的测试客户端与 fixture 模型保持同步，格式化不改变结果。
  test("the committed test client is up to date with the fixture schema", () => {
    const generated = generateClient(parseSchema(read("schema.orm")), "../../src/index.js");
    expect(syntax(read("client.ts"))).toEqual(syntax(generated));
  });

  test("client comparison ignores formatting but preserves types and values", () => {
    const source = 'export type Row = { "name"?: string }; export const schema = { "name": "a  b" };';
    expect(syntax(source)).toEqual(syntax('export type Row = {\n name?: string;\n};\nexport const schema = { name: "a  b", };'));
    for (const changed of [source.replace("?:", ":"), source.replace("string", "number"), source.replace("a  b", "a b"), source.replace("const", "let")]) {
      expect(syntax(changed)).not.toEqual(syntax(source));
    }
    expect(syntax('import type { Schema } from "../../src/index.js";')).not.toEqual(syntax('import { Schema } from "../../src/index.js";'));
    expect(syntax("type Rows = (string)[]; type Empty = { }; const values = [ ];")).toEqual(syntax("type Rows = string[]; type Empty = {}; const values = [];"));
    expect(syntax("type Rows = (string | number)[];")).not.toEqual(syntax("type Rows = string | number[];"));
  });

  // 每个模型都导出 Row / Create / Update / Unique 等类型
  test("exports row, create, update and unique types for every model", () => {
    const code = generateClient(parseSchema(read("schema.orm")));
    for (const model of ["User", "Post", "Membership", "Product"]) {
      for (const suffix of ["Row", "Create", "Update", "Unique", "ScalarCreate", "ScalarUpdate"]) {
        expect(code).toContain(`export type ${model}${suffix} =`);
      }
    }
    expect(code).toContain("export const createClient");
  });
});

describe("schema DDL", () => {
  const schema = parseSchema(read("schema.orm"));

  // SQLite 建表语句
  test("SQLite DDL", () => {
    const sql = sqliteSchemaSQL(schema).join("\n");
    expect(sql).toContain('CREATE TABLE "app_User"');
    expect(sql).toContain('CREATE TABLE "app_products"');
    expect(sql).toContain('"product_sku"');
    expect(sql).toContain('"app__Post_tags"');
    expect(sql).toMatch(/json_valid/);
    expect(sql).toMatch(/ON DELETE CASCADE/i);
    expect(sql).toMatch(/ON DELETE SET NULL/i);
  });

  // PostgreSQL 建表语句
  test("PostgreSQL DDL", () => {
    const sql = postgresSchemaSQL(schema).join("\n");
    expect(sql).toMatch(/GENERATED ALWAYS AS IDENTITY/);
    expect(sql).toMatch(/JSONB/i);
    expect(sql).toMatch(/NUMERIC\(10, ?2\)|DECIMAL\(10, ?2\)/i);
  });

  // MySQL 建表语句
  test("MySQL DDL", () => {
    const sql = mysqlSchemaSQL(schema).join("\n");
    expect(sql).toContain("CREATE TABLE `app_User`");
    expect(sql).toMatch(/ENGINE=InnoDB/i);
    expect(sql).toMatch(/utf8mb4_bin/);
  });

  // string 不写长度时按 191 处理：可索引，显式长度优先
  test("a bare string defaults to 191 and accepts an explicit length", () => {
    const s = parseSchema("model A {\n  id: int @id @auto\n  name: string @unique\n  slug: string(64)\n}");
    expect(s.tables.A.columns.name.maxLength).toBe(191);
    expect(s.tables.A.columns.slug.maxLength).toBe(64);
    const sql = mysqlSchemaSQL(s).join("\n");
    expect(sql).toContain("`name` VARCHAR(191)");
    expect(sql).toContain("`slug` VARCHAR(64)");
  });

  // 多态列是普通列：建表语句里没有外键约束
  test("polymorphic tables get no foreign keys", () => {
    const sql = ddl(schema, "sqlite");
    const attachment = sql.slice(sql.indexOf('CREATE TABLE "app_Attachment"'), sql.indexOf('CREATE TABLE "app_Note"'));
    expect(attachment).toContain('"ownerType"');
    expect(attachment).not.toMatch(/REFERENCES/i);
  });

  // 关系列索引与外键约束解耦：外键列与多态 ID 列在三库都建索引
  test("relation columns are indexed in every dialect", () => {
    const sqlite = ddl(schema, "sqlite");
    expect(sqlite).toContain('CREATE INDEX "app_Post_authorId_rel_idx" ON "app_Post" ("authorId")');
    expect(sqlite).toContain('CREATE INDEX "app_Attachment_ownerId_rel_idx" ON "app_Attachment" ("ownerId")');
    expect(sqlite).toContain('CREATE INDEX "app_Note_holderId_rel_idx" ON "app_Note" ("holderId")');
    expect(sqlite).toContain('CREATE INDEX "app__Post_tags_rel_idx" ON "app__Post_tags" ("targetId")');
    const postgres = ddl(schema, "postgres");
    expect(postgres).toMatch(/CREATE INDEX "orm_\w+" ON "app_Post" \("authorId"\)/);
    expect(postgres).toMatch(/CREATE INDEX "orm_\w+" ON "app_Attachment" \("ownerId"\)/);
    expect(postgres).toMatch(/CREATE INDEX "orm_\w+" ON "app_Note" \("holderId"\)/);
    expect(postgres).toMatch(/CREATE INDEX "orm_\w+" ON "app__Post_tags" \("targetId"\)/);
    const mysql = ddl(schema, "mysql");
    expect(mysql).toMatch(/INDEX `orm_\w+` \(`authorId`\)/);
    expect(mysql).toMatch(/INDEX `orm_\w+` \(`ownerId`\)/);
    expect(mysql).toMatch(/INDEX `orm_\w+` \(`holderId`\)/);
    expect(mysql).toMatch(/INDEX `orm_\w+` \(`targetId`\)/);
  });

  // 唯一列已有唯一索引，不再重复建关系列索引
  test("unique relation columns are not indexed twice", () => {
    expect(ddl(schema, "sqlite")).not.toContain("app_Profile_userId_rel_idx");
  });
});

describe("text scalar", () => {
  const schema = parseSchema("model Doc {\n  id: int @id @auto\n  body?: text\n}");

  test("text has no length and maps to an unbounded column", () => {
    const column = schema.tables.Doc.columns.body;
    expect(column.type).toBe("text");
    expect(column.maxLength).toBeUndefined();
    expect(ddl(schema, "mysql")).toContain("`body` LONGTEXT");
    expect(ddl(schema, "postgres")).toContain('"body" TEXT');
    const sqlite = ddl(schema, "sqlite");
    expect(sqlite).toContain('"body" TEXT');
    expect(sqlite).not.toContain('CHECK (length("body")');
  });

  test("text rejects a length, keys and indexes", () => {
    expect(parseError("model A {\n  id: int @id\n  body: text(64)\n}").message).toContain("Only string supports a length");
    expect(parseError("model A {\n  body: text @unique\n}").message).toContain("Text fields cannot be keys");
    expect(parseError("model A {\n  id: int @id\n  body: text\n  @@index(body)\n}").message).toContain("Text fields cannot be indexed");
  });

  test("text encodes strings without a length limit", () => {
    const body = schema.tables.Doc.columns.body;
    expect(encode(body, "x".repeat(20000))).toHaveLength(20000);
    try {
      encode(body, 42);
      throw new Error("expected a VALIDATION error");
    } catch (error) {
      expect(error).toBeInstanceOf(OrmError);
      expect((error as OrmError).code).toBe("VALIDATION");
    }
  });

  test("generated clients read text as string", () => {
    const client = generateClient(schema);
    expect(client).toContain('"body": string | null');
  });
});

describe("datetime scalar spelling and storage", () => {
  const schema = parseSchema(`
model Item {
  id: int @id
  at: datetime
  ts: timestamp
  late?: datetime
  stamps?: timestamp
}`);

  test("datetime keeps local string storage and timestamp selects epoch storage", () => {
    expect(schema.tables.Item.columns.at).toMatchObject({ type: "datetime", nullable: false });
    expect(schema.tables.Item.columns.at.dateStorage).toBeUndefined();
    expect(schema.tables.Item.columns.ts).toMatchObject({
      type: "datetime",
      dateStorage: "timestamp",
      nullable: false,
    });
  });

  test("nullability applies to both storage modes", () => {
    expect(schema.tables.Item.columns.late).toMatchObject({ type: "datetime", nullable: true });
    expect(schema.tables.Item.columns.late.dateStorage).toBeUndefined();
    expect(schema.tables.Item.columns.stamps).toMatchObject({
      type: "datetime",
      dateStorage: "timestamp",
      nullable: true,
    });
  });

  test("date is no longer a scalar and Date points at the correct spelling", () => {
    expect(parseError("model Item {\n  id: int @id\n  at: date\n}").message).toContain("Unknown model date");
    expect(parseError("model Item {\n  id: int @id\n  at: Date\n}").message).toContain("The datetime type is spelled datetime");
  });

  test("datetime fields cannot be arrays or auto-generated", () => {
    parseError("model Item {\n  id: int @id\n  at: datetime[]\n}");
    parseError("model Item {\n  id: datetime @id @auto\n}");
  });

  test("datetime can be a primary key or unique field", () => {
    const keyed = parseSchema("model Item {\n  id: datetime @id\n  at: datetime @unique\n}");
    expect(keyed.tables.Item.columns.id).toMatchObject({ type: "datetime", primary: true });
    expect(keyed.tables.Item.columns.at.unique).toBe(true);
  });
});

describe("now(), @updatedAt and soft delete", () => {
  test("now() is accepted for both storage modes only", () => {
    const schema = parseSchema("model Item {\n  id: int @id\n  at: datetime = now()\n  ts: timestamp = now()\n}");
    expect(schema.tables.Item.columns.at.default).toEqual({ fn: "now" });
    expect(schema.tables.Item.columns.ts.default).toEqual({ fn: "now" });
    parseError("model Item {\n  id: int @id\n  n: int = now()\n}");
    parseError("model Item {\n  id: int @id\n  s: string = now()\n}");
  });

  test("@updatedAt accepts datetime and timestamp only", () => {
    const schema = parseSchema("model Item {\n  id: int @id\n  at: datetime @updatedAt\n  ts: timestamp @updatedAt\n}");
    expect(schema.tables.Item.columns.at.updatedAt).toBe(true);
    expect(schema.tables.Item.columns.ts.updatedAt).toBe(true);
    parseError("model Item {\n  id: int @id\n  n: int @updatedAt\n}");
    parseError("model Item {\n  id: int @id\n  s: string @updatedAt\n}");
  });

  test("@updatedAt rejects defaults, primary keys and unique fields", () => {
    parseError("model Item {\n  id: int @id\n  at: datetime = now() @updatedAt\n}");
    parseError("model Item {\n  id: datetime @id @updatedAt\n}");
    parseError("model Item {\n  id: int @id\n  at: datetime @unique @updatedAt\n}");
    parseError("model Item {\n  id: int @id\n  at: datetime @updatedAt @updatedAt\n}");
  });

  test("an empty @@softDelete() adds a nullable datetime column", () => {
    const schema = parseSchema("model Item {\n  id: int @id @auto\n  @@softDelete()\n}");
    expect(schema.tables.Item.softDelete).toBe("deletedAt");
    expect(schema.tables.Item.columns.deletedAt).toMatchObject({
      type: "datetime",
      nullable: true,
      default: null,
    });
  });

  test("an explicit soft-delete field may use timestamp storage", () => {
    const schema = parseSchema("model Item {\n  id: int @id @auto\n  removedAt?: timestamp\n  @@softDelete(removedAt)\n}");
    expect(schema.tables.Item.softDelete).toBe("removedAt");
    expect(schema.tables.Item.columns.removedAt).toMatchObject({
      type: "datetime",
      dateStorage: "timestamp",
      nullable: true,
      default: null,
    });
  });

  test("soft delete rejects non-nullable and non-datetime fields", () => {
    parseError("model Item {\n  id: int @id\n  removedAt: datetime\n  @@softDelete(removedAt)\n}");
    parseError("model Item {\n  id: int @id\n  removedAt?: string\n  @@softDelete(removedAt)\n}");
    parseError("model Item {\n  id: int @id\n  removedAt?: int\n  @@softDelete(removedAt)\n}");
    parseError("model Item {\n  id: int @id\n  @@softDelete(missing)\n}");
    parseError("model Item {\n  id: int @id\n  a?: datetime\n  @@softDelete(a, a)\n}");
  });
});

describe("foreign-key storage inheritance", () => {
  test("an implicit relation column inherits timestamp storage and nullability", () => {
    const schema = parseSchema("model Parent {\n  id: timestamp @id\n}\nmodel Child {\n  id: int @id\n  parent?: Parent\n}");
    expect(schema.tables.Child.columns.parentId).toMatchObject({
      type: "datetime",
      dateStorage: "timestamp",
      nullable: true,
    });
  });

  test("an explicit relation column may repeat matching timestamp storage", () => {
    const schema = parseSchema("model Parent {\n  id: timestamp @id\n}\nmodel Child {\n  id: int @id\n  parentId: timestamp\n  parent: Parent @relation(field: parentId)\n}");
    expect(schema.tables.Child.columns.parentId.dateStorage).toBe("timestamp");
  });

  test("storage or nullability mismatches are rejected", () => {
    parseError("model Parent {\n  id: timestamp @id\n}\nmodel Child {\n  id: int @id\n  parentId: datetime\n  parent: Parent @relation(field: parentId)\n}");
    parseError("model Parent {\n  id: timestamp @id\n}\nmodel Child {\n  id: int @id\n  parentId?: timestamp\n  parent: Parent @relation(field: parentId)\n}");
  });
});

describe("dialect DDL", () => {
  const schema = parseSchema(`
model Item {
  id: int @id @auto
  at: datetime
  ts: timestamp
  localNow: datetime = now()
  epochNow: timestamp = now()
  updated: datetime @updatedAt
  optional?: datetime
}`);

  test("SQLite uses TEXT for local datetimes and INTEGER for timestamps", () => {
    const sql = ddl(schema, "sqlite");
    expect(sql).toContain('"at" TEXT NOT NULL');
    expect(sql).toContain('"ts" INTEGER NOT NULL');
    expect(sql).toContain('"optional" TEXT DEFAULT NULL');
    expect(sql).toContain("strftime('%Y-%m-%d %H:%M:%f','now','localtime')");
    expect(sql).toContain("unixepoch('subsec')*1000");
    // @updatedAt is applied by the client and must not add a database default.
    expect(sql).toContain('"updated" TEXT NOT NULL,');
  });

  test("PostgreSQL uses TIMESTAMP(3) and BIGINT storage", () => {
    const sql = ddl(schema, "postgres");
    expect(sql).toContain('"at" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL');
    expect(sql).toContain('"ts" BIGINT NOT NULL');
    expect(sql).toContain('"optional" TIMESTAMP(3) WITHOUT TIME ZONE DEFAULT NULL');
    expect(sql).toContain("DEFAULT CURRENT_TIMESTAMP");
    expect(sql).toContain("EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)*1000");
    expect(sql).toContain('"updated" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL');
  });

  test("MySQL uses DATETIME(3) and BIGINT storage", () => {
    const sql = ddl(schema, "mysql");
    expect(sql).toContain("`at` DATETIME(3) NOT NULL");
    expect(sql).toContain("`ts` BIGINT NOT NULL");
    expect(sql).toContain("`optional` DATETIME(3) DEFAULT NULL");
    expect(sql).toContain("DEFAULT CURRENT_TIMESTAMP(3)");
    expect(sql).toContain("UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000");
    expect(sql).toContain("`updated` DATETIME(3) NOT NULL");
  });
});

describe("generated client types", () => {
  const schema = parseSchema(`
model Item {
  id: int @id @auto
  at: datetime
  ts: timestamp
  note: string
  n?: datetime
}`);
  const code = generateClient(schema);

  test("both storage modes expose DateTime rows and DateTimeInput writes", () => {
    expect(code).toContain('"at": DateTime;');
    expect(code).toContain('"ts": DateTime;');
    expect(code).toContain('"n": DateTime | null;');
    expect(code).toContain('"at": DateTimeInput;');
    expect(code).toContain('"ts": DateTimeInput;');
    expect(code).toContain('"n"?: DateTimeInput | null;');
    expect(code).toContain('"at"?: FieldUpdate<DateTimeInput>;');
    expect(code).toContain('"n"?: FieldUpdate<DateTimeInput | null>');
  });

  test("dateFields lists datetime and timestamp fields only, in declaration order", () => {
    const models = code.split("\n").find((line) => {
      return line.includes('"Item": { row:');
    });
    expect(models).toBeDefined();
    expect(models).toContain('dateFields:"at" | "ts" | "n"');
    expect(models).not.toContain('"note"');
  });
});

describe("schemaErrors", () => {
  test("valid schema has no errors", () => {
    expect(schemaErrors(read("schema.orm"))).toEqual([]);
  });
  test("collects one error per broken statement and keeps parsing", () => {
    const errors = schemaErrors("model A { id: int @id @id } model B { id: int @id x: int( } model C { id: int @id }");
    expect(errors.length).toBe(2);
    expect(errors[0].message).toContain("Duplicate @id");
    expect(errors[1].message).toContain("Only string supports a length");
  });
  test("semantic error is reported when syntax is valid", () => {
    const errors = schemaErrors("model A { id: int @id b: B }");
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("Unknown model B");
  });
  test("syntax errors suppress cascading semantic errors", () => {
    const errors = schemaErrors("model A { id: int @id @id } model B { id: int @id a: A }");
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("Duplicate @id");
  });
  test("lexical errors are reported", () => {
    const errors = schemaErrors("model A { id: % }");
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("Unexpected character");
  });
  test("recovers across prefix, ignore and type statements", () => {
    const errors = schemaErrors('prefix "a_" prefix "b_" type T = { x: } ignore [] model A { id: int @id }');
    expect(errors.length).toBe(3);
  });
  test("parseSchema still throws the first error", () => {
    expect(() => {
      return parseSchema("model A { id: int @id @id } model B { id: int @id x: int( }");
    }).toThrow(SchemaError);
  });
});

describe("comments", () => {
  const schema = parseSchema(`// 笔记表
model Note {
  id: int @id @auto // 主键
  title: string // 标题
}`);

  test("parses column and table comments", () => {
    expect(schema.tables.Note.columns.id.comment).toBe("主键");
    expect(schema.tables.Note.columns.title.comment).toBe("标题");
    expect(schema.tables.Note.comment).toBe("笔记表");
  });

  test("MySQL renders inline COMMENT on columns and tables", () => {
    const sql = mysqlSchemaSQL(schema).join("\n");
    expect(sql).toContain("COMMENT '主键'");
    expect(sql).toContain("COMMENT '标题'");
    expect(sql).toContain("COMMENT='笔记表'");
  });

  test("PostgreSQL renders COMMENT ON statements", () => {
    const sql = postgresSchemaSQL(schema).join("\n");
    expect(sql).toContain(`COMMENT ON TABLE "Note" IS '笔记表'`);
    expect(sql).toContain(`COMMENT ON COLUMN "Note"."id" IS '主键'`);
    expect(sql).toContain(`COMMENT ON COLUMN "Note"."title" IS '标题'`);
  });

  test("SQLite ignores comments", () => {
    const sql = sqliteSchemaSQL(schema).join("\n");
    expect(sql).not.toContain("主键");
    expect(sql).not.toContain("笔记表");
  });

  test("single quotes are doubled in DDL", () => {
    const s = parseSchema(`// a'b
model A { id: int @id // it's
}`);
    expect(mysqlSchemaSQL(s).join("\n")).toContain("COMMENT 'it''s'");
    expect(mysqlSchemaSQL(s).join("\n")).toContain("COMMENT='a''b'");
    expect(postgresSchemaSQL(s).join("\n")).toContain("IS 'a''b'");
  });

  test("joins consecutive comment lines and skips block or detached comments", () => {
    const s = parseSchema(`// 第一行
// 第二行
model A {
  id: int @id
  // 独立行不附着
  name: string
}
/* 块注释不附着 */
model B { id: int @id }`);
    expect(s.tables.A.comment).toBe("第一行\n第二行");
    expect(s.tables.A.columns.id.comment).toBeUndefined();
    expect(s.tables.A.columns.name.comment).toBeUndefined();
    expect(s.tables.B.comment).toBeUndefined();
  });

  test("relation fields comment the generated foreign key", () => {
    const s = parseSchema(`model A { id: int @id b: B // 外键
} model B { id: int @id }`);
    expect(s.tables.A.columns.bId.comment).toBe("外键");
  });

  test("rejects oversized comments", () => {
    expect(schemaErrors(`model A { id: int @id // ${"x".repeat(1025)}\n}`)[0].message).toContain("1024");
    expect(schemaErrors(`// ${"x".repeat(1025)}\nmodel A { id: int @id }`)[0].message).toContain("1024");
  });
});
