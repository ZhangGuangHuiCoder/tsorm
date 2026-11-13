// 原生 SQL：参数绑定、注入防护、片段组合和错误映射。
import { expect, test } from "bun:test";
import { sql } from "../../src/index.js";
import { eachDatabase, expectOrmError, makeUser } from "../helpers/client.js";

eachDatabase("raw sql", (ctx) => {
  const mysqlLike = () => {
    return ctx.target === "mysql" || ctx.target === "mariadb";
  };

  // $queryRaw 把插值绑定为参数
  test("$queryRaw binds interpolations as parameters", async () => {
    await makeUser(ctx.db, { email: "o'brien@x.com", name: "Quote" });
    const email = "o'brien@x.com";
    const rows = mysqlLike() ? await ctx.db.$queryRaw<{ name: string }[]>`SELECT name FROM \`app_User\` WHERE email = ${email}` : await ctx.db.$queryRaw<{ name: string }[]>`SELECT name FROM "app_User" WHERE email = ${email}`;
    expect(rows).toEqual([{ name: "Quote" }]);
  });

  // SQL 注入尝试只会被当作普通值
  test("injection attempts stay inert values", async () => {
    await makeUser(ctx.db);
    const evil = "x' OR '1'='1";
    const rows = mysqlLike() ? await ctx.db.$queryRaw<unknown[]>`SELECT id FROM \`app_User\` WHERE email = ${evil}` : await ctx.db.$queryRaw<unknown[]>`SELECT id FROM "app_User" WHERE email = ${evil}`;
    expect(rows).toEqual([]);
  });

  // $executeRaw 返回受影响行数
  test("$executeRaw returns the affected row count", async () => {
    await ctx.db.user.createMany({ data: [{ email: "a@x.com" }, { email: "b@x.com" }] });
    const affected = mysqlLike() ? await ctx.db.$executeRaw`UPDATE \`app_User\` SET name = ${"raw"} WHERE email LIKE ${"%@x.com"}` : await ctx.db.$executeRaw`UPDATE "app_User" SET name = ${"raw"} WHERE email LIKE ${"%@x.com"}`;
    expect(affected).toBe(2);
    expect(await ctx.db.user.count({ where: { name: "raw" } })).toBe(2);
  });

  // sql 片段可组合，参数顺序保持不变
  test("sql fragments compose and keep parameter order", async () => {
    await ctx.db.user.createMany({
      data: [
        { email: "a@x.com", age: 10 },
        { email: "b@x.com", age: 20 },
        { email: "c@x.com", age: 30 },
      ],
    });
    const low = sql`age >= ${15}`;
    const high = sql`age <= ${25}`;
    const query = mysqlLike() ? sql`SELECT email FROM \`app_User\` WHERE ${low} AND ${high}` : sql`SELECT email FROM "app_User" WHERE ${low} AND ${high}`;
    expect(await ctx.db.$queryRaw<{ email: string }[]>(query)).toEqual([{ email: "b@x.com" }]);
  });

  // 原生 SQL 中使用 @map 后的物理名
  test("@map names are the physical names in raw SQL", async () => {
    await ctx.db.product.create({ data: { sku: "MAPPED", price: 1 } });
    const rows = mysqlLike() ? await ctx.db.$queryRaw<{ product_sku: string }[]>`SELECT product_sku FROM app_products` : await ctx.db.$queryRaw<{ product_sku: string }[]>`SELECT product_sku FROM app_products`;
    expect(rows).toEqual([{ product_sku: "MAPPED" }]);
  });

  // 原生 SQL 拒绝普通字符串和非法参数
  test("raw SQL rejects plain strings and invalid parameters", async () => {
    await expectOrmError(ctx.db.$queryRaw("SELECT 1" as any), "VALIDATION");
    await expectOrmError(ctx.db.$queryRaw`SELECT ${undefined} AS v`, "VALIDATION");
    await expectOrmError(ctx.db.$queryRaw`SELECT ${Number.NaN} AS v`, "VALIDATION");
  });

  // 原生 SQL 的数据库错误同样映射为 OrmError 错误码
  test("raw SQL errors are mapped to OrmError codes", async () => {
    await makeUser(ctx.db, { email: "dup@x.com" });
    const insert = mysqlLike()
      ? ctx.db.$executeRaw`INSERT INTO \`app_User\` (email, role, createdAt, updatedAt) VALUES (${"dup@x.com"}, 'member', ${"2026-01-01 00:00:00"}, ${"2026-01-01 00:00:00"})`
      : ctx.db.$executeRaw`INSERT INTO "app_User" (email, role, "createdAt", "updatedAt") VALUES (${"dup@x.com"}, 'member', ${"2026-01-01 00:00:00"}, ${"2026-01-01 00:00:00"})`;
    await expectOrmError(insert, "UNIQUE_CONSTRAINT");
  });
});
