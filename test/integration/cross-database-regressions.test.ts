// 在所有数据库上运行的回归用例：嵌套事务语义、嵌套 upsert、特殊主键类型，以及历次审查发现的跨模块缺口。
import { expect, test } from "bun:test";
import { createClient } from "../../src/core/client.js";
import { parseSchema } from "../../src/schema/index.js";
import { eachDatabase } from "../helpers/client.js";
import { targets, sandbox } from "../helpers/databases.js";

for (const target of targets) {
  test(`${target}: caught falsy nested transaction errors cannot commit`, async () => {
    const box = await sandbox(target);
    const db: any = await createClient(parseSchema("model Item { id: int @id @auto }"), {
      adapter: box.adapter(),
    });
    try {
      for (const thrown of [undefined, null, false, 0, ""]) {
        await expect(
          db.$transaction(async (tx: any) => {
            await tx.item.create({ data: {} });
            await db
              .$transaction(async () => {
                throw thrown;
              })
              .catch(() => {});
          }),
        ).rejects.toMatchObject({ code: "TRANSACTION_ABORTED" });
        expect(await db.item.count()).toBe(0);
      }
    } finally {
      await db.$close();
      await box.dispose();
    }
  });

  test(`${target}: nested upsert arrays use current membership`, async () => {
    const box = await sandbox(target);
    const schema = parseSchema("model Parent { id: int @id @auto children: Child[] @via(parent) } model Child { id: int @id @auto code: string(30) @unique value: int parent: Parent }");
    const db: any = await createClient(schema, { adapter: box.adapter() });
    try {
      const parent = await db.parent.create({ data: {} });
      await db.parent.update({
        where: { id: parent.id },
        data: {
          children: {
            upsert: [
              { where: { code: "a" }, create: { code: "a", value: 1 }, update: { value: 1 } },
              { where: { code: "a" }, create: { code: "a", value: 2 }, update: { value: 2 } },
            ],
          },
        },
      });
      expect(await db.child.count()).toBe(1);
      expect((await db.child.findFirst()).value).toBe(2);
    } finally {
      await db.$close();
      await box.dispose();
    }
  });

  for (const [type, id] of [
    ["decimal(5, 2)", "1.20"],
    ["boolean", true],
  ] as const) {
    test(`${target}: ${type} keys support includes, counts and nested bulk writes`, async () => {
      const box = await sandbox(target);
      const schema = parseSchema(`model Parent { id: ${type} @id children: Child[] @via(parent) } model Child { id: int @id @auto value: int = 0 parent: Parent }`);
      const base: any = await createClient(schema, { adapter: box.adapter() });
      const db = base.$extend({ omit: { child: { id: true } } });
      try {
        await db.parent.create({ data: { id, children: { create: [{}, {}] } } });
        const row = await db.parent.findUnique({
          where: { id },
          include: { children: true, _count: true },
        });
        expect(row.children.length).toBe(2);
        expect(row._count.children).toBe(2);
        expect((await db.child.findFirst({ include: { parent: true } })).parent.id).toBe(id);
        await db.parent.update({
          where: { id },
          data: { children: { updateMany: { data: { value: 2 } } } },
        });
        expect(await base.child.count({ where: { value: 2 } })).toBe(2);
        await db.parent.update({ where: { id }, data: { children: { deleteMany: {} } } });
        expect(await base.child.count()).toBe(0);
      } finally {
        await base.$close();
        await box.dispose();
      }
    });
  }
}

eachDatabase("review regressions", (ctx) => {
  test("decimal aggregate HAVING supports a sum wider than its source column", async () => {
    await ctx.db.product.createMany({
      data: [
        { sku: "review-a", price: "90000000.00" },
        { sku: "review-b", price: "90000000.00" },
      ],
    });
    const rows = await ctx.db.product.groupBy({
      by: ["active"],
      _sum: { price: true },
      _avg: { price: true },
      having: { price: { _sum: { gt: "100000000.00" }, _avg: { gt: "80000000.00" } } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]._sum.price).toBe("180000000.00");
    expect(typeof rows[0]._avg.price).toBe("string");
    expect(Number(rows[0]._avg.price)).toBe(90000000);
  });

  if (ctx.target === "mysql") {
    test("MySQL reads generated bigint identities without rounding in single and bulk writes", async () => {
      const box = await sandbox("mysql");
      const schema = parseSchema("model Identity { id: bigint @id @auto label: string }");
      const db = await createClient(schema, { adapter: box.adapter() });
      try {
        await db.$executeRaw`INSERT INTO \`Identity\` (\`id\`, \`label\`) VALUES (${9007199254740993n}, ${"seed"})`;
        expect((await db.identity.create({ data: { label: "single" } })).id).toBe("9007199254740994");
        expect((await db.identity.createManyAndReturn({ data: [{ label: "bulk" }] }))[0].id).toBe("9007199254740995");
      } finally {
        await db.$close();
        await box.dispose();
      }
    });
  }
});
