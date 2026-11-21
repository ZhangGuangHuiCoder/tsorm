// 查询形态：投影、关系加载、计数、排序、分页、游标、去重和自关联。
import { beforeEach, expect, test } from "bun:test";
import { eachDatabase, expectOrmError } from "../helpers/client.js";

eachDatabase("queries", (ctx) => {
  let alice: { id: number };
  let bob: { id: number };

  // 每个用例前准备三个用户：Alice 有资料和三篇文章，Bob 有一篇文章，Carol 没有文章。
  beforeEach(async () => {
    alice = await ctx.db.user.create({
      data: {
        email: "alice@x.com",
        name: "Alice",
        age: 30,
        profile: { create: { bio: "Alice bio" } },
        posts: {
          create: [
            { title: "A1", views: 5, published: true, tags: { create: [{ name: "ts" }] } },
            { title: "A2", views: 50, published: false },
            { title: "A3", views: 20, published: true, rating: 4.5 },
          ],
        },
      },
    });
    bob = await ctx.db.user.create({
      data: {
        email: "bob@x.com",
        name: null,
        age: 20,
        posts: { create: [{ title: "B1", views: 10 }] },
      },
    });
    await ctx.db.user.create({ data: { email: "carol@x.com", name: "Carol" } });
  });

  // select 只返回选中的字段
  test("select returns only the chosen fields", async () => {
    const rows = await ctx.db.user.findMany({ select: { email: true }, orderBy: { id: "asc" } });
    expect(rows).toEqual([{ email: "alice@x.com" }, { email: "bob@x.com" }, { email: "carol@x.com" }]);
  });

  // select 嵌套关系，并带过滤、排序和分页
  test("select with nested relations, filters and pagination", async () => {
    const row = await ctx.db.user.findUniqueOrThrow({
      where: { id: alice.id },
      select: {
        name: true,
        profile: { select: { bio: true } },
        posts: {
          where: { published: true },
          orderBy: { views: "desc" },
          take: 1,
          select: { title: true, tags: { select: { name: true } } },
        },
      },
    });
    expect(row).toEqual({
      name: "Alice",
      profile: { bio: "Alice bio" },
      posts: [{ title: "A3", tags: [] }],
    });
  });

  // include 在完整记录上附加关系
  test("include attaches relations to the full record", async () => {
    const post = await ctx.db.post.findFirstOrThrow({
      where: { title: "A1" },
      include: { author: true, tags: true, reviewer: true },
    });
    expect(post.author.email).toBe("alice@x.com");
    expect(post.reviewer).toBeNull();
    expect(
      post.tags.map((t) => {
        return t.name;
      }),
    ).toEqual(["ts"]);
    expect(post.title).toBe("A1");
  });

  // 可选对一关系不存在时 include 返回 null
  test("include on a missing optional to-one relation returns null", async () => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: bob.id },
      include: { profile: true },
    });
    expect(user.profile).toBeNull();
  });

  // omit 去掉字段，但不影响关系加载
  test("omit removes fields but keeps relation loading working", async () => {
    const post = await ctx.db.post.findFirstOrThrow({
      where: { title: "A1" },
      omit: { authorId: true, createdAt: true },
      include: { author: { select: { email: true } } },
    });
    expect(post).not.toHaveProperty("authorId");
    expect(post).not.toHaveProperty("createdAt");
    expect(post.author).toEqual({ email: "alice@x.com" });
  });

  // select 不能与 include 或 omit 同时使用
  test("select cannot be combined with include or omit", async () => {
    await expectOrmError(ctx.db.user.findMany({ select: { id: true }, include: { posts: true } } as any), "VALIDATION");
    await expectOrmError(ctx.db.user.findMany({ select: { id: true }, omit: { name: true } } as any), "VALIDATION");
  });

  // 对多关系的分页按每个父记录独立计算
  test("to-many include paginates per parent", async () => {
    const users = await ctx.db.user.findMany({
      orderBy: { id: "asc" },
      include: { posts: { orderBy: { views: "desc" }, take: 2, select: { title: true } } },
    });
    expect(
      users.map((u) => {
        return u.posts.map((p) => {
          return p.title;
        });
      }),
    ).toEqual([["A2", "A3"], ["B1"], []]);
  });

  // 关系计数 _count
  test("_count of relations", async () => {
    const rows = await ctx.db.user.findMany({
      orderBy: { id: "asc" },
      select: { email: true, _count: { select: { posts: true, comments: true } } },
    });
    expect(
      rows.map((r) => {
        return r._count;
      }),
    ).toEqual([
      { posts: 3, comments: 0 },
      { posts: 1, comments: 0 },
      { posts: 0, comments: 0 },
    ]);
    const filtered = await ctx.db.user.findUniqueOrThrow({
      where: { id: alice.id },
      select: { _count: { select: { posts: { where: { published: true } } } } },
    });
    expect(filtered._count.posts).toBe(2);
    const all = await ctx.db.user.findUniqueOrThrow({
      where: { id: alice.id },
      include: { _count: true },
    });
    expect(all._count).toMatchObject({
      posts: 3,
      reviewed: 0,
      comments: 0,
      following: 0,
      followers: 0,
    });
  });

  // 多字段排序，并自动追加主键保证稳定
  test("orderBy multiple fields with a stable primary key tiebreaker", async () => {
    await ctx.db.post.create({ data: { title: "A4", views: 5, authorId: alice.id } });
    const rows = await ctx.db.post.findMany({ orderBy: [{ views: "asc" }, { title: "desc" }] });
    expect(
      rows.map((p) => {
        return p.title;
      }),
    ).toEqual(["A4", "A1", "B1", "A3", "A2"]);
  });

  // NULL 升序在前、降序在后，也可用 nulls 显式指定
  test("NULL sorts first ascending, last descending, and can be placed explicitly", async () => {
    const asc = await ctx.db.user.findMany({ orderBy: { name: "asc" } });
    expect(
      asc.map((u) => {
        return u.name;
      }),
    ).toEqual([null, "Alice", "Carol"]);
    const desc = await ctx.db.user.findMany({ orderBy: { name: "desc" } });
    expect(
      desc.map((u) => {
        return u.name;
      }),
    ).toEqual(["Carol", "Alice", null]);
    const ascLast = await ctx.db.user.findMany({
      orderBy: { name: { sort: "asc", nulls: "last" } },
    });
    expect(
      ascLast.map((u) => {
        return u.name;
      }),
    ).toEqual(["Alice", "Carol", null]);
    const descFirst = await ctx.db.user.findMany({
      orderBy: { name: { sort: "desc", nulls: "first" } },
    });
    expect(
      descFirst.map((u) => {
        return u.name;
      }),
    ).toEqual([null, "Carol", "Alice"]);
  });

  // 按对一关系字段和对多关系计数排序
  test("orderBy a to-one relation field and a to-many relation count", async () => {
    const posts = await ctx.db.post.findMany({
      orderBy: [{ author: { email: "desc" } }, { title: "asc" }],
    });
    expect(
      posts.map((p) => {
        return p.title;
      }),
    ).toEqual(["B1", "A1", "A2", "A3"]);
    const users = await ctx.db.user.findMany({ orderBy: { posts: { _count: "desc" } } });
    expect(
      users.map((u) => {
        return u.email;
      }),
    ).toEqual(["alice@x.com", "bob@x.com", "carol@x.com"]);
  });

  // skip 与 take 分页及参数校验
  test("skip and take", async () => {
    const page = await ctx.db.post.findMany({ orderBy: { title: "asc" }, skip: 1, take: 2 });
    expect(
      page.map((p) => {
        return p.title;
      }),
    ).toEqual(["A2", "A3"]);
    expect(await ctx.db.post.findMany({ skip: 10 })).toEqual([]);
    await expectOrmError(ctx.db.post.findMany({ skip: -1 }), "VALIDATION");
    await expectOrmError(ctx.db.post.findMany({ take: 1.5 }), "VALIDATION");
  });

  // 负数 take 取最后 N 条，结果仍按 orderBy 顺序
  test("negative take returns the last N rows in orderBy order", async () => {
    const last = await ctx.db.post.findMany({ orderBy: { title: "asc" }, take: -2 });
    expect(
      last.map((p) => {
        return p.title;
      }),
    ).toEqual(["A3", "B1"]);
  });

  // 游标分页：向后翻页与向前翻页
  test("cursor pagination forwards and backwards", async () => {
    const all = await ctx.db.post.findMany({ orderBy: { id: "asc" } });
    const cursor = { id: all[1].id };
    const next = await ctx.db.post.findMany({ cursor, skip: 1, take: 2, orderBy: { id: "asc" } });
    expect(
      next.map((p) => {
        return p.id;
      }),
    ).toEqual([all[2].id, all[3].id]);
    const withCursor = await ctx.db.post.findMany({ cursor, take: 1, orderBy: { id: "asc" } });
    expect(
      withCursor.map((p) => {
        return p.id;
      }),
    ).toEqual([all[1].id]);
    const previous = await ctx.db.post.findMany({
      cursor,
      skip: 1,
      take: -5,
      orderBy: { id: "asc" },
    });
    expect(
      previous.map((p) => {
        return p.id;
      }),
    ).toEqual([all[0].id]);
    expect(await ctx.db.post.findMany({ cursor: { id: 999999 }, take: 2 })).toEqual([]);
  });

  // 在非唯一排序键上做游标分页
  test("cursor pagination over a non-unique sort key", async () => {
    const pages: string[][] = [];
    let cursor: { id: number } | undefined;
    for (;;) {
      const page = await ctx.db.post.findMany({
        orderBy: [{ views: "desc" }, { id: "asc" }],
        take: 2,
        ...(cursor ? { cursor, skip: 1 } : {}),
      });
      if (!page.length) {
        break;
      }
      pages.push(
        page.map((p) => {
          return p.title;
        }),
      );
      cursor = { id: page[page.length - 1].id };
    }
    expect(pages).toEqual([
      ["A2", "A3"],
      ["B1", "A1"],
    ]);
  });

  // distinct 按 orderBy 保留每组第一条
  test("distinct keeps the first row per group by orderBy", async () => {
    const rows = await ctx.db.post.findMany({ distinct: ["authorId"], orderBy: { views: "desc" } });
    expect(
      rows.map((p) => {
        return p.title;
      }),
    ).toEqual(["A2", "B1"]);
    const single = await ctx.db.post.findMany({ distinct: "published", orderBy: { title: "asc" } });
    expect(
      single
        .map((p) => {
          return p.title;
        })
        .sort(),
    ).toEqual(["A1", "A2"]);
  });

  // findManyAndCount 同时返回分页数据和总数
  test("findManyAndCount returns the page and the total", async () => {
    const { data, total } = await ctx.db.post.findManyAndCount({
      where: { authorId: alice.id },
      orderBy: { title: "asc" },
      skip: 1,
      take: 1,
      select: { title: true },
    });
    expect(data).toEqual([{ title: "A2" }]);
    expect(total).toBe(3);
  });

  // 对一关系不接受分页参数
  test("to-one relations reject pagination options", async () => {
    await expectOrmError(ctx.db.post.findMany({ include: { author: { take: 1 } } as any }), "VALIDATION");
  });

  // 自关联：多对多关注关系与父子树
  test("self relations: many-to-many followers and parent/children trees", async () => {
    const carol = await ctx.db.user.findUniqueOrThrow({ where: { email: "carol@x.com" } });
    await ctx.db.user.update({
      where: { id: alice.id },
      data: { following: { connect: [{ id: bob.id }, { id: carol.id }] } },
    });
    const bobRow = await ctx.db.user.findUniqueOrThrow({
      where: { id: bob.id },
      include: { followers: { select: { email: true } } },
    });
    expect(bobRow.followers).toEqual([{ email: "alice@x.com" }]);

    const root = await ctx.db.category.create({
      data: { name: "root", children: { create: [{ name: "a" }, { name: "b" }] } },
    });
    const tree = await ctx.db.category.findUniqueOrThrow({
      where: { id: root.id },
      include: {
        children: { orderBy: { name: "asc" }, include: { parent: { select: { name: true } } } },
      },
    });
    expect(
      tree.children.map((c) => {
        return [c.name, c.parent?.name];
      }),
    ).toEqual([
      ["a", "root"],
      ["b", "root"],
    ]);
  });

  // decimal 与 bigint 字段的过滤和排序
  test("decimal and bigint fields filter and sort", async () => {
    await ctx.db.product.createMany({
      data: [
        { sku: "a", price: "10.50", stock: 5n },
        { sku: "b", price: 2, stock: 9007199254740995n },
        { sku: "c", price: "100.00", stock: 0 },
      ],
    });
    const rows = await ctx.db.product.findMany({
      where: { price: { gte: "10" } },
      orderBy: { price: "asc" },
    });
    expect(
      rows.map((r) => {
        return r.sku;
      }),
    ).toEqual(["a", "c"]);
    const big = await ctx.db.product.findMany({ where: { stock: { gt: 9007199254740992n } } });
    expect(
      big.map((r) => {
        return r.sku;
      }),
    ).toEqual(["b"]);
  });
});
