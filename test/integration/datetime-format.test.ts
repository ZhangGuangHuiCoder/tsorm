import { expect, test } from "bun:test";
import { createClient } from "../../src/core/client.js";
import { sqlite } from "../../src/adapters/sqlite/index.js";
import { parseSchema } from "../../src/schema/index.js";

for (const dateStorage of ["string", "timestamp"] as const) {
  for (const datetimeFormat of ["local", "utc"] as const) {
    test(`${dateStorage}/${datetimeFormat} datetime keys retain relation loading and cursor/filter round trips`, async () => {
      const schema = parseSchema(`model Parent { id: ${dateStorage === "timestamp" ? "timestamp" : "datetime"} @id children: Child[] @via(parent) } model Child { id: int @id @auto parent: Parent }`);
      const db: any = await createClient(schema, {
        adapter: sqlite({ initialize: true }),
        timezone: "+08:00",
        datetimeFormat,
      });
      try {
        const row = await db.parent.create({
          data: { id: "2026-01-01 01:30:00", children: { create: {} } },
          include: { children: true },
        });
        expect(row.id).toBe(datetimeFormat === "utc" ? "2025-12-31T17:30:00.000Z" : "2026-01-01 01:30:00.000");
        expect(row.children).toHaveLength(1);
        expect((await db.$queryRaw`SELECT typeof(id) AS storage FROM Parent`)[0].storage).toBe(dateStorage === "timestamp" ? "integer" : "text");
        expect((await db.parent.findUnique({ where: { id: 1767202200000 } })).id).toBe(row.id);
        expect((await db.parent.findMany({ cursor: { id: row.id }, include: { children: true } }))[0].children).toHaveLength(1);
        expect((await db.child.findFirst({ include: { parent: true } })).parent.id).toBe(row.id);
        expect((await db.parent.aggregate({ _min: { id: true } }))._min.id).toBe(row.id);
        expect((await db.parent.groupBy({ by: ["id"], _count: true }))[0].id).toBe(row.id);
      } finally {
        await db.$close();
      }
    });
  }
}

test("datetime format is validated before adapter connection", async () => {
  let connected = false;
  await expect(
    createClient(parseSchema("model Item { id: int @id }"), {
      adapter: {
        name: "fake",
        connect() {
          connected = true;
          throw Error("unexpected connection");
        },
      },
      datetimeFormat: "invalid" as any,
    }),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  expect(connected).toBe(false);
});

test("datetime storage rejects unsupported @storage declarations", () => {
  expect(() => {
    return parseSchema("model Item { id: int @id @storage(timestamp) }");
  }).toThrow();
  expect(() => {
    return parseSchema("model Item { id: int @id at: datetime @storage(seconds) }");
  }).toThrow();
});
