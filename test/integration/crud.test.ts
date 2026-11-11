// 基础增删改查：默认值、唯一查询、原子更新、upsert、批量写入、标量类型和约束错误。
import { expect, test } from "bun:test";
import { eachDatabase, expectOrmError, makeUser } from "../helpers/client.js";

const DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

eachDatabase("crud", (ctx) => {
  // 创建时应用默认值，并返回实际写入的记录
  test("create applies defaults and returns the written row", async () => {
    const user = await ctx.db.user.create({ data: { email: "alice@example.com" } });
    expect(user.id).toBeNumber();
    expect(user).toMatchObject({
      email: "alice@example.com",
      name: null,
      role: "member",
      age: null,
    });
    expect(user.createdAt).toMatch(DATE_TIME);
    expect(user.updatedAt).toMatch(DATE_TIME);

    const post = await ctx.db.post.create({ data: { title: "Hello", authorId: user.id } });
    expect(post).toMatchObject({ published: false, views: 0, content: null, reviewerId: null });
  });

  // @auto 主键不允许显式赋值
  test("create rejects an explicit @auto id", async () => {
    await expectOrmError(ctx.db.user.create({ data: { id: 99, email: "x@example.com" } as any }), "VALIDATION");
  });

  // 拒绝未知字段、类型错误和非法枚举值
  test("create rejects unknown fields and wrong types", async () => {
    await expectOrmError(ctx.db.user.create({ data: { email: "a@x.com", nope: 1 } as any }), "VALIDATION");
    await expectOrmError(ctx.db.user.create({ data: { email: 42 } as any }), "VALIDATION");
    await expectOrmError(ctx.db.user.create({ data: { email: "a@x.com", role: "owner" } as any }), "VALIDATION");
  });

  // create 支持 select / include / omit 投影
  test("create with select, include and omit projections", async () => {
    const selected = await ctx.db.user.create({
      data: { email: "sel@example.com", name: "Sel" },
      select: { email: true },
    });
    expect(selected).toEqual({ email: "sel@example.com" });

    const omitted = await ctx.db.user.create({
      data: { email: "omit@example.com" },
      omit: { createdAt: true, updatedAt: true },
    });
    expect(omitted).not.toHaveProperty("createdAt");
    expect(omitted).not.toHaveProperty("updatedAt");

    const included = await ctx.db.user.create({
      data: { email: "inc@example.com", posts: { create: { title: "P" } } },
      include: { posts: true },
    });
    expect(included.posts).toHaveLength(1);
    expect(included.posts[0].title).toBe("P");
  });

  // 按主键、@unique 字段和复合键查询唯一记录
  test("findUnique by primary key, @unique field and composite keys", async () => {
    const user = await makeUser(ctx.db, { email: "u@example.com" });
    expect((await ctx.db.user.findUnique({ where: { id: user.id } }))?.email).toBe("u@example.com");
    expect((await ctx.db.user.findUnique({ where: { email: "u@example.com" } }))?.id).toBe(user.id);
    expect(await ctx.db.user.findUnique({ where: { email: "missing@example.com" } })).toBeNull();

    await ctx.db.membership.create({
      data: { organization: "acme", email: "u@example.com", level: 3 },
    });
    const member = await ctx.db.membership.findUnique({
      where: { organization: "acme", email: "u@example.com" },
    });
    expect(member?.level).toBe(3);

    await ctx.db.slot.create({ data: { owner: "bob", slot: 1 } });
    expect(await ctx.db.slot.findUnique({ where: { owner: "bob", slot: 1 } })).not.toBeNull();
  });

  // findUnique 的 where 必须是完整的唯一键
  test("findUnique requires a complete unique key", async () => {
    await expectOrmError(ctx.db.user.findUnique({ where: { name: "x" } as any }), "VALIDATION");
    await expectOrmError(ctx.db.membership.findUnique({ where: { organization: "acme" } as any }), "VALIDATION");
  });

  // OrThrow 系列查询未命中时抛出 NOT_FOUND
  test("OrThrow variants raise NOT_FOUND", async () => {
    await expectOrmError(ctx.db.user.findUniqueOrThrow({ where: { id: 404 } }), "NOT_FOUND");
    await expectOrmError(ctx.db.user.findFirstOrThrow({ where: { name: "nobody" } }), "NOT_FOUND");
    const user = await makeUser(ctx.db, { name: "found" });
    expect((await ctx.db.user.findFirstOrThrow({ where: { name: "found" } })).id).toBe(user.id);
  });

  // findFirst 遵循 where 和 orderBy
  test("findFirst honours where and orderBy", async () => {
    await makeUser(ctx.db, { name: "b", age: 20 });
    await makeUser(ctx.db, { name: "a", age: 30 });
    expect((await ctx.db.user.findFirst({ orderBy: { name: "asc" } }))?.name).toBe("a");
    expect((await ctx.db.user.findFirst({ where: { age: { lt: 25 } } }))?.name).toBe("b");
    expect(await ctx.db.user.findFirst({ where: { age: { gt: 99 } } })).toBeNull();
  });

  // update 写入标量字段并刷新 @updatedAt
  test("update writes scalar fields and bumps @updatedAt", async () => {
    const user = await ctx.db.user.create({
      data: { email: "upd@example.com", name: "Before" },
    });
    await Bun.sleep(5);
    const updated = await ctx.db.user.update({ where: { id: user.id }, data: { name: "After" } });
    expect(updated.name).toBe("After");
    expect(updated.updatedAt > user.updatedAt).toBeTrue();
    expect(updated.createdAt).toBe(user.createdAt);
  });

  // 更新或删除不存在的记录时抛出 NOT_FOUND
  test("update and delete raise NOT_FOUND for missing records", async () => {
    await expectOrmError(ctx.db.user.update({ where: { id: 404 }, data: { name: "x" } }), "NOT_FOUND");
    await expectOrmError(ctx.db.user.delete({ where: { id: 404 } }), "NOT_FOUND");
  });

  // delete 返回被删除的记录
  test("delete returns the deleted row", async () => {
    const user = await makeUser(ctx.db, { name: "gone" });
    const deleted = await ctx.db.user.delete({ where: { id: user.id }, select: { name: true } });
    expect(deleted).toEqual({ name: "gone" });
    expect(await ctx.db.user.count()).toBe(0);
  });

  // 原子数值运算：increment / decrement / multiply / divide / set
  test("atomic number operations", async () => {
    const user = await makeUser(ctx.db);
    const post = await ctx.db.post.create({ data: { title: "n", authorId: user.id, views: 10 } });
    const step = (data: any) => {
      return ctx.db.post.update({ where: { id: post.id }, data, select: { views: true } });
    };
    expect(await step({ views: { increment: 5 } })).toEqual({ views: 15 });
    expect(await step({ views: { decrement: 3 } })).toEqual({ views: 12 });
    expect(await step({ views: { multiply: 2 } })).toEqual({ views: 24 });
    expect(await step({ views: { divide: 5 } })).toEqual({ views: 4 });
    expect(await step({ views: { set: 1 } })).toEqual({ views: 1 });
  });

  // 整数除法向零截断，除数为零时报错
  test("integer division truncates toward zero and rejects zero divisors", async () => {
    const user = await makeUser(ctx.db);
    const post = await ctx.db.post.create({ data: { title: "n", authorId: user.id, views: -7 } });
    const row = await ctx.db.post.update({
      where: { id: post.id },
      data: { views: { divide: 2 } },
    });
    expect(row.views).toBe(-3);
    await expectOrmError(ctx.db.post.update({ where: { id: post.id }, data: { views: { divide: 0 } } }), "VALIDATION");
  });

  // NULL 参与原子运算结果仍为 NULL
  test("atomic operations on NULL stay NULL", async () => {
    const user = await makeUser(ctx.db);
    const updated = await ctx.db.user.update({
      where: { id: user.id },
      data: { age: { increment: 1 } },
    });
    expect(updated.age).toBeNull();
  });

  // 整数运算溢出时抛出 NUMERIC_OVERFLOW 并回滚
  test("overflowing integer arithmetic raises NUMERIC_OVERFLOW and rolls back", async () => {
    const user = await makeUser(ctx.db);
    const post = await ctx.db.post.create({
      data: { title: "big", authorId: user.id, views: Number.MAX_SAFE_INTEGER - 1 },
    });
    await expectOrmError(ctx.db.post.update({ where: { id: post.id }, data: { views: { increment: 10 } } }), "NUMERIC_OVERFLOW");
    expect((await ctx.db.post.findUniqueOrThrow({ where: { id: post.id } })).views).toBe(Number.MAX_SAFE_INTEGER - 1);
  });

  // upsert：不存在时创建，存在时更新
  test("upsert creates when missing and updates when present", async () => {
    const created = await ctx.db.user.upsert({
      where: { email: "up@example.com" },
      create: { email: "up@example.com", name: "Created" },
      update: { name: "Updated" },
    });
    expect(created.name).toBe("Created");
    const updated = await ctx.db.user.upsert({
      where: { email: "up@example.com" },
      create: { email: "up@example.com", name: "Created" },
      update: { name: { set: "Updated" } },
    });
    expect(updated).toMatchObject({ id: created.id, name: "Updated" });
    expect(await ctx.db.user.count()).toBe(1);
  });

  // upsert 的 update 为空时原样返回已有记录（回归：PostgreSQL 曾报错）
  test("upsert with an empty update returns the existing row unchanged", async () => {
    const user = await makeUser(ctx.db, { email: "same@example.com", name: "Keep" });
    const row = await ctx.db.user.upsert({
      where: { email: "same@example.com" },
      create: { email: "same@example.com" },
      update: {},
    });
    expect(row).toMatchObject({ id: user.id, name: "Keep" });
  });

  // 按复合主键 upsert
  test("upsert on a composite key", async () => {
    const key = { organization: "acme", email: "m@example.com" };
    await ctx.db.membership.upsert({
      where: key,
      create: { ...key, level: 1 },
      update: { level: 2 },
    });
    const row = await ctx.db.membership.upsert({
      where: key,
      create: { ...key, level: 1 },
      update: { level: { increment: 5 } },
    });
    expect(row.level).toBe(6);
  });

  // createMany 批量插入并返回条数
  test("createMany inserts in bulk and reports the count", async () => {
    expect(await ctx.db.user.createMany({ data: [] })).toEqual({ count: 0 });
    const result = await ctx.db.user.createMany({
      data: [{ email: "a@x.com" }, { email: "b@x.com", name: "B" }, { email: "c@x.com" }],
    });
    expect(result).toEqual({ count: 3 });
    expect(await ctx.db.user.count()).toBe(3);
  });

  // createMany 遇到唯一冲突时整批回滚
  test("createMany rolls back every row on a unique violation", async () => {
    await makeUser(ctx.db, { email: "dup@x.com" });
    await expectOrmError(ctx.db.user.createMany({ data: [{ email: "new@x.com" }, { email: "dup@x.com" }] }), "UNIQUE_CONSTRAINT");
    expect(await ctx.db.user.count()).toBe(1);
  });

  // skipDuplicates 跳过已存在和批内重复的记录
  test("createMany with skipDuplicates skips existing and in-batch duplicates", async () => {
    await makeUser(ctx.db, { email: "dup@x.com" });
    const result = await ctx.db.user.createMany({
      data: [{ email: "dup@x.com" }, { email: "n1@x.com" }, { email: "n1@x.com" }, { email: "n2@x.com" }],
      skipDuplicates: true,
    });
    expect(result).toEqual({ count: 2 });
    expect(await ctx.db.user.count()).toBe(3);
  });

  // 大批量输入按参数预算自动分批
  test("createMany splits large inputs into batches", async () => {
    const data = Array.from({ length: 700 }, (_, i) => {
      return { email: `bulk-${i}@x.com`, age: i };
    });
    expect(await ctx.db.user.createMany({ data })).toEqual({ count: 700 });
    expect(await ctx.db.user.count()).toBe(700);
  });

  // createManyAndReturn 返回全部新建记录
  test("createManyAndReturn returns every created row", async () => {
    const rows = await ctx.db.user.createManyAndReturn({
      data: [{ email: "r1@x.com" }, { email: "r2@x.com" }],
      select: { id: true, email: true },
    });
    expect(
      rows
        .map((r) => {
          return r.email;
        })
        .sort(),
    ).toEqual(["r1@x.com", "r2@x.com"]);
    for (const row of rows) {
      expect(row.id).toBeNumber();
    }
  });

  // updateMany 的 count 包含值未变化的匹配行
  test("updateMany updates matching rows and counts unchanged matches", async () => {
    await ctx.db.user.createMany({
      data: [
        { email: "a@x.com", age: 10 },
        { email: "b@x.com", age: 20 },
        { email: "c@x.com", age: 30 },
      ],
    });
    expect(await ctx.db.user.updateMany({ where: { age: { gte: 20 } }, data: { name: "old" } })).toEqual({
      count: 2,
    });
    expect(await ctx.db.user.updateMany({ where: { age: { gte: 20 } }, data: { name: "old" } })).toEqual({
      count: 2,
    });
    expect(await ctx.db.user.count({ where: { name: "old" } })).toBe(2);
    expect(
      await ctx.db.user.updateMany({
        where: { age: { gte: 10 } },
        data: { age: { increment: 1 } },
      }),
    ).toEqual({ count: 3 });
    expect(
      (await ctx.db.user.findMany({ orderBy: { age: "asc" } })).map((u) => {
        return u.age;
      }),
    ).toEqual([11, 21, 31]);
  });

  // 即使过滤字段被改写，updateManyAndReturn 仍返回这些记录
  test("updateManyAndReturn returns rows even when the filter field changed", async () => {
    const user = await makeUser(ctx.db);
    await ctx.db.post.createMany({
      data: [
        { title: "a", authorId: user.id },
        { title: "b", authorId: user.id },
        { title: "c", authorId: user.id, published: true },
      ],
    });
    const rows = await ctx.db.post.updateManyAndReturn({
      where: { published: false },
      data: { published: true, views: { increment: 1 } },
      include: { author: { select: { email: true } } },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ published: true, views: 1, author: { email: user.email } });
    }
  });

  // deleteMany 删除匹配的记录，空条件删除全部
  test("deleteMany removes matching rows", async () => {
    await ctx.db.user.createMany({
      data: [{ email: "a@x.com" }, { email: "b@x.com" }, { email: "c@y.com" }],
    });
    expect(await ctx.db.user.deleteMany({ where: { email: { endsWith: "@x.com" } } })).toEqual({
      count: 2,
    });
    expect(await ctx.db.user.deleteMany({ where: { email: { endsWith: "@y.com" } } })).toEqual({
      count: 1,
    });
  });

  // updateMany 和 updateManyAndReturn 必须显式提供非空 where
  test("bulk updates require where", async () => {
    await expectOrmError((ctx.db.user.updateMany as any)({ data: { name: "x" } }), "VALIDATION");
    await expectOrmError(ctx.db.user.updateMany({ where: {}, data: { name: "x" } }), "VALIDATION");
    await expectOrmError((ctx.db.post.updateManyAndReturn as any)({ data: { views: 1 } }), "VALIDATION");
    await expectOrmError(ctx.db.post.updateManyAndReturn({ where: {}, data: { views: 1 } }), "VALIDATION");
  });

  // deleteMany 和 forceDeleteMany 必须显式提供非空 where
  test("deleteMany and forceDeleteMany require where", async () => {
    await expectOrmError((ctx.db.user.deleteMany as any)(), "VALIDATION");
    await expectOrmError(ctx.db.user.deleteMany({ where: {} }), "VALIDATION");
    await expectOrmError((ctx.db.user.forceDeleteMany as any)(), "VALIDATION");
    await expectOrmError(ctx.db.user.forceDeleteMany({ where: {} }), "VALIDATION");
  });

  // count 支持 where 与 distinct
  test("count with where and distinct", async () => {
    await ctx.db.user.createMany({
      data: [
        { email: "a@x.com", name: "same" },
        { email: "b@x.com", name: "same" },
        { email: "c@x.com", name: "other" },
      ],
    });
    expect(await ctx.db.user.count()).toBe(3);
    expect(await ctx.db.user.count({ where: { name: "same" } })).toBe(2);
    expect(await ctx.db.user.count({ distinct: ["name"] })).toBe(2);
  });

  // 唯一约束冲突映射为 UNIQUE_CONSTRAINT
  test("unique constraint violations map to UNIQUE_CONSTRAINT", async () => {
    await makeUser(ctx.db, { email: "taken@example.com" });
    await expectOrmError(makeUser(ctx.db, { email: "taken@example.com" }), "UNIQUE_CONSTRAINT");
    await ctx.db.slot.create({ data: { owner: "o", slot: 1 } });
    await expectOrmError(ctx.db.slot.create({ data: { owner: "o", slot: 1 } }), "UNIQUE_CONSTRAINT");
  });

  // 外键约束冲突映射为 FOREIGN_KEY_CONSTRAINT
  test("foreign key violations map to FOREIGN_KEY_CONSTRAINT", async () => {
    await expectOrmError(ctx.db.post.create({ data: { title: "orphan", authorId: 123456 } }), "FOREIGN_KEY_CONSTRAINT");
  });

  // uuid() 默认值、@map 列名，以及 decimal / bigint / bytes 读写往返
  test("uuid() defaults, @map columns, decimal, bigint and bytes round-trip", async () => {
    const payload = new Uint8Array([0, 1, 2, 254, 255]);
    const product = await ctx.db.product.create({
      data: { sku: "SKU-1", price: "19.99", stock: 9007199254740993n, payload },
    });
    expect(product.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(product.price).toBe("19.99");
    expect(product.stock).toBe("9007199254740993");
    expect(product.payload).toBeInstanceOf(Uint8Array);
    expect([...product.payload!]).toEqual([...payload]);
    expect(product.active).toBeTrue();

    const found = await ctx.db.product.findUniqueOrThrow({ where: { sku: "SKU-1" } });
    expect(found).toEqual(product);

    const bumped = await ctx.db.product.update({
      where: { id: product.id },
      data: { price: { increment: "0.01" }, stock: { decrement: 3n } },
    });
    expect(bumped.price).toBe("20.00");
    expect(bumped.stock).toBe("9007199254740990");
  });

  // 超出声明精度或小数位数的 decimal 被拒绝
  test("decimal values beyond the declared scale are rejected", async () => {
    await expectOrmError(ctx.db.product.create({ data: { sku: "S", price: "1.234" } }), "VALIDATION");
    await expectOrmError(ctx.db.product.create({ data: { sku: "S", price: "123456789.00" } }), "VALIDATION");
  });

  // int 字段拒绝非安全整数和小数
  test("int fields reject unsafe integers", async () => {
    await expectOrmError(makeUser(ctx.db, { age: 2 ** 60 }), "VALIDATION");
    await expectOrmError(makeUser(ctx.db, { age: 1.5 }), "VALIDATION");
  });
});
