// 类型化 JSON：结构校验、按路径过滤、更新与 SQL NULL。
import { beforeEach, expect, test } from "bun:test";
import { DbNull } from "../../src/index.js";
import { eachDatabase, expectOrmError } from "../helpers/client.js";

eachDatabase("typed json", (ctx) => {
  beforeEach(async () => {
    await ctx.db.account.createMany({
      data: [
        {
          email: "a@x.com",
          settings: { theme: "dark", notifications: true, tags: ["alpha", "beta"], score: 10 },
        },
        {
          email: "b@x.com",
          settings: { theme: "light", notifications: false, tags: ["beta"], score: 3 },
        },
        { email: "c@x.com", settings: { theme: "light", notifications: true, tags: [] } },
        { email: "d@x.com", settings: null },
      ],
    });
  });

  const emails = async (where: any) => {
    return (await ctx.db.account.findMany({ where, orderBy: { email: "asc" } })).map((a) => {
      return a.email;
    });
  };

  // 结构化 JSON 值读写往返
  test("round-trips structured values", async () => {
    const row = await ctx.db.account.findUniqueOrThrow({ where: { email: "a@x.com" } });
    expect(row.settings).toEqual({
      theme: "dark",
      notifications: true,
      tags: ["alpha", "beta"],
      score: 10,
    });
    expect((await ctx.db.account.findUniqueOrThrow({ where: { email: "d@x.com" } })).settings).toBeNull();
  });

  // 拒绝不符合声明结构的值
  test("rejects values that do not match the declared shape", async () => {
    const bad = (settings: any) => {
      return ctx.db.account.create({ data: { email: "bad@x.com", settings } });
    };
    await expectOrmError(bad({ theme: "blue", notifications: true, tags: [] }), "VALIDATION");
    await expectOrmError(bad({ theme: "dark", notifications: "yes", tags: [] }), "VALIDATION");
    await expectOrmError(bad({ theme: "dark", notifications: true, tags: [], extra: 1 }), "VALIDATION");
    await expectOrmError(bad({ theme: "dark", notifications: true }), "VALIDATION");
    await expectOrmError(bad({ theme: "dark", notifications: true, tags: [], score: Infinity }), "VALIDATION");
    await expectOrmError(bad({ theme: "dark", notifications: true, tags: [new Date()] }), "VALIDATION");
  });

  // 按路径过滤：equals / not
  test("path filters with equals and not", async () => {
    expect(await emails({ settings: { path: ["theme"], equals: "light" } })).toEqual(["b@x.com", "c@x.com"]);
    expect(await emails({ settings: { path: ["notifications"], equals: true } })).toEqual(["a@x.com", "c@x.com"]);
    // 与标量取反一样，JSON 的 not 也会匹配整列为 SQL NULL 的记录。
    expect(await emails({ settings: { path: ["theme"], not: "light" } })).toEqual(["a@x.com", "d@x.com"]);
    // 类型不同视为不相等。
    expect(await emails({ settings: { path: ["score"], equals: "10" } })).toEqual([]);
  });

  // 按路径做数值比较，以及数组下标路径
  test("path filters with numeric comparison and array indexes", async () => {
    expect(await emails({ settings: { path: ["score"], gt: 5 } })).toEqual(["a@x.com"]);
    expect(await emails({ settings: { path: ["score"], lte: 10 } })).toEqual(["a@x.com", "b@x.com"]);
    expect(await emails({ settings: { path: ["tags", 0], equals: "beta" } })).toEqual(["b@x.com"]);
    expect(await emails({ settings: { path: ["tags", 1], string_starts_with: "be" } })).toEqual(["a@x.com"]);
  });

  // 字符串运算符不匹配非字符串值
  test("path filters with string operators ignore non-strings", async () => {
    expect(await emails({ settings: { path: ["theme"], string_contains: "igh" } })).toEqual(["b@x.com", "c@x.com"]);
    expect(await emails({ settings: { path: ["theme"], string_ends_with: "rk" } })).toEqual(["a@x.com"]);
    expect(await emails({ settings: { path: ["score"], string_contains: "1" } })).toEqual([]);
  });

  // JSON 字段只接受带 path 的过滤
  test("JSON columns only accept path filters", async () => {
    await expectOrmError(ctx.db.account.findMany({ where: { settings: null } as any }), "VALIDATION");
    await expectOrmError(ctx.db.account.findMany({ where: { settings: { equals: "x" } } as any }), "VALIDATION");
  });

  // update 整体替换值，DbNull 写入 SQL NULL
  test("update replaces the whole value and DbNull clears it", async () => {
    const row = await ctx.db.account.update({
      where: { email: "a@x.com" },
      data: { settings: { set: { theme: "light", notifications: false, tags: ["z"] } } },
    });
    expect(row.settings).toEqual({ theme: "light", notifications: false, tags: ["z"] });
    const cleared = await ctx.db.account.update({
      where: { email: "a@x.com" },
      data: { settings: { set: DbNull } },
    });
    expect(cleared.settings).toBeNull();
  });

  // JSON 字段不能用于排序
  test("JSON fields cannot be used for ordering", async () => {
    await expectOrmError(ctx.db.account.findMany({ orderBy: { settings: "asc" } } as any), "VALIDATION");
  });
});
