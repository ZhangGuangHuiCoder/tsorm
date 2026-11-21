// 聚合与分组：aggregate、groupBy、having 及其参数校验。
import { beforeEach, expect, test } from "bun:test";
import { eachDatabase, expectOrmError } from "../helpers/client.js";

eachDatabase("aggregations", (ctx) => {
  // 两个作者各两篇文章，views 共 100，其中一篇 rating 为 NULL。
  beforeEach(async () => {
    const a = await ctx.db.user.create({ data: { email: "a@x.com", name: "A" } });
    const b = await ctx.db.user.create({ data: { email: "b@x.com", name: "B" } });
    await ctx.db.post.createMany({
      data: [
        { title: "p1", authorId: a.id, views: 10, published: true, rating: 4 },
        { title: "p2", authorId: a.id, views: 30, published: false, rating: null },
        { title: "p3", authorId: b.id, views: 20, published: true, rating: 2 },
        { title: "p4", authorId: b.id, views: 40, published: true, rating: 3 },
      ],
    });
  });

  // aggregate：_count / _sum / _avg / _min / _max
  test("aggregate count, sum, avg, min and max", async () => {
    const result = await ctx.db.post.aggregate({
      _count: true,
      _sum: { views: true },
      _avg: { views: true, rating: true },
      _min: { views: true, title: true, published: true },
      _max: { views: true, title: true, published: true },
    });
    expect(result).toEqual({
      _count: 4,
      _sum: { views: 100 },
      _avg: { views: 25, rating: 3 },
      _min: { views: 10, title: "p1", published: false },
      _max: { views: 40, title: "p4", published: true },
    });
  });

  // 按字段计数时跳过 NULL
  test("aggregate field counts skip NULLs", async () => {
    const result = await ctx.db.post.aggregate({ _count: { _all: true, rating: true } });
    expect(result._count).toEqual({ _all: 4, rating: 3 });
  });

  // 空数据集上的聚合结果
  test("aggregate over an empty set", async () => {
    const result = await ctx.db.post.aggregate({
      where: { views: { gt: 1000 } },
      _count: true,
      _sum: { views: true },
      _avg: { views: true },
      _max: { views: true },
    });
    expect(result).toEqual({
      _count: 0,
      _sum: { views: null },
      _avg: { views: null },
      _max: { views: null },
    });
  });

  // 先应用 where / orderBy / skip / take，再聚合
  test("aggregate applies where, orderBy, skip and take before aggregating", async () => {
    const result = await ctx.db.post.aggregate({
      where: { published: true },
      orderBy: { views: "desc" },
      take: 2,
      _sum: { views: true },
    });
    expect(result._sum.views).toBe(60);
  });

  // aggregate 至少要选择一种聚合
  test("aggregate requires at least one aggregation", async () => {
    await expectOrmError(ctx.db.post.aggregate({} as any), "VALIDATION");
  });

  // groupBy 搭配聚合、having 和排序
  test("groupBy with aggregates, having and ordering", async () => {
    const groups = await ctx.db.post.groupBy({
      by: ["authorId"],
      _count: { _all: true },
      _sum: { views: true },
      _avg: { views: true },
      orderBy: { _sum: { views: "desc" } },
    });
    expect(
      groups.map((g) => {
        return [g._count._all, g._sum.views, g._avg.views];
      }),
    ).toEqual([
      [2, 60, 30],
      [2, 40, 20],
    ]);

    const having = await ctx.db.post.groupBy({
      by: ["authorId"],
      _sum: { views: true },
      having: { views: { _sum: { gt: 50 } } },
    });
    expect(having).toHaveLength(1);
    expect(having[0]._sum.views).toBe(60);
  });

  // 按多个字段分组，并带 where 和分页
  test("groupBy several fields with where and pagination", async () => {
    const groups = await ctx.db.post.groupBy({
      by: ["authorId", "published"],
      where: { views: { gte: 10 } },
      _count: true,
      orderBy: [{ authorId: "asc" }, { published: "asc" }],
      skip: 1,
      take: 2,
    });
    expect(
      groups.map((g) => {
        return [g.published, g._count];
      }),
    ).toEqual([
      [true, 1],
      [true, 2],
    ]);
  });

  // groupBy 参数校验规则
  test("groupBy validation rules", async () => {
    await expectOrmError(ctx.db.post.groupBy({ by: [], _count: true } as any), "VALIDATION");
    await expectOrmError(ctx.db.post.groupBy({ by: ["authorId", "authorId"], _count: true }), "VALIDATION");
    await expectOrmError(ctx.db.post.groupBy({ by: ["authorId"], _count: true, take: 1 }), "VALIDATION");
    await expectOrmError(ctx.db.post.groupBy({ by: ["authorId"], _count: true, orderBy: { views: "asc" } } as any), "VALIDATION");
  });
});
