// 语句数量（确定性的性能保证）：关系加载按每批 200 个父键查询、不出现 N+1，
// createMany 按 900 个参数的预算分批，嵌套写入的语句数随数据量线性增长。
// 通过 logger 收到的 query 事件计数，不依赖耗时，因此可以放进常规测试。
import { expect, test } from "bun:test";
import { eachDatabase, makeUser } from "../helpers/client.js";

/** 关系加载每批的父键数量上限。 */
const BATCH = 200;
const batches = (n: number) => {
  return Math.ceil(n / BATCH);
};

eachDatabase("statement batching", (ctx) => {
  const selects = () => {
    return ctx.queries().filter((sql) => {
      return /^\s*SELECT/i.test(sql);
    });
  };
  const inserts = () => {
    return ctx.queries().filter((sql) => {
      return /^\s*INSERT/i.test(sql);
    });
  };
  const mysqlLike = () => {
    return ctx.target === "mysql" || ctx.target === "mariadb";
  };

  /** 创建 n 个用户，每人 posts 篇文章和一份资料；用 createMany 以免准备数据本身太慢。 */
  async function seed(n: number, posts: number) {
    await ctx.db.user.createMany({
      data: Array.from({ length: n }, (_, i) => {
        return { email: `u${i}@x.com`, age: i };
      }),
    });
    const users = await ctx.db.user.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    await ctx.db.profile.createMany({
      data: users.map((u) => {
        return { userId: u.id, bio: "b" };
      }),
    });
    await ctx.db.post.createMany({
      data: users.flatMap((u) => {
        return Array.from({ length: posts }, (_, j) => {
          return { title: `p${j}`, authorId: u.id };
        });
      }),
    });
    ctx.events.length = 0;
    return users;
  }

  // 250 个父记录的多层 include：每个关系按批加载，查询数与父记录数无关
  test("nested includes load each relation in batches, not per parent", async () => {
    await seed(250, 2);
    const users = await ctx.db.user.findMany({
      include: { profile: true, posts: { include: { author: { select: { id: true } } } } },
    });
    expect(users).toHaveLength(250);
    expect(
      users.every((u) => {
        return u.posts.length === 2 && u.profile !== null;
      }),
    ).toBeTrue();
    // 根查询 + profile 批次 + posts 批次 + 文章作者批次；500 篇文章只有 250 个不同的作者，外键先去重
    expect(selects().length).toBe(1 + batches(250) + batches(250) + batches(250));
  });

  // _count 同样按批计数，不逐个父记录查询
  test("relation counts are batched", async () => {
    await seed(250, 3);
    const rows = await ctx.db.user.findMany({
      select: { id: true, _count: { select: { posts: true, comments: true } } },
    });
    expect(
      rows.every((r) => {
        return r._count.posts === 3 && r._count.comments === 0;
      }),
    ).toBeTrue();
    expect(selects().length).toBeLessThanOrEqual(1 + 2 * batches(250));
  });

  // 多对多 include 也按批加载
  test("many-to-many includes are batched", async () => {
    const author = await makeUser(ctx.db);
    await ctx.db.tag.createMany({
      data: Array.from({ length: 5 }, (_, i) => {
        return { name: `t${i}` };
      }),
    });
    for (let i = 0; i < 30; i++) {
      await ctx.db.post.create({
        data: {
          title: `p${i}`,
          authorId: author.id,
          tags: { connect: [{ name: "t0" }, { name: `t${i % 5}` }] },
        },
      });
    }
    ctx.events.length = 0;
    const posts = await ctx.db.post.findMany({ include: { tags: true } });
    expect(
      posts.every((p) => {
        return p.tags.length >= 1;
      }),
    ).toBeTrue();
    expect(selects().length).toBeLessThanOrEqual(1 + batches(30) + 1);
  });

  // 对多关系的分页按父记录独立计算，但仍是一条批量查询
  test("per-parent pagination of a to-many include stays one batched query", async () => {
    await seed(120, 5);
    const users = await ctx.db.user.findMany({
      include: { posts: { orderBy: { id: "desc" }, take: 2 } },
    });
    expect(
      users.every((u) => {
        return u.posts.length === 2;
      }),
    ).toBeTrue();
    expect(selects().length).toBe(1 + batches(120));
  });

  // createMany 按参数预算分批：每行 2 个参数时每批最多 450 行
  test("createMany splits rows by the parameter budget", async () => {
    const rows = 2000;
    ctx.events.length = 0;
    await ctx.db.user.createMany({
      data: Array.from({ length: rows }, (_, i) => {
        return { email: `b${i}@x.com`, name: "n" };
      }),
    });
    expect(await ctx.db.user.count()).toBe(rows);
    const statements = inserts();
    // 每行写入的列数取决于默认值（role、createdAt、updatedAt 也会显式绑定），所以从 SQL 里读出列数
    const columns = statements[0].match(/\(([^)]*)\)/)?.[1].split(",").length ?? 1;
    expect(statements.length).toBe(Math.ceil(rows / Math.floor(900 / columns)));
  });

  // skipDuplicates 在 SQLite / PostgreSQL 上仍是批量语句；MySQL 逐行执行以保证计数准确
  test("skipDuplicates stays batched where ON CONFLICT exists", async () => {
    const data = Array.from({ length: 300 }, (_, i) => {
      return { email: `s${i % 150}@x.com` };
    });
    ctx.events.length = 0;
    expect(await ctx.db.user.createMany({ data, skipDuplicates: true })).toEqual({ count: 150 });
    if (mysqlLike()) {
      expect(inserts().length).toBe(300);
    } else {
      expect(inserts().length).toBeLessThanOrEqual(2);
    }
  });

  // 嵌套创建 50 篇文章：语句数随子记录线性增长，没有额外的逐条读取放大
  test("nested create statements grow linearly with the children", async () => {
    const count = async (n: number) => {
      ctx.events.length = 0;
      await ctx.db.user.create({
        data: {
          email: `n${n}@x.com`,
          posts: {
            create: Array.from({ length: n }, (_, i) => {
              return { title: `c${i}` };
            }),
          },
        },
      });
      return ctx.queries().length;
    };
    const small = await count(10);
    const large = await count(50);
    const perChild = (large - small) / 40;
    // 每个子记录最多一条插入加一条读回（MySQL 没有 RETURNING）
    expect(perChild).toBeLessThanOrEqual(mysqlLike() ? 2 : 1);
  });

  // updateMany 在没有软删除外键校验时是一条集合式 UPDATE
  test("updateMany is a single set-based statement", async () => {
    await seed(300, 0);
    await ctx.db.user.updateMany({ where: { age: { lt: 200 } }, data: { name: "bulk" } });
    const updates = ctx.queries().filter((sql) => {
      return /^\s*UPDATE/i.test(sql);
    });
    expect(updates).toHaveLength(1);
  });

  // findManyAndCount 只发两条查询（列表与总数），外加快照事务
  test("findManyAndCount issues exactly one list and one count query", async () => {
    await seed(50, 0);
    await ctx.db.user.findManyAndCount({ take: 10, orderBy: { id: "asc" } });
    expect(selects()).toHaveLength(2);
  });
});
