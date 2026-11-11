// 软删除：可见性、恢复、物理删除、唯一键占用和关系上的约束。
import { expect, test } from "bun:test";
import { eachDatabase, expectOrmError } from "../helpers/client.js";

eachDatabase("soft delete", (ctx) => {
  const account = (email = "a@x.com") => {
    return ctx.db.account.create({
      data: { email, entries: { create: [{ title: "e1" }, { title: "e2" }] } },
    });
  };

  // delete 写入删除时间，记录在默认查询中隐藏
  test("delete sets the deletion time and hides the record", async () => {
    const row = await account();
    const deleted = await ctx.db.account.delete({ where: { id: row.id } });
    expect(deleted.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2} /);
    expect(await ctx.db.account.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await ctx.db.account.findMany()).toEqual([]);
    expect(await ctx.db.account.count()).toBe(0);
    expect(await ctx.db.account.count({ deleted: "include" })).toBe(1);
  });

  // deleted: 'include' / 'only' 控制可见性
  test("deleted: include and only control visibility", async () => {
    const kept = await account("kept@x.com");
    const gone = await account("gone@x.com");
    await ctx.db.account.delete({ where: { id: gone.id } });
    const emails = async (deleted: any) => {
      return (await ctx.db.account.findMany({ deleted, orderBy: { id: "asc" } })).map((a) => {
        return a.email;
      });
    };
    expect(await emails("exclude")).toEqual([kept.email]);
    expect(await emails("include")).toEqual([kept.email, gone.email]);
    expect(await emails("only")).toEqual([gone.email]);
    expect(await ctx.db.account.findUnique({ where: { id: gone.id }, deleted: "include" })).not.toBeNull();
  });

  // restore 恢复记录，restoreMany 返回恢复条数
  test("restore brings a record back and restoreMany counts restored rows", async () => {
    const row = await account();
    await ctx.db.account.delete({ where: { id: row.id } });
    const restored = await ctx.db.account.restore({ where: { id: row.id } });
    expect(restored.deletedAt).toBeNull();
    expect(await ctx.db.account.count()).toBe(1);

    await ctx.db.entry.deleteMany({ where: { accountId: row.id } });
    expect(await ctx.db.entry.count()).toBe(0);
    expect(await ctx.db.entry.restoreMany({ where: { accountId: row.id } })).toEqual({ count: 2 });
    expect(await ctx.db.entry.count()).toBe(2);
  });

  // restoreMany 必须显式提供非空 where
  test("restoreMany requires where", async () => {
    await expectOrmError((ctx.db.account.restoreMany as any)(), "VALIDATION");
    await expectOrmError(ctx.db.account.restoreMany({ where: {} }), "VALIDATION");
  });

  // forceDelete 物理删除记录
  test("forceDelete removes rows physically", async () => {
    const row = await ctx.db.account.create({ data: { email: "f@x.com" } });
    await ctx.db.account.forceDelete({ where: { id: row.id } });
    expect(await ctx.db.account.count({ deleted: "include" })).toBe(0);
    expect(await ctx.db.entry.forceDeleteMany({ where: { id: { gt: 0 } } })).toEqual({ count: 0 });
  });

  // 普通更新跳过已删除记录，删除时间字段只读
  test("ordinary updates skip deleted records and the management field is read-only", async () => {
    const row = await account();
    await ctx.db.account.delete({ where: { id: row.id } });
    await expectOrmError(ctx.db.account.update({ where: { id: row.id }, data: { name: "x" } }), "NOT_FOUND");
    expect(await ctx.db.account.updateMany({ where: { id: { gt: 0 } }, data: { name: "x" } })).toEqual({ count: 0 });
    await expectOrmError(ctx.db.account.update({ where: { id: row.id }, data: { deletedAt: null } } as any), "VALIDATION");
    await expectOrmError(
      ctx.db.account.create({
        data: { email: "n@x.com", deletedAt: "2026-01-01 00:00:00" },
      } as any),
      "VALIDATION",
    );
  });

  // 已软删除的记录仍然占用唯一键
  test("deleted records keep occupying unique keys", async () => {
    const row = await account("same@x.com");
    await ctx.db.account.delete({ where: { id: row.id } });
    await expectOrmError(ctx.db.account.create({ data: { email: "same@x.com" } }), "UNIQUE_CONSTRAINT");
  });

  // upsert 不会恢复已删除的记录
  test("upsert does not restore a deleted record", async () => {
    const row = await account("up@x.com");
    await ctx.db.account.delete({ where: { id: row.id } });
    await expect(
      ctx.db.account.upsert({
        where: { email: "up@x.com" },
        create: { email: "up@x.com" },
        update: { name: "x" },
      }),
    ).rejects.toThrow();
    expect(await ctx.db.account.count()).toBe(0);
  });

  // 预加载和关系过滤默认隐藏已删除的子记录
  test("eager loading and relation filters hide deleted children", async () => {
    const row = await account();
    const e1 = await ctx.db.entry.findFirstOrThrow({ where: { title: "e1" } });
    await ctx.db.entry.delete({ where: { id: e1.id } });

    const loaded = await ctx.db.account.findUniqueOrThrow({
      where: { id: row.id },
      include: { entries: true, _count: true },
    });
    expect(
      loaded.entries.map((e) => {
        return e.title;
      }),
    ).toEqual(["e2"]);
    expect(loaded._count.entries).toBe(1);

    const withDeleted = await ctx.db.account.findUniqueOrThrow({
      where: { id: row.id },
      include: { entries: { deleted: "include", orderBy: { title: "asc" } } },
    });
    expect(
      withDeleted.entries.map((e) => {
        return e.title;
      }),
    ).toEqual(["e1", "e2"]);

    expect(await ctx.db.account.count({ where: { entries: { some: { title: "e1" } } } })).toBe(0);
  });

  // 必填关系的目标已被删除时抛出 SOFT_DELETED_RELATION
  test("a required relation to a deleted target raises SOFT_DELETED_RELATION", async () => {
    const row = await account();
    await ctx.db.account.delete({ where: { id: row.id } });
    await expectOrmError(ctx.db.entry.findMany({ include: { account: true } }), "SOFT_DELETED_RELATION");
  });

  // 外键或 connect 指向已删除记录时抛出 SOFT_DELETED_REFERENCE
  test("writing a foreign key to a deleted target raises SOFT_DELETED_REFERENCE", async () => {
    const row = await ctx.db.account.create({ data: { email: "ref@x.com" } });
    await ctx.db.account.delete({ where: { id: row.id } });
    await expectOrmError(ctx.db.entry.create({ data: { title: "orphan", accountId: row.id } }), "SOFT_DELETED_REFERENCE");
    await expectOrmError(ctx.db.entry.create({ data: { title: "orphan", account: { connect: { id: row.id } } } }), "SOFT_DELETED_REFERENCE");
  });

  // restore 需要 @@softDelete；在普通模型上 forceDelete 就是普通删除
  test("restore needs @@softDelete; forceDelete is a plain delete on other models", async () => {
    // 生成的类型在每个模型上都暴露了 restore，只有运行时会拒绝。
    await expectOrmError(ctx.db.user.restore({ where: { id: 1 } }), "VALIDATION");
    await expectOrmError(ctx.db.user.restoreMany({ where: { id: { gt: 0 } } }), "VALIDATION");
    await ctx.db.user.create({ data: { email: "plain@x.com" } });
    expect(await ctx.db.user.forceDeleteMany({ where: { id: { gt: 0 } } })).toEqual({ count: 1 });
  });

  // 聚合默认排除已删除的记录
  test("aggregates and groupBy exclude deleted rows", async () => {
    await account("x@x.com");
    const gone = await account("y@x.com");
    await ctx.db.account.delete({ where: { id: gone.id } });
    expect((await ctx.db.account.aggregate({ _count: true }))._count).toBe(1);
    expect((await ctx.db.account.aggregate({ _count: true, deleted: "include" }))._count).toBe(2);
  });
});
