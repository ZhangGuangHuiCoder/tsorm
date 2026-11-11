import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseTargets } from "../helpers/databases.js";
import { createClient } from "../../src/core/client.js";
import { parseSchema, generateClient, SchemaError } from "../../src/schema/index.js";
import { sqlite } from "../../src/adapters/sqlite/index.js";
import { checksIn, squash } from "../../src/migrations/introspect.js";
import { diffModels, evaluateRisks } from "../../src/migrations/diff.js";
import { providerFor } from "../../src/adapters/providers.js";
import { encode, decodeBigInt } from "../../src/shared/scalars.js";
import type { Connection } from "../../src/migrations/provider.js";

const invalidSchemas = [
  ["duplicate table mapping", 'model Item { id: int @id @@map("a") @@map("b") }'],
  ["duplicate composite key", "model Item { a: int b: int c: int @@id(a, b) @@id(b, c) }"],
  ["ignored relation mapping", 'model User { id: int @id } model Post { id: int @id author: User @map("author") }'],
  ["ignored relation updatedAt", "model User { id: int @id } model Post { id: int @id author: User @updatedAt }"],
  ["physical table collision", 'model A { id: int @id @@map("same") } model B { id: int @id @@map("same") }'],
  ["physical column collision", 'model A { id: int @id value: string @map("id") }'],
  ["junction table collision", 'model A { id: int @id bs: B[] } model B { id: int @id @@map("_A_bs") }'],
  ["history table collision", 'model Item { id: int @id @@map("_tsorm_migrations") }'],
  ["unterminated string length", "model Item { id: int @id name: string("],
  ["unterminated decimal", "model Item { id: int @id amount: decimal("],
  ["reserved imported type", "type Invalid = string model Item { id: int @id value: json<Invalid> }"],
  ["reserved TypeScript type", "type class = string model Item { id: int @id value: json<class> }"],
] as const;

describe("recursive schema review", () => {
  test.each(invalidSchemas)("rejects %s with a schema diagnostic", (_, source) => {
    expect(() => {
      return parseSchema(source);
    }).toThrow(SchemaError);
  });

  test("generated JSON shapes preserve own __proto__ properties", async () => {
    const schema = parseSchema("type Data = { __proto__: string } model Item { id: int @id @auto value: json<Data> }");
    const source = generateClient(schema);
    const expression = source.split("export const schema: Schema = ")[1].split(";\nexport const createClient")[0];
    const generated = new Function("return (" + expression + ")")();
    const db = await createClient(generated, { adapter: sqlite({ initialize: true }) });
    try {
      const value = JSON.parse('{"__proto__":"data"}');
      expect((await db.item.create({ data: { value } })).value).toEqual(value);
    } finally {
      await db.$close();
    }
  });
});

describe("migration and numeric review", () => {
  test("risk-query failure stops the migration assessment", async () => {
    const error = new Error("database count unavailable");
    const conn = {
      provider: await providerFor("file:./test.db"),
      query: async () => {
        throw error;
      },
    } as unknown as Connection;
    await expect(evaluateRisks(conn, [{ kind: "dropTable", table: "Item" }])).rejects.toBe(error);
  });

  test("decimal validation accepts leading zeros without inventing integer digits", () => {
    const column = parseSchema("model Item { id: int @id value: decimal(2, 2) }").tables.Item.columns.value;
    expect(encode(column, "00.12")).toBe("00.12");
    expect(() => {
      return encode(column, "01.12");
    }).toThrow();
  });

  test("bigint decoding refuses already-rounded unsafe number inputs", () => {
    expect(() => {
      return decodeBigInt(Number.MAX_SAFE_INTEGER + 1);
    }).toThrow();
    expect(decodeBigInt("9007199254740993")).toBe("9007199254740993");
  });
});

describe("extension and relation integration", () => {
  test("nested disconnect uses internal keys even when the target key is omitted", async () => {
    const schema = parseSchema("model Post { id: int @id @auto tags: Tag[] } model Tag { id: int @id @auto name: string @unique posts: Post[] @via(tags) }");
    const base = await createClient(schema, { adapter: sqlite({ initialize: true }) });
    try {
      const post = await base.post.create({ data: { tags: { create: { name: "a" } } } });
      const db = base.$extend({ omit: { tag: { id: true } } });
      await db.post.update({
        where: { id: post.id },
        data: { tags: { disconnect: { name: "a" } } },
      });
      expect(await base.post.findUnique({ where: { id: post.id }, include: { tags: true } })).toMatchObject({ tags: [] });
      expect(await base.tag.count()).toBe(1);
    } finally {
      await base.$close();
    }
  });
});

