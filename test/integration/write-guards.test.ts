// 全表写入护栏：批量写拒绝空条件，`$clear` 是唯一的显式清空入口，`maxAffected` 限制单次影响行数。
import { expect, test } from "bun:test";
import { eachDatabase, expectOrmError } from "../helpers/client.js";

eachDatabase("write guards", (ctx) => {
  // 空对象 where 与缺省 where 一样被拒绝，提示信息区分两种情况
  test("bulk methods reject an empty where", async () => {
    const missing = await expectOrmError((ctx.db.user.updateMany as any)({ data: { name: "x" } }), "VALIDATION");
    expect(missing.message).toBe("updateMany requires where");
    const empty = await expectOrmError(ctx.db.user.updateMany({ where: {}, data: { name: "x" } }), "VALIDATION");
    expect(empty.message).toBe("updateMany requires a non-empty where");
    await expectOrmError(ctx.db.post.updateManyAndReturn({ where: {}, data: { views: 1 } }), "VALIDATION");
    await expectOrmError(ctx.db.user.deleteMany({ where: {} }), "VALIDATION");
    await expectOrmError(ctx.db.user.forceDeleteMany({ where: {} }), "VALIDATION");
    await expectOrmError(ctx.db.account.restoreMany({ where: {} }), "VALIDATION");
  });

  // $clear 清空整表并返回删除条数
  test("$clear empties a table and reports the row count", async () => {
    await ctx.db.user.createMany({ data: [{ email: "a@x.com" }, { email: "b@x.com" }] });
    expect(await ctx.db.$clear("user")).toEqual({ count: 2 });
    expect(await ctx.db.user.count()).toBe(0);
  });

  // 软删除模型默认只写删除时间，force 才物理删除
  test("$clear soft deletes by default and removes rows with force", async () => {
    await ctx.db.account.createMany({ data: [{ email: "a@x.com" }, { email: "b@x.com" }] });
    expect(await ctx.db.$clear("account")).toEqual({ count: 2 });
    expect(await ctx.db.account.count()).toBe(0);
    expect(await ctx.db.account.count({ deleted: "include" })).toBe(2);
    expect(await ctx.db.$clear("account", { force: true })).toEqual({ count: 2 });
    expect(await ctx.db.account.count({ deleted: "include" })).toBe(0);
  });

  // $clear 在事务内同样可用，随事务一起提交
  test("$clear runs inside a transaction", async () => {
    await ctx.db.user.create({ data: { email: "t@x.com" } });
    const count = await ctx.db.$transaction(async (tx) => {
      return (await tx.$clear("user")).count;
    });
    expect(count).toBe(1);
    expect(await ctx.db.user.count()).toBe(0);
  });

  // 模型名与选项都在执行前校验
  test("$clear validates the model and options", async () => {
    await expectOrmError((ctx.db.$clear as any)("nope"), "VALIDATION");
    await expectOrmError((ctx.db.$clear as any)(), "VALIDATION");
    await expectOrmError((ctx.db.$clear as any)("user", { force: "yes" }), "VALIDATION");
    await expectOrmError((ctx.db.$clear as any)("user", { nope: true }), "VALIDATION");
  });
});
