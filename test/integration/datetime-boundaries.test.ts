// 日期时间在真实数据库上的边界：年份、闰日、非法日历值、timestamp 范围与 NULL。
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
  test("datetime columns round-trip supported year and leap-day boundaries", async () => {
    const author = await makeUser(ctx.db);
    // MySQL DATETIME 只接受 1000..9999 年；其余数据库支持 0001..9999。
    const low = mysqlFamily() ? "1000-01-01 00:00:00.000" : "0001-01-01 00:00:00.000";
    const values = [low, "2024-02-29 23:59:59.999", "9999-12-31 23:59:59.999"];
    const created: string[] = [];
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
    const low = mysqlFamily() ? "1000-01-01 00:00:00.000" : "0001-01-01 00:00:00.000";
    await ctx.db.post.createMany({
      data: [
        { title: "low", authorId: author.id, createdAt: low },
        { title: "leap", authorId: author.id, createdAt: "2024-02-29 23:59:59.999" },
        { title: "high", authorId: author.id, createdAt: "9999-12-31 23:59:59.999" },
      ],
    });
    const rows = await ctx.db.post.findMany({
      where: { createdAt: { gte: "2024-02-29 00:00:00" } },
      orderBy: { createdAt: "asc" },
      select: { title: true, createdAt: true },
    });
    expect(rows).toEqual([
      { title: "leap", createdAt: "2024-02-29 23:59:59.999" },
      { title: "high", createdAt: "9999-12-31 23:59:59.999" },
    ]);
  });

  test("invalid calendars are rejected before reaching the database", async () => {
    const author = await makeUser(ctx.db);
    const invalid = ["2023-02-29 00:00:00", "2026-04-31 00:00:00", "2026-01-01 24:00:00", "2026-01-01 00:60:00", "2026-01-01 00:00:60", "2026-01-01 00:00:00.1234", "2026-01-01 00:00:00Z", "0000-01-01 00:00:00"];
    for (const createdAt of invalid) {
      await expectOrmError(ctx.db.post.create({ data: { title: "invalid", authorId: author.id, createdAt } }), "VALIDATION");
    }
  });

  describe("timestamp storage and nullable fields", () => {
    let box: Awaited<ReturnType<typeof sandbox>>;
    let db: any;

    beforeAll(async () => {
      box = await sandbox(ctx.target);
      db = await createClient(
        parseSchema(`
model Event {
  id: int @id @auto
  at?: timestamp
  text?: datetime
}
model Required {
  id: int @id @auto
  at: datetime
  ts: timestamp
}`),
        { adapter: box.adapter(), timezone: "+08:00" },
      );
    });

    afterAll(async () => {
      await db?.$close();
      await box?.dispose();
    });

    beforeEach(async () => {
      await db.$clear("event", { force: true });
      await db.$clear("required", { force: true });
    });

    test("timestamp accepts epoch, pre-epoch and the minimum/maximum local years", async () => {
      const epoch = await db.event.create({ data: { at: 0 } });
      expect(epoch.at).toBe("1970-01-01 08:00:00.000");

      const before = await db.event.create({ data: { at: -1 } });
      expect(before.at).toBe("1970-01-01 07:59:59.999");

      const date = await db.event.create({ data: { at: new Date("2026-01-01T00:00:00.000Z") } });
      expect(date.at).toBe("2026-01-01 08:00:00.000");

      // +08:00 下，0001-01-01 00:00 的 UTC 值落在 0000 年；最小可表示本地时间是 08:00。
      const minimum = await db.event.create({ data: { at: -62135596800000 } });
      expect(minimum.at).toBe("0001-01-01 08:00:00.000");

      const maximum = await db.event.create({ data: { at: 253402271999999 } });
      expect(maximum.at).toBe("9999-12-31 23:59:59.999");

      const fromString = await db.event.create({ data: { at: "9999-12-31 23:59:59.999" } });
      expect(fromString.at).toBe("9999-12-31 23:59:59.999");
    });

    test("timestamp rejects instants that leave the supported local/UTC range", async () => {
      for (const at of [-62135596800001, 253402272000000, 253402300799999, Number.MAX_SAFE_INTEGER + 1, NaN, new Date(NaN), "10000-01-01 00:00:00", "2026-02-30 00:00:00"]) {
        await expectOrmError(db.event.create({ data: { at } }), "VALIDATION");
      }
    });

    test("timestamp filters use the same numeric ordering", async () => {
      await db.event.createMany({
        data: [{ at: -1 }, { at: 0 }, { at: 1 }],
      });
      const rows = await db.event.findMany({
        where: { at: { lt: 0 } },
        orderBy: { at: "asc" },
        select: { at: true },
      });
      expect(rows).toEqual([{ at: "1970-01-01 07:59:59.999" }]);
    });

    test("nullable datetime and timestamp store omitted and explicit NULL", async () => {
      const omitted = await db.event.create({ data: {} });
      expect(omitted).toMatchObject({ at: null, text: null });
      const explicit = await db.event.create({ data: { at: null, text: null } });
      expect(explicit).toMatchObject({ at: null, text: null });
    });

    test("required fields reject NULL for both storage modes", async () => {
      await expectOrmError(db.required.create({ data: { at: null, ts: 0 } }), "VALIDATION");
      await expectOrmError(db.required.create({ data: { at: "2026-01-01 00:00:00", ts: null } }), "VALIDATION");
    });

    test("MySQL rejects local datetime years below 1000", async () => {
      if (mysqlFamily()) {
        await expectOrmError(db.required.create({ data: { at: "0999-12-31 23:59:59", ts: 0 } }), "VALIDATION");
      } else {
        const row = await db.required.create({ data: { at: "0999-12-31 23:59:59", ts: 0 } });
        expect(row.at).toBe("0999-12-31 23:59:59.000");
      }
    });
  });
});