describe("migration SQL normalization", () => {
  test("preserves whitespace inside SQL literals and quoted names", () => {
    expect(squash("  CHECK  (name IN ('a  b', 'c\n d'))  ")).toBe("CHECK (name IN ('a  b', 'c\n d'))");
    expect(squash('  "column  name"   =   1 ')).toBe('"column  name" = 1');
  });
  test("extracts consecutive checks using original offsets", () => {
    expect(checksIn("value TEXT CHECK   (length(value)  >  0) CHECK (value <> 'a  b')")).toEqual(["(length(value) > 0)", "(value <> 'a  b')"]);
  });
});

describe("virtual configuration validation", () => {
  test.each(
    [
      null,
      [],
      { item: null },
      {
        item: {
          invalid: {
            needs: [],
            compute: () => {
              return 1;
            },
          },
        },
      },
    ].map((value) => {
      return [value];
    }),
  )("invalid virtual map %# reports VALIDATION", async (virtuals) => {
    const db = await createClient(parseSchema("model Item { id: int @id }"), { adapter: sqlite() });
    try {
      try {
        db.$extend({ virtuals } as any);
        throw new Error("Expected validation failure");
      } catch (error) {
        expect(error).toMatchObject({ code: "VALIDATION" });
      }
    } finally {
      await db.$close();
    }
  });
});

test("migration diff detects enum literals differing only in internal whitespace", async () => {
  const provider = await providerFor("file::memory:");
  const before = await provider.connect(provider.parseDatasource("file::memory:", "."));
  const after = await provider.connect(provider.parseDatasource("file::memory:", "."));
  try {
    for (const sql of provider.schemaDDL(parseSchema('model Item { id: int @id value: "a  b" | "c" }'))) {
      await before.script(sql);
    }
    for (const sql of provider.schemaDDL(parseSchema('model Item { id: int @id value: "a b" | "c" }'))) {
      await after.script(sql);
    }
    expect(diffModels(await provider.introspect(before), await provider.introspect(after)).empty).toBe(false);
  } finally {
    await before.close();
    await after.close();
  }
});

describe("generated bigint identities without RETURNING", () => {
  test.each(["create", "createManyAndReturn"])("%s preserves generated ids above the safe number range", async (operation) => {
    const schema = parseSchema("model Item { id: bigint @id @auto name: string }");
    const base = await sqlite({ initialize: true }).connect(schema);
    const db = await createClient(schema, {
      adapter: {
        name: "sqlite",
        connect: () => {
          return { ...base, capabilities: { ...base.capabilities, returning: false } };
        },
      },
    });
    try {
      await db.$executeRaw`INSERT INTO "Item" ("id", "name") VALUES (${9007199254740993n}, ${"seed"})`;
      const result = operation === "create" ? await db.item.create({ data: { name: "created" } }) : (await db.item.createManyAndReturn({ data: [{ name: "created" }] }))[0];
      expect(result.id).toBe("9007199254740994");
    } finally {
      await db.$close();
    }
  });
});

test("decimal and bigint aggregate values match their declared result types", async () => {
  const { createClient: createTypedClient } = await import("../fixtures/client.js");
  const db = await createTypedClient({ adapter: sqlite({ initialize: true }) });
  try {
    await db.product.createMany({
      data: [
        { sku: "a", price: "1.00", stock: 2n },
        { sku: "b", price: "3.00", stock: 4n },
      ],
    });
    const result = await db.product.aggregate({
      _sum: { price: true, stock: true },
      _avg: { price: true, stock: true },
    });
    expect(result).toEqual({
      _sum: { price: "4.00", stock: "6" },
      _avg: { price: "2", stock: "3" },
    });
  } finally {
    await db.$close();
  }
});

describe("explicit database test target validation", () => {
  test.each(["", "unknown", "sqlite,unknown"])("rejects invalid TEST_DATABASES: %s", (value) => {
    expect(() => {
      return parseTargets(value);
    }).toThrow("TEST_DATABASES");
  });
  test("deduplicates valid targets and preserves automatic detection when absent", () => {
    expect(parseTargets(" sqlite,postgres,sqlite ")).toEqual(["sqlite", "postgres"]);
    expect(parseTargets(undefined)).toBeUndefined();
  });
});

test.each(["--force=false", "--reset=false"])("CLI rejects assigned boolean flags: %s", (flag) => {
  const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "push", flag], {
    env: { ...process.env, CI: "1", DATABASE_URL: "file::memory:" },
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("does not accept a value");
});
