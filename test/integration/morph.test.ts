// 多态 morph：判别值注入、include 与 _count 隔离、关系过滤、嵌套写入和能力边界。
import { expect, test } from "bun:test";
import { eachDatabase, expectOrmError, makeUser } from "../helpers/client.js";

eachDatabase("morph", (ctx) => {
  const seed = async () => {
    const user = await makeUser(ctx.db);
    const post = await ctx.db.post.create({ data: { title: "p1", authorId: user.id } });
    return { user, post };
  };

  // 嵌套 create 自动注入判别列与主键列；User 侧附件走显式标量列
  test("nested create fills the discriminator and owner key", async () => {
    const { user, post } = await seed();
    await ctx.db.post.update({
      where: { id: post.id },
      data: {
        attachments: { create: [{ name: "a1" }, { name: "a2" }] },
        notes: { create: { body: "n1" } },
      },
    });
    const rows = await ctx.db.attachment.findMany({ orderBy: { name: "asc" } });
    expect(rows).toHaveLength(2);
    expect(
      rows.every((r) => {
        return r.ownerType === "Post" && r.ownerId === post.id;
      }),
    ).toBeTrue();

    expect(await ctx.db.note.findMany()).toEqual([expect.objectContaining({ body: "n1", holderType: "Post", holderId: post.id })]);

    const attached = await ctx.db.attachment.create({
      data: { name: "a3", ownerType: "User", ownerId: user.id },
    });
    expect(attached).toMatchObject({ ownerType: "User", ownerId: user.id });
  });

  // createMany 同样注入判别值
  test("nested createMany fills the discriminator", async () => {
    const { post } = await seed();
    const created = await ctx.db.post.create({
      data: {
        title: "p2",
        authorId: post.authorId,
        attachments: { createMany: { data: [{ name: "m1" }, { name: "m2" }] } },
      },
    });
    const loaded = await ctx.db.post.findUniqueOrThrow({
      where: { id: created.id },
      include: { attachments: true },
    });
    expect(
      loaded.attachments
        .map((a) => {
          return a.name;
        })
        .sort(),
    ).toEqual(["m1", "m2"]);
    expect(
      loaded.attachments.every((a) => {
        return a.ownerType === "Post" && a.ownerId === created.id;
      }),
    ).toBeTrue();
  });

  // include 与 _count 只看见判别值匹配的行
  test("include and _count only see rows matching the discriminator", async () => {
    const { user, post } = await seed();
    await ctx.db.post.update({
      where: { id: post.id },
      data: { attachments: { createMany: { data: [{ name: "pa" }] } } },
    });
    await ctx.db.attachment.create({ data: { name: "ua", ownerType: "User", ownerId: user.id } });

    const loaded = await ctx.db.post.findUniqueOrThrow({
      where: { id: post.id },
      include: { attachments: true, _count: true },
    });
    expect(
      loaded.attachments.map((a) => {
        return a.name;
      }),
    ).toEqual(["pa"]);
    expect(loaded._count.attachments).toBe(1);

    const userSide = await ctx.db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { attachments: true },
    });
    expect(
      userSide.attachments.map((a) => {
        return a.name;
      }),
    ).toEqual(["ua"]);
  });

  // 关系过滤与计数排序都带判别常量：同 id 不同 ownerType 的行不参与
  test("relation filters and count ordering respect the discriminator", async () => {
    const { user, post } = await seed();
    const other = await ctx.db.post.create({ data: { title: "p2", authorId: user.id } });
    await ctx.db.post.update({
      where: { id: post.id },
      data: { attachments: { create: { name: "hit" } } },
    });
    // 拥有同主键值但 ownerType 为 User 的干扰行
    await ctx.db.attachment.create({ data: { name: "hit", ownerType: "User", ownerId: post.id } });

    const some = await ctx.db.post.findMany({ where: { attachments: { some: { name: "hit" } } } });
    expect(
      some.map((p) => {
        return p.title;
      }),
    ).toEqual(["p1"]);
    const none = await ctx.db.post.findMany({ where: { attachments: { none: { name: "hit" } } } });
    expect(
      none.map((p) => {
        return p.title;
      }),
    ).toEqual(["p2"]);
    const ordered = await ctx.db.post.findMany({ orderBy: { attachments: { _count: "desc" } } });
    expect(
      ordered.map((p) => {
        return p.title;
      }),
    ).toEqual(["p1", "p2"]);
    expect(other.id).toBeDefined();
  });

  // 嵌套 update、updateMany、delete 和 deleteMany 都限定在本拥有方内
  test("nested update, updateMany, delete and deleteMany operate within one owner", async () => {
    const { post } = await seed();
    await ctx.db.post.update({
      where: { id: post.id },
      data: { attachments: { createMany: { data: [{ name: "x1" }, { name: "x2" }] } } },
    });
    const [first, second] = await ctx.db.attachment.findMany({ orderBy: { name: "asc" } });

    await ctx.db.post.update({
      where: { id: post.id },
      data: {
        attachments: {
          update: { where: { id: first.id }, data: { name: "renamed" } },
          updateMany: { where: { name: "x2" }, data: { name: "x2b" } },
        },
      },
    });
    expect((await ctx.db.attachment.findUniqueOrThrow({ where: { id: first.id } })).name).toBe("renamed");
    expect((await ctx.db.attachment.findUniqueOrThrow({ where: { id: second.id } })).name).toBe("x2b");

    await ctx.db.post.update({
      where: { id: post.id },
      data: { attachments: { delete: { id: first.id } } },
    });
    expect(await ctx.db.attachment.count()).toBe(1);
    await ctx.db.post.update({ where: { id: post.id }, data: { attachments: { deleteMany: {} } } });
    expect(await ctx.db.attachment.count()).toBe(0);
  });

  // 嵌套 upsert：未命中按判别值创建，命中原地更新
  test("nested upsert creates with the discriminator or updates in place", async () => {
    const { post } = await seed();
    await ctx.db.post.update({
      where: { id: post.id },
      data: {
        attachments: {
          upsert: { where: { id: 424242 }, create: { name: "fresh" }, update: { name: "noop" } },
        },
      },
    });
    const created = await ctx.db.attachment.findFirstOrThrow();
    expect(created).toMatchObject({ name: "fresh", ownerType: "Post", ownerId: post.id });

    await ctx.db.post.update({
      where: { id: post.id },
      data: {
        attachments: {
          upsert: {
            where: { id: created.id },
            create: { name: "noop" },
            update: { name: "bumped" },
          },
        },
      },
    });
    expect((await ctx.db.attachment.findUniqueOrThrow({ where: { id: created.id } })).name).toBe("bumped");
  });

  // 软删除的附件从多态 include、计数和过滤中隐藏
  test("soft-deleted attachments hide from polymorphic reads", async () => {
    const { post } = await seed();
    await ctx.db.post.update({
      where: { id: post.id },
      data: { attachments: { create: { name: "gone" } } },
    });
    const row = await ctx.db.attachment.findFirstOrThrow();
    await ctx.db.attachment.delete({ where: { id: row.id } });

    const loaded = await ctx.db.post.findUniqueOrThrow({
      where: { id: post.id },
      include: { attachments: true, _count: true },
    });
    expect(loaded.attachments).toEqual([]);
    expect(loaded._count.attachments).toBe(0);
    expect(await ctx.db.post.count({ where: { attachments: { some: {} } } })).toBe(0);
  });

  // 能力边界：正向 include、holder 过滤/排序、直接写 holder 关系与所有权转移全部拒绝
  test("polymorphic capability boundaries", async () => {
    const { post } = await seed();
    await ctx.db.attachment.create({ data: { name: "a", ownerType: "Post", ownerId: post.id } });

    await expectOrmError(ctx.db.attachment.findMany({ include: { owner: true } } as any), "POLYMORPHIC_INCLUDE");
    await expectOrmError(ctx.db.attachment.findMany({ where: { owner: { email: { contains: "x" } } } } as any), "VALIDATION");
    await expectOrmError(ctx.db.attachment.findMany({ orderBy: { owner: { _count: "desc" } } } as any), "VALIDATION");
    await expectOrmError(
      ctx.db.attachment.create({
        data: {
          name: "b",
          ownerType: "Post",
          ownerId: post.id,
          owner: { connect: { id: post.id } },
        },
      } as any),
      "VALIDATION",
    );
    await expectOrmError(
      ctx.db.post.update({
        where: { id: post.id },
        data: { attachments: { connect: { id: 1 } } },
      } as any),
      "POLYMORPHIC_OPERATION",
    );
    await expectOrmError(ctx.db.post.update({ where: { id: post.id }, data: { notes: { set: [] } } } as any), "POLYMORPHIC_OPERATION");
    await expectOrmError(
      ctx.db.post.update({
        where: { id: post.id },
        data: { attachments: { disconnect: { id: 1 } } },
      } as any),
      "POLYMORPHIC_OPERATION",
    );
  });

  // 多态反向 include 的判别值与嵌套过滤条件共用一条语句，参数顺序必须与占位符一致
  test("polymorphic include keeps the discriminator and the nested filter in place", async () => {
    const { post } = await seed();
    await ctx.db.post.update({
      where: { id: post.id },
      data: { attachments: { createMany: { data: [{ name: "a1" }, { name: "a2" }] } } },
    });
    const loaded = await ctx.db.post.findUniqueOrThrow({
      where: { id: post.id },
      include: { attachments: { where: { name: "a1" } } },
    });
    expect(
      loaded.attachments.map((a) => {
        return a.name;
      }),
    ).toEqual(["a1"]);
  });

  // 多态计数同样带判别值与嵌套过滤条件
  test("polymorphic relation count keeps the discriminator and the nested filter in place", async () => {
    const { post } = await seed();
    await ctx.db.post.update({
      where: { id: post.id },
      data: { attachments: { createMany: { data: [{ name: "a1" }, { name: "a2" }] } } },
    });
    const loaded = await ctx.db.post.findUniqueOrThrow({
      where: { id: post.id },
      include: { _count: { select: { attachments: { where: { name: "a1" } } } } },
    });
    expect(loaded._count.attachments).toBe(1);
  });

  // distinct 查询按多态关系计数排序时，判别值与过滤条件的参数顺序必须与占位符一致
  test("distinct queries order by a polymorphic relation count with a filter", async () => {
    const { post } = await seed();
    await ctx.db.post.update({
      where: { id: post.id },
      data: { attachments: { create: { name: "a1" } } },
    });
    const rows = await ctx.db.post.findMany({
      where: { title: "p1" },
      distinct: "authorId",
      orderBy: { attachments: { _count: "desc" } },
    });
    expect(
      rows.map((p) => {
        return p.title;
      }),
    ).toEqual(["p1"]);
  });

  // 多态持有方的表也可以 updateMany：目标表未知，软删除引用检查直接跳过
  test("updateMany works on a table with a polymorphic owner relation", async () => {
    const { post } = await seed();
    await ctx.db.post.update({
      where: { id: post.id },
      data: { attachments: { create: { name: "a1" } } },
    });
    const result = await ctx.db.attachment.updateMany({
      where: { ownerType: "Post" },
      data: { name: "renamed" },
    });
    expect(result.count).toBe(1);
    expect((await ctx.db.attachment.findFirstOrThrow()).name).toBe("renamed");
  });
});
