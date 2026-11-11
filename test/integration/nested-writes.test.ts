// 复杂的嵌套写入与查询：多层嵌套、同一请求中组合多种关系操作、执行顺序、深层回滚，
// 以及多层 include / select / 过滤 / 计数 / 排序的组合。
import { expect, test } from "bun:test";
import { eachDatabase, expectOrmError, makeUser } from "../helpers/client.js";

eachDatabase("nested writes and queries", (ctx) => {
  /** 一位作者、两篇文章，每篇带标签和其他用户的评论。 */
  async function blog() {
    const reader = await makeUser(ctx.db, { email: "reader@x.com", name: "Reader" });
    const author = await ctx.db.user.create({
      data: {
        email: "author@x.com",
        name: "Author",
        profile: { create: { bio: "writes things" } },
        posts: {
          create: [
            {
              title: "First",
              views: 10,
              published: true,
              tags: { create: [{ name: "ts" }, { name: "orm" }] },
              comments: {
                create: [
                  { body: "nice", authorId: reader.id },
                  { body: "more", authorId: reader.id },
                ],
              },
            },
            {
              title: "Second",
              views: 3,
              tags: { connectOrCreate: [{ where: { name: "ts" }, create: { name: "ts" } }] },
            },
          ],
        },
      },
    });
    return { author, reader };
  }

  // ---------- 嵌套写入 ----------

  // 四层嵌套创建：用户 → 文章 → 评论 → 评论作者（connectOrCreate）
  test("four-level nested create resolves every level in one call", async () => {
    const user = await ctx.db.user.create({
      data: {
        email: "deep@x.com",
        posts: {
          create: {
            title: "Deep",
            tags: { create: { name: "deep" } },
            comments: {
              create: [
                {
                  body: "from a new user",
                  author: {
                    connectOrCreate: {
                      where: { email: "new@x.com" },
                      create: { email: "new@x.com", name: "New" },
                    },
                  },
                },
                {
                  body: "from an existing user",
                  author: {
                    connectOrCreate: {
                      where: { email: "new@x.com" },
                      create: { email: "new@x.com" },
                    },
                  },
                },
              ],
            },
          },
        },
      },
      include: {
        posts: {
          include: {
            tags: true,
            comments: {
              orderBy: { id: "asc" },
              include: { author: { select: { email: true, name: true } } },
            },
          },
        },
      },
    });
    const [post] = user.posts;
    expect(
      post.tags.map((t) => {
        return t.name;
      }),
    ).toEqual(["deep"]);
    expect(
      post.comments.map((c) => {
        return [c.body, c.author.email, c.author.name];
      }),
    ).toEqual([
      ["from a new user", "new@x.com", "New"],
      ["from an existing user", "new@x.com", "New"],
    ]);
    expect(await ctx.db.user.count()).toBe(2);
  });

  // 嵌套写入可以引用同一请求中刚创建的记录（先建标签，再在另一篇文章里 connect）
  test("a nested connect can target a record created earlier in the same request", async () => {
    const user = await ctx.db.user.create({
      data: {
        email: "chain@x.com",
        posts: {
          create: [
            { title: "A", tags: { create: { name: "shared" } } },
            { title: "B", tags: { connect: { name: "shared" } } },
          ],
        },
      },
      include: { posts: { orderBy: { title: "asc" }, include: { tags: true } } },
    });
    expect(
      user.posts.map((p) => {
        return p.tags.map((t) => {
          return t.name;
        });
      }),
    ).toEqual([["shared"], ["shared"]]);
    expect(await ctx.db.tag.count()).toBe(1);
  });

  // 同一次 update 里同时操作多个关系，每个关系组合多种操作
  test("one update combines several operations on several relations", async () => {
    const { author, reader } = await blog();
    const [first, second] = await ctx.db.post.findMany({
      where: { authorId: author.id },
      orderBy: { title: "asc" },
    });
    const updated = await ctx.db.user.update({
      where: { id: author.id },
      data: {
        name: "Renamed",
        profile: { update: { bio: "edited" } },
        following: { connect: { id: reader.id } },
        posts: {
          update: {
            where: { id: first.id },
            data: { title: "First (edited)", tags: { disconnect: { name: "orm" } } },
          },
          updateMany: { where: { published: false }, data: { views: { increment: 100 } } },
          delete: { id: second.id },
          create: [{ title: "Third", published: true }],
          upsert: {
            where: { id: 999999 },
            create: { title: "Fourth" },
            update: { title: "never used" },
          },
        },
      },
      include: {
        profile: true,
        following: { select: { email: true } },
        posts: { orderBy: { title: "asc" }, include: { tags: { orderBy: { name: "asc" } } } },
      },
    });
    expect(updated.name).toBe("Renamed");
    expect(updated.profile?.bio).toBe("edited");
    expect(updated.following).toEqual([{ email: "reader@x.com" }]);
    expect(
      updated.posts.map((p) => {
        return [
          p.title,
          p.tags.map((t) => {
            return t.name;
          }),
        ];
      }),
    ).toEqual([
      ["First (edited)", ["ts"]],
      ["Fourth", []],
      ["Third", []],
    ]);
    // 被删除的文章不会被 updateMany 影响；新建的文章在 updateMany 之后创建，所以 views 为 0
    expect(
      updated.posts.every((p) => {
        return p.views < 100;
      }),
    ).toBeTrue();
  });

  // 同一关系上的多种操作按固定顺序执行：set → disconnect → delete → … → create → … → upsert
  test("operations on one to-many relation follow the documented order", async () => {
    const author = await makeUser(ctx.db);
    await ctx.db.tag.createMany({ data: [{ name: "a" }, { name: "b" }, { name: "c" }] });
    const post = await ctx.db.post.create({
      data: { title: "p", authorId: author.id, tags: { connect: [{ name: "a" }, { name: "b" }] } },
    });
    // set 先把关联换成 [c]，随后 connect 再加上 a，create 最后新建 d
    const result = await ctx.db.post.update({
      where: { id: post.id },
      data: { tags: { create: { name: "d" }, connect: { name: "a" }, set: [{ name: "c" }] } },
      include: { tags: { orderBy: { name: "asc" } } },
    });
    expect(
      result.tags.map((t) => {
        return t.name;
      }),
    ).toEqual(["a", "c", "d"]);
  });

  // 嵌套 upsert 在对多关系上：已关联的记录走 update，不存在的走 create
  test("nested to-many upsert updates linked records and creates missing ones", async () => {
    const { author } = await blog();
    const first = await ctx.db.post.findFirstOrThrow({ where: { title: "First" } });
    await ctx.db.user.update({
      where: { id: author.id },
      data: {
        posts: {
          upsert: [
            { where: { id: first.id }, create: { title: "x" }, update: { views: { multiply: 3 } } },
            {
              where: { id: 424242 },
              create: { title: "Created by upsert" },
              update: { title: "x" },
            },
          ],
        },
      },
    });
    expect((await ctx.db.post.findUniqueOrThrow({ where: { id: first.id } })).views).toBe(30);
    expect(await ctx.db.post.count({ where: { title: "Created by upsert", authorId: author.id } })).toBe(1);
  });

  // 嵌套写入的第三层失败时，前两层的写入全部回滚
  test("a failure three levels down rolls back every level", async () => {
    const { author } = await blog();
    const before = await ctx.db.post.count();
    await expectOrmError(
      ctx.db.user.update({
        where: { id: author.id },
        data: {
          name: "should roll back",
          posts: {
            create: {
              title: "level 2",
              comments: {
                create: { body: "level 3", author: { connect: { email: "nobody@x.com" } } },
              },
            },
          },
        },
      }),
      "NOT_FOUND",
    );
    expect((await ctx.db.user.findUniqueOrThrow({ where: { id: author.id } })).name).toBe("Author");
    expect(await ctx.db.post.count()).toBe(before);
  });

  // 嵌套写入中混入软删除：connect 已删除的记录会报错并整体回滚
  test("nested writes reject soft-deleted targets and roll back", async () => {
    const account = await ctx.db.account.create({
      data: { email: "acc@x.com", entries: { create: { title: "keep" } } },
    });
    const entry = await ctx.db.entry.findFirstOrThrow();
    await ctx.db.entry.delete({ where: { id: entry.id } });
    await expectOrmError(
      ctx.db.account.update({
        where: { id: account.id },
        data: { name: "x", entries: { create: { title: "new" }, connect: { id: entry.id } } },
      }),
      "SOFT_DELETED_REFERENCE",
    );
    expect(await ctx.db.entry.count({ deleted: "include" })).toBe(1);
    expect((await ctx.db.account.findUniqueOrThrow({ where: { id: account.id } })).name).toBeNull();
  });

  // 自关联树的多层嵌套创建，并重新挂接子树
  test("nested self-relation trees can be built and re-parented", async () => {
    const root = await ctx.db.category.create({
      data: {
        name: "root",
        children: {
          create: [
            {
              name: "a",
              children: {
                create: [{ name: "a1", children: { create: { name: "a1x" } } }, { name: "a2" }],
              },
            },
            { name: "b" },
          ],
        },
      },
    });
    const b = await ctx.db.category.findFirstOrThrow({ where: { name: "b" } });
    const a1 = await ctx.db.category.findFirstOrThrow({ where: { name: "a1" } });
    // 从反向集合 connect 不能抢走已有父节点的子树；改挂要通过拥有方的 parent 字段
    await expectOrmError(
      ctx.db.category.update({
        where: { id: b.id },
        data: { children: { connect: { id: a1.id } } },
      }),
      "VALIDATION",
    );
    await ctx.db.category.update({
      where: { id: a1.id },
      data: { parent: { connect: { id: b.id } } },
    });
    const tree = await ctx.db.category.findUniqueOrThrow({
      where: { id: root.id },
      select: {
        name: true,
        children: {
          orderBy: { name: "asc" },
          select: {
            name: true,
            children: {
              orderBy: { name: "asc" },
              select: { name: true, children: { select: { name: true } } },
            },
          },
        },
      },
    });
    expect(tree).toEqual({
      name: "root",
      children: [
        { name: "a", children: [{ name: "a2", children: [] }] },
        { name: "b", children: [{ name: "a1", children: [{ name: "a1x" }] }] },
      ],
    });
  });

  // 多对多两侧同时写入：从标签一侧也能创建和连接文章
  test("many-to-many writes work from both sides", async () => {
    const author = await makeUser(ctx.db);
    const tag = await ctx.db.tag.create({
      data: {
        name: "both",
        posts: { create: [{ title: "via tag", authorId: author.id }] },
      },
    });
    const post = await ctx.db.post.create({ data: { title: "via post", authorId: author.id } });
    await ctx.db.tag.update({
      where: { id: tag.id },
      data: { posts: { connect: { id: post.id } } },
    });
    const loaded = await ctx.db.tag.findUniqueOrThrow({
      where: { id: tag.id },
      include: {
        posts: {
          orderBy: { title: "asc" },
          select: { title: true, tags: { select: { name: true } } },
        },
      },
    });
    expect(loaded.posts).toEqual([
      { title: "via post", tags: [{ name: "both" }] },
      { title: "via tag", tags: [{ name: "both" }] },
    ]);
  });

  // 嵌套 createMany 与普通 create 同时使用，以及 skipDuplicates 在嵌套中的行为
  test("nested createMany with skipDuplicates alongside create", async () => {
    const account = await ctx.db.account.create({
      data: {
        email: "many@x.com",
        entries: {
          create: { title: "single" },
          createMany: { data: [{ title: "bulk 1" }, { title: "bulk 2" }] },
        },
      },
      include: { entries: { orderBy: { title: "asc" } } },
    });
    expect(
      account.entries.map((e) => {
        return e.title;
      }),
    ).toEqual(["bulk 1", "bulk 2", "single"]);
  });

  // ---------- 嵌套查询 ----------

  // 每一层 include 都可以带 where / orderBy / take，并且相互独立
  test("every include level applies its own where, orderBy and take", async () => {
    await blog();
    const authors = await ctx.db.user.findMany({
      where: { posts: { some: {} } },
      include: {
        posts: {
          where: { views: { gte: 1 } },
          orderBy: { views: "desc" },
          take: 1,
          include: {
            tags: { where: { name: { not: "orm" } } },
            comments: {
              orderBy: { id: "desc" },
              take: 1,
              include: { author: { select: { name: true } } },
            },
            _count: { select: { comments: true, tags: true } },
          },
        },
      },
    });
    expect(authors).toHaveLength(1);
    const [post] = authors[0].posts;
    expect(post.title).toBe("First");
    expect(
      post.tags.map((t) => {
        return t.name;
      }),
    ).toEqual(["ts"]);
    expect(
      post.comments.map((c) => {
        return [c.body, c.author.name];
      }),
    ).toEqual([["more", "Reader"]]);
    expect(post._count).toEqual({ comments: 2, tags: 2 });
  });

  // select 和 include 在不同层级交替使用，_count 也可以带过滤条件
  test("select and include alternate across levels with filtered counts", async () => {
    await blog();
    const row = await ctx.db.user.findUniqueOrThrow({
      where: { email: "author@x.com" },
      select: {
        name: true,
        profile: { select: { bio: true } },
        posts: {
          orderBy: { title: "asc" },
          include: { tags: { select: { name: true }, orderBy: { name: "asc" } } },
          omit: { content: true, rating: true },
        },
        _count: { select: { posts: { where: { published: true } }, comments: true } },
      },
    });
    expect(row.name).toBe("Author");
    expect(row.profile).toEqual({ bio: "writes things" });
    expect(
      row.posts.map((p) => {
        return [
          p.title,
          p.tags.map((t) => {
            return t.name;
          }),
        ];
      }),
    ).toEqual([
      ["First", ["orm", "ts"]],
      ["Second", ["ts"]],
    ]);
    expect(row.posts[0]).not.toHaveProperty("content");
    expect(row._count).toEqual({ posts: 1, comments: 0 });
  });

  // 三层关系过滤：有评论者名字包含 Read 的文章作者
  test("relation filters nest three levels deep and combine with logic", async () => {
    await blog();
    await makeUser(ctx.db, { email: "other@x.com", name: "Other" });
    const authors = await ctx.db.user.findMany({
      where: {
        AND: [
          {
            posts: {
              some: { comments: { some: { author: { is: { name: { contains: "Read" } } } } } },
            },
          },
          { posts: { every: { views: { gte: 1 } } } },
          { NOT: { profile: { is: null } } },
        ],
      },
      select: { email: true },
    });
    expect(authors).toEqual([{ email: "author@x.com" }]);
    const commenters = await ctx.db.user.findMany({
      where: { comments: { some: { post: { is: { tags: { some: { name: "orm" } } } } } } },
      select: { email: true },
    });
    expect(commenters).toEqual([{ email: "reader@x.com" }]);
  });

  // 关系过滤与关系排序、分页、去重同时使用
  test("relation filters combine with relation ordering, pagination and distinct", async () => {
    const { author, reader } = await blog();
    await ctx.db.post.create({ data: { title: "By reader", authorId: reader.id, views: 50 } });
    const posts = await ctx.db.post.findMany({
      where: { OR: [{ tags: { some: { name: "ts" } } }, { author: { is: { id: reader.id } } }] },
      orderBy: [{ author: { email: "asc" } }, { views: "desc" }],
      skip: 1,
      take: 2,
      select: { title: true },
    });
    expect(
      posts.map((p) => {
        return p.title;
      }),
    ).toEqual(["Second", "By reader"]);
    const perAuthor = await ctx.db.post.findMany({
      distinct: ["authorId"],
      orderBy: { views: "desc" },
      select: { title: true, authorId: true },
    });
    expect(perAuthor).toEqual([
      { title: "By reader", authorId: reader.id },
      { title: "First", authorId: author.id },
    ]);
  });

  // 游标分页与深层 include 一起使用，每页的关系数据完整
  test("cursor pages carry complete nested relations", async () => {
    const author = await makeUser(ctx.db);
    for (let i = 0; i < 5; i++) {
      await ctx.db.post.create({
        data: {
          title: `p${i}`,
          authorId: author.id,
          tags: { create: [{ name: `t${i}a` }, { name: `t${i}b` }] },
        },
      });
    }
    const pages: string[][] = [];
    let cursor: { id: number } | undefined;
    for (;;) {
      const page = await ctx.db.post.findMany({
        orderBy: { id: "asc" },
        take: 2,
        ...(cursor ? { cursor, skip: 1 } : {}),
        include: { tags: { orderBy: { name: "asc" } }, author: { select: { email: true } } },
      });
      if (!page.length) {
        break;
      }
      for (const post of page) {
        expect(post.author.email).toBe(author.email);
      }
      pages.push(
        page.map((p) => {
          return p.tags
            .map((t) => {
              return t.name;
            })
            .join("+");
        }),
      );
      cursor = { id: page[page.length - 1].id };
    }
    expect(pages).toEqual([["t0a+t0b", "t1a+t1b"], ["t2a+t2b", "t3a+t3b"], ["t4a+t4b"]]);
  });

  // findManyAndCount 与深层 include、关系过滤一起使用，总数不受分页影响
  test("findManyAndCount with nested include and relation filters", async () => {
    await blog();
    const { data, total } = await ctx.db.post.findManyAndCount({
      where: { tags: { some: { name: "ts" } } },
      orderBy: { title: "asc" },
      take: 1,
      include: { comments: { include: { author: true } }, tags: true },
    });
    expect(total).toBe(2);
    expect(
      data.map((p) => {
        return [p.title, p.comments.length, p.tags.length];
      }),
    ).toEqual([["First", 2, 2]]);
  });

  // 投影嵌套深度上限为 8 层
  test("projections nest at most eight levels", async () => {
    let include: any = true;
    for (let i = 0; i < 10; i++) {
      include = { include: { parent: include } };
    }
    await expectOrmError(ctx.db.category.findMany(include), "VALIDATION");
  });

  // 嵌套 include 中软删除的子记录默认隐藏，可按层单独放开
  test("soft-delete visibility can be set per include level", async () => {
    const account = await ctx.db.account.create({
      data: { email: "vis@x.com", entries: { create: [{ title: "live" }, { title: "gone" }] } },
    });
    const gone = await ctx.db.entry.findFirstOrThrow({ where: { title: "gone" } });
    await ctx.db.entry.delete({ where: { id: gone.id } });
    const row = await ctx.db.entry.findFirstOrThrow({
      where: { title: "live" },
      include: {
        account: {
          include: { entries: { deleted: "include", orderBy: { title: "asc" } }, _count: true },
        },
      },
    });
    expect(
      row.account.entries.map((e) => {
        return e.title;
      }),
    ).toEqual(["gone", "live"]);
    expect(row.account._count.entries).toBe(1);
    expect(row.account.id).toBe(account.id);
  });
});
