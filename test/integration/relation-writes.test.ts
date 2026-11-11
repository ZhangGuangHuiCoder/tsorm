// 嵌套关系写入：create / connect / set / disconnect 等操作、作用域规则和参照动作。
import { expect, test } from "bun:test";
import { eachDatabase, expectOrmError, makeUser } from "../helpers/client.js";

eachDatabase("relation writes", (ctx) => {
  const postTitles = async (authorId: number) => {
    return (await ctx.db.post.findMany({ where: { authorId }, orderBy: { title: "asc" } })).map((p) => {
      return p.title;
    });
  };
  const tagNames = async (postId: number) => {
    return (
      await ctx.db.tag.findMany({
        where: { posts: { some: { id: postId } } },
        orderBy: { name: "asc" },
      })
    ).map((t) => {
      return t.name;
    });
  };

  // 嵌套创建对一和对多关系
  test("nested create of to-one and to-many relations", async () => {
    const user = await ctx.db.user.create({
      data: {
        email: "nest@x.com",
        profile: { create: { bio: "hello" } },
        posts: {
          create: [{ title: "one", tags: { create: [{ name: "a" }, { name: "b" }] } }, { title: "two" }],
        },
      },
      include: { profile: true, posts: { orderBy: { title: "asc" }, include: { tags: true } } },
    });
    expect(user.profile?.bio).toBe("hello");
    expect(
      user.posts.map((p) => {
        return [p.title, p.tags.length];
      }),
    ).toEqual([
      ["one", 2],
      ["two", 0],
    ]);
  });

  // 在关系拥有方通过 connect 和 create 关联
  test("create through the owning side with connect and create", async () => {
    const author = await makeUser(ctx.db, { email: "author@x.com" });
    const post = await ctx.db.post.create({
      data: {
        title: "connected",
        author: { connect: { email: "author@x.com" } },
        reviewer: { create: { email: "reviewer@x.com" } },
      },
      include: { author: true, reviewer: true },
    });
    expect(post.authorId).toBe(author.id);
    expect(post.reviewer?.email).toBe("reviewer@x.com");
  });

  // 必填关系不能同时指定外键和关系字段
  test("a required relation cannot be given both the foreign key and the relation", async () => {
    const author = await makeUser(ctx.db);
    await expectOrmError(
      ctx.db.post.create({
        data: { title: "x", authorId: author.id, author: { connect: { id: author.id } } } as any,
      }),
      "VALIDATION",
    );
  });

  // connect 不存在的记录时抛出 NOT_FOUND 并整体回滚
  test("connect to a missing record raises NOT_FOUND and rolls back", async () => {
    await expectOrmError(ctx.db.user.create({ data: { email: "rb@x.com", posts: { connect: { id: 424242 } } } }), "NOT_FOUND");
    expect(await ctx.db.user.count()).toBe(0);
  });

  // connectOrCreate 复用已有记录，缺失时创建
  test("connectOrCreate reuses existing records and creates missing ones", async () => {
    await ctx.db.tag.create({ data: { name: "existing" } });
    const author = await makeUser(ctx.db);
    const post = await ctx.db.post.create({
      data: {
        title: "coc",
        authorId: author.id,
        tags: {
          connectOrCreate: [
            { where: { name: "existing" }, create: { name: "existing" } },
            { where: { name: "fresh" }, create: { name: "fresh" } },
          ],
        },
      },
    });
    expect(await tagNames(post.id)).toEqual(["existing", "fresh"]);
    expect(await ctx.db.tag.count()).toBe(2);
  });

  // 直接外键关系上的嵌套 createMany
  test("nested createMany on a direct foreign key relation", async () => {
    const user = await ctx.db.user.create({
      data: {
        email: "cm@x.com",
        posts: { createMany: { data: [{ title: "x" }, { title: "y" }] } },
      },
    });
    expect(await postTitles(user.id)).toEqual(["x", "y"]);
  });

  // 嵌套 update / updateMany / deleteMany 只影响已关联的记录
  test("nested update, updateMany and deleteMany only touch linked records", async () => {
    const alice = await ctx.db.user.create({
      data: {
        email: "a@x.com",
        posts: { create: [{ title: "keep" }, { title: "obsolete-1" }, { title: "obsolete-2" }] },
      },
    });
    const bob = await ctx.db.user.create({
      data: { email: "b@x.com", posts: { create: [{ title: "obsolete-bob" }] } },
    });
    const keep = await ctx.db.post.findFirstOrThrow({ where: { title: "keep" } });
    await ctx.db.user.update({
      where: { id: alice.id },
      data: {
        posts: {
          update: { where: { id: keep.id }, data: { title: "kept" } },
          updateMany: { where: {}, data: { views: { increment: 1 } } },
          deleteMany: { title: { startsWith: "obsolete" } },
        },
      },
    });
    expect(await postTitles(alice.id)).toEqual(["kept"]);
    expect((await ctx.db.post.findUniqueOrThrow({ where: { id: keep.id } })).views).toBe(1);
    expect(await postTitles(bob.id)).toEqual(["obsolete-bob"]);
  });

  // 嵌套操作关系之外的记录时抛出 RELATION_NOT_CONNECTED
  test("nested update of a record outside the relation raises RELATION_NOT_CONNECTED", async () => {
    const alice = await makeUser(ctx.db);
    const bob = await ctx.db.user.create({
      data: { email: "bob@x.com", posts: { create: { title: "bob" } } },
    });
    const bobPost = await ctx.db.post.findFirstOrThrow({ where: { authorId: bob.id } });
    await expectOrmError(
      ctx.db.user.update({
        where: { id: alice.id },
        data: { posts: { update: { where: { id: bobPost.id }, data: { title: "stolen" } } } },
      }),
      "RELATION_NOT_CONNECTED",
    );
    await expectOrmError(
      ctx.db.user.update({
        where: { id: alice.id },
        data: { posts: { delete: { id: bobPost.id } } },
      }),
      "RELATION_NOT_CONNECTED",
    );
  });

  // 对一关系的嵌套 update / upsert / delete
  test("to-one nested update, upsert and delete", async () => {
    const user = await makeUser(ctx.db);
    await ctx.db.user.update({
      where: { id: user.id },
      data: { profile: { upsert: { create: { bio: "created" }, update: { bio: "updated" } } } },
    });
    expect((await ctx.db.profile.findFirstOrThrow()).bio).toBe("created");
    await ctx.db.user.update({
      where: { id: user.id },
      data: { profile: { upsert: { create: { bio: "created" }, update: { bio: "updated" } } } },
    });
    expect((await ctx.db.profile.findFirstOrThrow()).bio).toBe("updated");
    await ctx.db.user.update({
      where: { id: user.id },
      data: { profile: { update: { bio: "again" } } },
    });
    expect((await ctx.db.profile.findFirstOrThrow()).bio).toBe("again");
    await ctx.db.user.update({ where: { id: user.id }, data: { profile: { delete: true } } });
    expect(await ctx.db.profile.count()).toBe(0);
  });

  // 对一关系每次只能指定一个操作
  test("a to-one relation accepts one operation at a time", async () => {
    const user = await makeUser(ctx.db);
    await expectOrmError(
      ctx.db.user.update({
        where: { id: user.id },
        data: {
          profile: { create: { bio: "a" }, upsert: { create: { bio: "b" }, update: {} } } as any,
        },
      }),
      "VALIDATION",
    );
  });

  // 可选关系可以 disconnect，必填关系不行
  test("disconnect an optional relation and reject disconnecting a required one", async () => {
    const author = await makeUser(ctx.db);
    const reviewer = await makeUser(ctx.db);
    const post = await ctx.db.post.create({
      data: { title: "r", authorId: author.id, reviewerId: reviewer.id },
    });
    const updated = await ctx.db.post.update({
      where: { id: post.id },
      data: { reviewer: { disconnect: true } },
    });
    expect(updated.reviewerId).toBeNull();
    await expectOrmError(ctx.db.post.update({ where: { id: post.id }, data: { author: { disconnect: true } } as any }), "VALIDATION");
  });

  // 多对多关系的 connect / disconnect / set / delete
  test("many-to-many connect, disconnect, set and delete", async () => {
    const author = await makeUser(ctx.db);
    await ctx.db.tag.createMany({ data: [{ name: "a" }, { name: "b" }, { name: "c" }] });
    const post = await ctx.db.post.create({
      data: {
        title: "m2m",
        authorId: author.id,
        tags: { connect: [{ name: "a" }, { name: "b" }] },
      },
    });
    expect(await tagNames(post.id)).toEqual(["a", "b"]);

    await ctx.db.post.update({
      where: { id: post.id },
      data: { tags: { disconnect: { name: "a" } } },
    });
    expect(await tagNames(post.id)).toEqual(["b"]);

    await ctx.db.post.update({
      where: { id: post.id },
      data: { tags: { set: [{ name: "a" }, { name: "c" }] } },
    });
    expect(await tagNames(post.id)).toEqual(["a", "c"]);

    // 再次 connect 已关联的标签不会产生变化。
    await ctx.db.post.update({
      where: { id: post.id },
      data: { tags: { connect: { name: "a" } } },
    });
    expect(await tagNames(post.id)).toEqual(["a", "c"]);

    await ctx.db.post.update({ where: { id: post.id }, data: { tags: { delete: { name: "c" } } } });
    expect(await tagNames(post.id)).toEqual(["a"]);
    expect(await ctx.db.tag.count()).toBe(2);

    await ctx.db.post.update({ where: { id: post.id }, data: { tags: { set: [] } } });
    expect(await tagNames(post.id)).toEqual([]);
    expect(await ctx.db.tag.count()).toBe(2);
  });

  // 同一次 connect / set 中重复出现的目标只关联一次（回归：曾因重复插入中间表而报唯一约束错误）
  test("repeating a target in one connect or set links it once", async () => {
    const author = await makeUser(ctx.db);
    await ctx.db.tag.createMany({ data: [{ name: "a" }, { name: "b" }] });
    const post = await ctx.db.post.create({
      data: {
        title: "dup",
        authorId: author.id,
        tags: { connect: [{ name: "a" }, { name: "a" }] },
      },
    });
    expect(await tagNames(post.id)).toEqual(["a"]);
    await ctx.db.post.update({
      where: { id: post.id },
      data: { tags: { connect: [{ name: "b" }, { name: "b" }] } },
    });
    expect(await tagNames(post.id)).toEqual(["a", "b"]);
    await ctx.db.post.update({
      where: { id: post.id },
      data: { tags: { set: [{ name: "a" }, { name: "a" }] } },
    });
    expect(await tagNames(post.id)).toEqual(["a"]);
  });

  // 删除多对多任一侧都会删除中间表关联
  test("deleting either side of a many-to-many removes its links", async () => {
    const author = await makeUser(ctx.db);
    const post = await ctx.db.post.create({
      data: { title: "p", authorId: author.id, tags: { create: [{ name: "x" }, { name: "y" }] } },
    });
    await ctx.db.tag.delete({ where: { name: "x" } });
    expect(await tagNames(post.id)).toEqual(["y"]);
    await ctx.db.post.delete({ where: { id: post.id } });
    const y = await ctx.db.tag.findUniqueOrThrow({
      where: { name: "y" },
      include: { posts: true },
    });
    expect(y.posts).toEqual([]);
  });

  // 必填一对多关系上的 set 不能让子记录失去父记录
  test("set on a required one-to-many relation cannot orphan children", async () => {
    const user = await ctx.db.user.create({
      data: { email: "s@x.com", posts: { create: { title: "p" } } },
    });
    await expectOrmError(ctx.db.user.update({ where: { id: user.id }, data: { posts: { set: [] } } }), "VALIDATION");
    expect(await postTitles(user.id)).toEqual(["p"]);
  });

  // 反向 connect 不能抢走属于其他父记录的子记录
  test("back connect cannot steal a record that belongs to another parent", async () => {
    const alice = await ctx.db.user.create({
      data: { email: "a@x.com", posts: { create: { title: "mine" } } },
    });
    const bob = await makeUser(ctx.db);
    const mine = await ctx.db.post.findFirstOrThrow({ where: { authorId: alice.id } });
    await expect(ctx.db.user.update({ where: { id: bob.id }, data: { posts: { connect: { id: mine.id } } } })).rejects.toThrow();
    expect((await ctx.db.post.findUniqueOrThrow({ where: { id: mine.id } })).authorId).toBe(alice.id);
  });

  // 嵌套写入失败时整个操作回滚
  test("a failing nested write rolls back the whole operation", async () => {
    await ctx.db.tag.create({ data: { name: "dup" } });
    await expectOrmError(
      ctx.db.user.create({
        data: {
          email: "atomic@x.com",
          posts: { create: { title: "t", tags: { create: { name: "dup" } } } },
        },
      }),
      "UNIQUE_CONSTRAINT",
    );
    expect(await ctx.db.user.count()).toBe(0);
    expect(await ctx.db.post.count()).toBe(0);
  });

  // onDelete: Cascade 级联删除，SetNull 置空引用
  test("onDelete Cascade removes dependents and SetNull clears references", async () => {
    const author = await makeUser(ctx.db);
    const reviewer = await makeUser(ctx.db);
    const post = await ctx.db.post.create({
      data: {
        title: "c",
        authorId: author.id,
        reviewerId: reviewer.id,
        comments: { create: { body: "hi", authorId: reviewer.id } },
      },
    });
    await ctx.db.profile.create({ data: { userId: author.id } });

    await ctx.db.user.delete({ where: { id: reviewer.id } });
    expect((await ctx.db.post.findUniqueOrThrow({ where: { id: post.id } })).reviewerId).toBeNull();
    expect(await ctx.db.comment.count()).toBe(0);

    await ctx.db.user.delete({ where: { id: author.id } });
    expect(await ctx.db.post.count()).toBe(0);
    expect(await ctx.db.profile.count()).toBe(0);
  });

  // 默认的 Restrict 阻止删除仍被引用的父记录
  test("Restrict (the default) blocks deleting a referenced parent", async () => {
    const account = await ctx.db.account.create({
      data: { email: "r@x.com", entries: { create: { title: "e" } } },
    });
    await expectOrmError(ctx.db.account.forceDelete({ where: { id: account.id } }), "FOREIGN_KEY_CONSTRAINT");
  });

  // 自关联父记录删除后子记录 parentId 置空
  test("self relation parent SetNull on delete", async () => {
    const root = await ctx.db.category.create({
      data: { name: "root", children: { create: { name: "leaf" } } },
    });
    await ctx.db.category.delete({ where: { id: root.id } });
    const leaf = await ctx.db.category.findFirstOrThrow({ where: { name: "leaf" } });
    expect(leaf.parentId).toBeNull();
  });

  // 嵌套写入最多 8 层
  test("nested writes are limited to 8 levels", async () => {
    let data: any = { name: "deep" };
    for (let i = 0; i < 10; i++) {
      data = { name: "n" + i, children: { create: data } };
    }
    await expectOrmError(ctx.db.category.create({ data }), "VALIDATION");
  });
});
