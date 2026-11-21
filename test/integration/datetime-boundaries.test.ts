// 日期时间在真实数据库上的边界：年份、闰日、非法输入、时间戳范围与 NULL。
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "../../src/core/client.js";
import { parseSchema } from "../../src/schema/index.js";
import { eachDatabase, expectOrmError, makeUser } from "../helpers/client.js";
import { sandbox } from "../helpers/databases.js";

eachDatabase("datetime boundaries", (ctx) => {
  // mariadb 与 mysql 共用 mysql 适配器，同样只接受 1000..9999 年。
  const mysqlFamily = () => {
    return ctx.target === "mysql" || ctx.target === "mariadb";
  };
  /** MySQL 只接受 1000..9999 年，因此边界留出一天的余量。 */
  const window = () => {
    const low = mysqlFamily() ? "1001-01-01T00:00:00.000Z" : "0001-01-01T00:00:00.000Z";
    const high = mysqlFamily() ? "9998-12-31T23:59:59.999Z" : "9999-12-31T23:59:59.999Z";
    return { low: new Date(low), high: new Date(high) };
  };
  test("datetime columns round-trip supported year and leap-day boundaries", async () => {
    const author = await makeUser(ctx.db);
    const range = window();
    const values = [range.low, new Date("2024-02-29T23:59:59.999Z"), range.high];
    const created: Date[] = [];
    for (const [index, createdAt] of values.entries()) {
      const post = await ctx.db.post.create({
        data: { title: `boundary-${index}`, authorId: author.id, createdAt },
      });
      created.push(post.createdAt);
    }
    expect(created).toEqual(values);
  });

  test("datetime filters compare chronologically across years", async () => {
    const author = await makeUser(ctx.db);
    const range = window();
    const leap = new Date("2024-02-29T23:59:59.999Z");
    await ctx.db.post.createMany({
      data: [
        { title: "low", authorId: author.id, createdAt: range.low },
        { title: "leap", authorId: author.id, createdAt: leap },
        { title: "high", authorId: author.id, createdAt: range.high },
      ],
    });
    const rows = await ctx.db.post.findMany({
      where: { createdAt: { gte: new Date("2024-02-29T00:00:00.000Z") } },
      orderBy: { createdAt: "asc" },
      select: { title: true, createdAt: true },
    });
    expect(rows).toEqual([
      { title: "leap", createdAt: leap },
      { title: "high", createdAt: range.high },
    ]);
  });

  test("non-Date values and out-of-range instants are rejected before reaching the database", async () => {
    const author = await makeUser(ctx.db);
    const invalid: any[] = ["nope", "2026-01-01 00:00:00", "2026-13-01T00:00:00.000Z", 0, new Date("nope"), new Date(Date.UTC(10000, 0, 1))];
    for (const createdAt of invalid) {
      await expectOrmError(ctx.db.post.create({ data: { title: "invalid", authorId: author.id, createdAt } }), "VALIDATION");
    }
  });

  describe("timestamp storage and nullable fields", () => {
    let box: Awaited<ReturnType<typeof sandbox>>;
    let db: any;

    beforeAll(async () => {
      box = await sandbox(ctx.target);
      const schema = parseSchema(`
model Event {
  id: int @id @auto
  at?: timestamp
  text?: datetime
}
model Required {
  id: int @id @auto
  at: datetime
  ts: timestamp
}`);
      db = createClient(schema, { adapter: box.adapter(schema) });
    });

    afterAll(async () => {
      await db?.$close();
      await box?.dispose();
    });

    beforeEach(async () => {
      await db.$clear("event", { force: true });
      await db.$clear("required", { force: true });
    });

    test("timestamp accepts epoch, pre-epoch and the minimum/maximum UTC years", async () => {
      const epoch = await db.event.create({ data: { at: new Date(0) } });
      expect(epoch.at).toEqual(new Date(0));

      const before = await db.event.create({ data: { at: new Date(-1) } });
      expect(before.at).toEqual(new Date(-1));

      const date = await db.event.create({ data: { at: new Date("2026-01-01T00:00:00.000Z") } });
      expect(date.at).toEqual(new Date("2026-01-01T00:00:00.000Z"));

      // timestamp 存毫秒，范围由 UTC 年份决定。
      const minimum = await db.event.create({ data: { at: new Date("0001-01-01T00:00:00.000Z") } });
      expect(minimum.at).toEqual(new Date("0001-01-01T00:00:00.000Z"));

      const maximum = await db.event.create({ data: { at: new Date("9999-12-31T23:59:59.999Z") } });
      expect(maximum.at).toEqual(new Date("9999-12-31T23:59:59.999Z"));
    });

    test("timestamp rejects instants that leave the supported UTC range", async () => {
      const min = new Date("0001-01-01T00:00:00.000Z").getTime();
      const max = new Date("9999-12-31T23:59:59.999Z").getTime();
      for (const at of [new Date(min - 1), new Date(max + 1), new Date(NaN), Number.MAX_SAFE_INTEGER + 1, "10000-01-01T00:00:00.000Z"]) {
        await expectOrmError(db.event.create({ data: { at } }), "VALIDATION");
      }
    });

    test("timestamp filters use the same numeric ordering", async () => {
      await db.event.createMany({
        data: [{ at: new Date(-1) }, { at: new Date(0) }, { at: new Date(1) }],
      });
      const rows = await db.event.findMany({
        where: { at: { lt: new Date(0) } },
        orderBy: { at: "asc" },
        select: { at: true },
      });
      expect(rows).toEqual([{ at: new Date(-1) }]);
    });

    test("nullable datetime and timestamp store omitted and explicit NULL", async () => {
      const omitted = await db.event.create({ data: {} });
      expect(omitted).toMatchObject({ at: null, text: null });
      const explicit = await db.event.create({ data: { at: null, text: null } });
      expect(explicit).toMatchObject({ at: null, text: null });
    });

    test("required fields reject NULL for both storage modes", async () => {
      await expectOrmError(db.required.create({ data: { at: null, ts: new Date(0) } }), "VALIDATION");
      await expectOrmError(db.required.create({ data: { at: new Date("2026-01-01T00:00:00.000Z"), ts: null } }), "VALIDATION");
    });

    test("MySQL rejects datetime values below year 1000 in the connection timezone", async () => {
      const at = new Date("0999-06-15T00:00:00.000Z");
      if (mysqlFamily()) {
        await expectOrmError(db.required.create({ data: { at, ts: new Date(0) } }), "VALIDATION");
      } else {
        const row = await db.required.create({ data: { at, ts: new Date(0) } });
        expect(row.at).toEqual(at);
      }
    });
  });
});
