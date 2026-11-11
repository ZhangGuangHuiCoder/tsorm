// where 过滤：比较运算、字符串匹配、NULL 语义、逻辑组合和关系过滤。
import { beforeEach, expect, test } from "bun:test";
import { eachDatabase, expectOrmError } from "../helpers/client.js";

eachDatabase("filters", (ctx) => {
  /** 按邮箱排序，返回匹配用户的 name 列表。 */
  const names = async (where: any) => {
    return (await ctx.db.user.findMany({ where, orderBy: { email: "asc" } })).map((u) => {
      return u.name;
    });
  };

  // 每个用例前准备四个用户，其中包含 name 或 age 为 NULL 的记录。
  beforeEach(async () => {
    await ctx.db.user.createMany({
      data: [
        { email: "a@x.com", name: "Alice", age: 30, role: "admin" },
        { email: "b@x.com", name: "Bob", age: 20 },
        { email: "c@x.com", name: "Carol", age: null },
        { email: "d@x.com", name: null, age: 40 },
      ],
    });
  });

  // 相等比较：裸值与 equals
  test("equality, bare values and equals", async () => {
    expect(await names({ name: "Bob" })).toEqual(["Bob"]);
    expect(await names({ name: { equals: "Bob" } })).toEqual(["Bob"]);
    expect(await names({ role: "admin" })).toEqual(["Alice"]);
  });

  // NULL 匹配与 not
  test("null matching and not", async () => {
    expect(await names({ age: null })).toEqual(["Carol"]);
    expect(await names({ name: null })).toEqual([null]);
    expect(await names({ name: { not: null } })).toEqual(["Alice", "Bob", "Carol"]);
    // { not: x } 同样会匹配 NULL
    expect(await names({ age: { not: 20 } })).toEqual(["Alice", "Carol", null]);
  });

  // 对非空字段使用 null 过滤会报错
  test("null on a required field is rejected", async () => {
    await expectOrmError(ctx.db.user.findMany({ where: { email: null } as any }), "VALIDATION");
  });

  // in / notIn，包括空列表
  test("in and notIn, including empty lists", async () => {
    expect(await names({ age: { in: [20, 40] } })).toEqual(["Bob", null]);
    // 取反条件包含 NULL，与 { not: x } 一致
    expect(await names({ age: { notIn: [20, 40] } })).toEqual(["Alice", "Carol"]);
    expect(await names({ age: { in: [] } })).toEqual([]);
    expect((await names({ age: { notIn: [] } })).length).toBe(4);
  });

  // 数字、字符串和日期的比较运算
  test("comparisons on numbers, strings and dates", async () => {
    expect(await names({ age: { gt: 20 } })).toEqual(["Alice", null]);
    expect(await names({ age: { gte: 20, lt: 40 } })).toEqual(["Alice", "Bob"]);
    expect(await names({ age: { lte: 20 } })).toEqual(["Bob"]);
    expect(await names({ name: { gt: "Bob" } })).toEqual(["Carol"]);
    expect((await names({ createdAt: { lte: new Date(Date.now() + 60_000) } })).length).toBe(4);
    expect(await names({ createdAt: { gt: "2999-01-01 00:00:00" } })).toEqual([]);
  });

  // 字符串匹配：contains / startsWith / endsWith
  test("string matching with contains, startsWith and endsWith", async () => {
    expect(await names({ name: { contains: "o" } })).toEqual(["Bob", "Carol"]);
    expect(await names({ name: { startsWith: "Al" } })).toEqual(["Alice"]);
    expect(await names({ name: { endsWith: "ol" } })).toEqual(["Carol"]);
    expect(await names({ email: { endsWith: "@x.com" }, name: { startsWith: "C" } })).toEqual(["Carol"]);
  });

  // mode: 'insensitive' 忽略大小写
  test("case-insensitive mode", async () => {
    expect(await names({ name: { equals: "alice", mode: "insensitive" } })).toEqual(["Alice"]);
    expect(await names({ name: { contains: "AR", mode: "insensitive" } })).toEqual(["Carol"]);
    expect(await names({ name: { startsWith: "bo", mode: "insensitive" } })).toEqual(["Bob"]);
  });

  // 模式中的 LIKE 通配符（% _ !）按字面量匹配
  test("LIKE wildcards in the pattern are matched literally", async () => {
    await ctx.db.user.createMany({
      data: [
        { email: "p1@y.com", name: "100%" },
        { email: "p2@y.com", name: "100 points" },
        { email: "p3@y.com", name: "a_b" },
        { email: "p4@y.com", name: "axb" },
        { email: "p5@y.com", name: "wow!" },
      ],
    });
    expect(await names({ name: { contains: "%" } })).toEqual(["100%"]);
    expect(await names({ name: { contains: "_" } })).toEqual(["a_b"]);
    expect(await names({ name: { endsWith: "!" } })).toEqual(["wow!"]);
  });

  // AND / OR / NOT 组合条件
  test("AND, OR and NOT combinations", async () => {
    expect(await names({ OR: [{ name: "Alice" }, { age: 40 }] })).toEqual(["Alice", null]);
    expect(await names({ AND: [{ age: { gte: 20 } }, { age: { lte: 30 } }] })).toEqual(["Alice", "Bob"]);
    expect(await names({ NOT: { name: { startsWith: "A" } } })).toEqual(["Bob", "Carol", null]);
    expect(await names({ NOT: { OR: [{ name: "Alice" }, { name: "Bob" }] } })).toEqual(["Carol", null]);
    // NOT 只接受单个条件对象，不接受数组。
    await expectOrmError(ctx.db.user.findMany({ where: { NOT: [{ name: "Alice" }] } as any }), "VALIDATION");
    expect(
      await names({
        OR: [{ AND: [{ role: "admin" }, { age: 30 }] }, { NOT: { age: { not: 20 } } }],
      }),
    ).toEqual(["Alice", "Bob"]);
  });

  // 空 AND 恒为真，空 OR 恒为假
  test("empty AND is always true and empty OR always false", async () => {
    expect((await names({ AND: [] })).length).toBe(4);
    expect(await names({ OR: [] })).toEqual([]);
  });

  // not 内嵌子条件
  test("not with a nested filter", async () => {
    expect(await names({ age: { not: { gte: 30 } } })).toEqual(["Bob", "Carol"]);
  });

  // where 嵌套超过上限时报错
  test("filters reject excessive nesting", async () => {
    let where: any = { name: "Alice" };
    for (let i = 0; i < 20; i++) {
      where = { AND: [where] };
    }
    await expectOrmError(ctx.db.user.findMany({ where }), "VALIDATION");
  });

  // 拒绝未知字段和未知运算符
  test("unknown fields and operators are rejected", async () => {
    await expectOrmError(ctx.db.user.findMany({ where: { nope: 1 } as any }), "VALIDATION");
    await expectOrmError(ctx.db.user.findMany({ where: { age: { like: 1 } } as any }), "VALIDATION");
  });

  // 关系过滤：some / none / every
  test("relation filters: some, none and every", async () => {
    const [alice, bob] = await ctx.db.user.findMany({ orderBy: { email: "asc" }, take: 2 });
    await ctx.db.post.createMany({
      data: [
        { title: "A1", authorId: alice.id, published: true },
        { title: "A2", authorId: alice.id, published: false },
        { title: "B1", authorId: bob.id, published: true },
      ],
    });
    expect(await names({ posts: { some: { published: false } } })).toEqual(["Alice"]);
    expect(await names({ posts: { some: {} } })).toEqual(["Alice", "Bob"]);
    expect(await names({ posts: { none: {} } })).toEqual(["Carol", null]);
    expect(await names({ posts: { none: { published: false } } })).toEqual(["Bob", "Carol", null]);
    // 没有文章的用户也满足 every（空集上恒为真）
    expect(await names({ posts: { every: { published: true } } })).toEqual(["Bob", "Carol", null]);
  });

  // 对一关系过滤：is / isNot
  test("relation filters: is and isNot on to-one relations", async () => {
    const [alice, bob] = await ctx.db.user.findMany({ orderBy: { email: "asc" }, take: 2 });
    await ctx.db.post.create({
      data: { title: "reviewed", authorId: alice.id, reviewerId: bob.id },
    });
    await ctx.db.post.create({ data: { title: "unreviewed", authorId: alice.id } });
    await ctx.db.profile.create({ data: { userId: bob.id, bio: "hi" } });

    const titles = async (where: any) => {
      return (await ctx.db.post.findMany({ where, orderBy: { title: "asc" } })).map((p) => {
        return p.title;
      });
    };
    expect(await titles({ reviewer: { is: null } })).toEqual(["unreviewed"]);
    expect(await titles({ reviewer: { isNot: null } })).toEqual(["reviewed"]);
    expect(await titles({ reviewer: { is: { name: "Bob" } } })).toEqual(["reviewed"]);
    expect(await titles({ author: { is: { name: "Alice" } } })).toEqual(["reviewed", "unreviewed"]);
    expect(await titles({ author: { isNot: { name: "Alice" } } })).toEqual([]);

    expect(await names({ profile: { is: { bio: "hi" } } })).toEqual(["Bob"]);
    expect(await names({ profile: { is: null } })).toEqual(["Alice", "Carol", null]);
    await expectOrmError(ctx.db.user.findMany({ where: { profile: null } as any }), "VALIDATION");
  });

  // 经由多对多和多层关系过滤
  test("relation filters through many-to-many and nested relations", async () => {
    const [alice] = await ctx.db.user.findMany({ orderBy: { email: "asc" }, take: 1 });
    await ctx.db.post.create({
      data: {
        title: "tagged",
        authorId: alice.id,
        tags: { create: [{ name: "ts" }, { name: "orm" }] },
      },
    });
    await ctx.db.post.create({ data: { title: "plain", authorId: alice.id } });
    const tagged = await ctx.db.post.findMany({ where: { tags: { some: { name: "ts" } } } });
    expect(
      tagged.map((p) => {
        return p.title;
      }),
    ).toEqual(["tagged"]);
    expect(await names({ posts: { some: { tags: { some: { name: "orm" } } } } })).toEqual(["Alice"]);
    const tags = await ctx.db.tag.findMany({
      where: { posts: { some: { author: { is: { name: "Alice" } } } } },
    });
    expect(
      tags
        .map((t) => {
          return t.name;
        })
        .sort(),
    ).toEqual(["orm", "ts"]);
  });

  // 外键字段可直接用于过滤
  test("foreign keys work directly in filters", async () => {
    const [alice] = await ctx.db.user.findMany({ orderBy: { email: "asc" }, take: 1 });
    await ctx.db.post.create({ data: { title: "fk", authorId: alice.id } });
    expect(await ctx.db.post.count({ where: { authorId: alice.id } })).toBe(1);
    expect(await ctx.db.post.count({ where: { authorId: { not: alice.id } } })).toBe(0);
  });
});
