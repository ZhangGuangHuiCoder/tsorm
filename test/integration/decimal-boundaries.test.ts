// 十进制与 bigint 在真实数据库上的边界：整数和补零、负零、精度、标度、NULL 与分组。
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "../../src/core/client.js";
import { parseSchema } from "../../src/schema/index.js";
import { eachDatabase } from "../helpers/client.js";
import { sandbox } from "../helpers/databases.js";

eachDatabase("decimal boundaries", (ctx) => {
  test("integer-valued decimal sums keep the declared scale", async () => {
    await ctx.db.product.createMany({
      data: [
        { sku: "sum-a", price: "2" },
        { sku: "sum-b", price: "0" },
        { sku: "sum-c", price: "1" },
      ],
    });
    const result = await ctx.db.product.aggregate({
      _sum: { price: true },
      _min: { price: true },
      _max: { price: true },
    });
    expect(result).toEqual({
      _sum: { price: "3.00" },
      _min: { price: "0.00" },
      _max: { price: "2.00" },
    });
  });

  test("zero and negative sums keep the sign and scale", async () => {
    await ctx.db.product.createMany({
      data: [
        { sku: "neg-a", price: "2" },
        { sku: "neg-b", price: "-2" },
        { sku: "neg-c", price: "1.25" },
        { sku: "neg-d", price: "-3.5" },
      ],
    });
    const all = await ctx.db.product.aggregate({ _sum: { price: true } });
    expect(all._sum.price).toBe("-2.25");

    const zero = await ctx.db.product.aggregate({
      where: { price: { in: ["2", "-2"] } },
      _sum: { price: true },
      _min: { price: true },
      _max: { price: true },
    });
    expect(zero).toEqual({
      _sum: { price: "0.00" },
      _min: { price: "-2.00" },
      _max: { price: "2.00" },
    });
  });

  test("empty sets return NULL rather than zero", async () => {
    const result = await ctx.db.product.aggregate({
      where: { sku: "missing" },
      _sum: { price: true },
      _avg: { price: true },
      _min: { price: true },
      _max: { price: true },
    });
    expect(result).toEqual({
      _sum: { price: null },
      _avg: { price: null },
      _min: { price: null },
      _max: { price: null },
    });
  });

  test("grouped decimal sums use the same scale and sign rules", async () => {
    await ctx.db.product.createMany({
      data: [
        { sku: "group-a", price: "2", active: true },
        { sku: "group-b", price: "0", active: true },
        { sku: "group-c", price: "1.25", active: false },
        { sku: "group-d", price: "-3.5", active: false },
      ],
    });
    const groups = await ctx.db.product.groupBy({
      by: ["active"],
      _sum: { price: true },
      orderBy: { active: "asc" },
    });
    expect(groups).toEqual([
      { active: false, _sum: { price: "-2.25" } },
      { active: true, _sum: { price: "2.00" } },
    ]);
  });

  test("column values are returned with the declared scale", async () => {
    const short = await ctx.db.product.create({ data: { sku: "scale-short", price: "2" } });
    const partial = await ctx.db.product.create({ data: { sku: "scale-partial", price: "1.2" } });
    expect(short.price).toBe("2.00");
    expect(partial.price).toBe("1.20");
    const rows = await ctx.db.product.findMany({
      where: { sku: { in: ["scale-short", "scale-partial"] } },
      orderBy: { sku: "asc" },
      select: { price: true },
    });
    expect(rows).toEqual([{ price: "1.20" }, { price: "2.00" }]);
  });

  test("bigint sums cross the safe integer boundary without losing digits", async () => {
    await ctx.db.product.createMany({
      data: [
        { sku: "big-a", price: "0", stock: "9007199254740991" },
        { sku: "big-b", price: "0", stock: "1" },
      ],
    });
    const result = await ctx.db.product.aggregate({
      _sum: { stock: true },
      _min: { stock: true },
      _max: { stock: true },
      _avg: { stock: true },
    });
    expect(result._sum.stock).toBe("9007199254740992");
    expect(result._min.stock).toBe("1");
    expect(result._max.stock).toBe("9007199254740991");
    expect(Number(result._avg.stock)).toBe(4503599627370496);
  });

  describe("scale 0 and scale 3", () => {
    let box: Awaited<ReturnType<typeof sandbox>>;
    let db: any;

    beforeAll(async () => {
      box = await sandbox(ctx.target);
      db = await createClient(
        parseSchema(`
model Measure {
  id: int @id @auto
  whole: decimal(10, 0)
  milli: decimal(10, 3)
}`),
        { adapter: box.adapter(), timezone: "+08:00" },
      );
    });

    afterAll(async () => {
      await db?.$close();
      await box?.dispose();
    });

    beforeEach(async () => {
      await db.$clear("measure", { force: true });
    });

    test("sums and extrema preserve scale 0 and scale 3", async () => {
      await db.measure.createMany({
        data: [
          { whole: "4", milli: "1" },
          { whole: "-1", milli: "2.5" },
        ],
      });

      const result = await db.measure.aggregate({
        _sum: { whole: true, milli: true },
        _min: { whole: true, milli: true },
        _max: { whole: true, milli: true },
        _avg: { whole: true, milli: true },
      });
      expect(result._sum).toEqual({ whole: "3", milli: "3.500" });
      expect(result._min).toEqual({ whole: "-1", milli: "1.000" });
      expect(result._max).toEqual({ whole: "4", milli: "2.500" });
      expect(Number(result._avg.whole)).toBe(1.5);
      expect(Number(result._avg.milli)).toBe(1.75);

      const rows = await db.measure.findMany({
        orderBy: { id: "asc" },
        select: { whole: true, milli: true },
      });
      expect(rows).toEqual([
        { whole: "4", milli: "1.000" },
        { whole: "-1", milli: "2.500" },
      ]);
    });
  });
});
