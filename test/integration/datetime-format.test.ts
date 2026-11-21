import { expect, test } from "bun:test";
import { createClient } from "../../src/core/client.js";
import { sqlite } from "../../src/adapters/sqlite/index.js";
import { initialized } from "../helpers/databases.js";
import { parseSchema } from "../../src/schema/index.js";

for (const dateStorage of ["string", "timestamp"] as const) {
  test(`${dateStorage} datetime keys retain relation loading and cursor/filter round trips`, async () => {
    const schema = parseSchema(`model Parent { id: ${dateStorage === "timestamp" ? "timestamp" : "datetime"} @id children: Child[] @via(parent) } model Child { id: int @id @auto parent: Parent }`);
    const db: any = createClient(schema, {
      adapter: initialized(sqlite(), schema),
    });
    try {
      const instant = new Date("2026-01-01T01:30:00.000Z");
      const row = await db.parent.create({
        data: { id: instant, children: { create: {} } },
        include: { children: true },
      });
      expect(row.id).toEqual(instant);
      expect(row.children).toHaveLength(1);
      expect((await db.$queryRaw`SELECT typeof(id) AS storage FROM Parent`)[0].storage).toBe(dateStorage === "timestamp" ? "integer" : "text");
      expect((await db.parent.findUnique({ where: { id: instant } })).id).toEqual(row.id);
      expect((await db.parent.findMany({ cursor: { id: row.id }, include: { children: true } }))[0].children).toHaveLength(1);
      expect((await db.child.findFirst({ include: { parent: true } })).parent.id).toEqual(row.id);
      expect((await db.parent.aggregate({ _min: { id: true } }))._min.id).toEqual(row.id);
      expect((await db.parent.groupBy({ by: ["id"], _count: true }))[0].id).toEqual(row.id);
    } finally {
      await db.$close();
    }
  });
}

test("datetime storage rejects unsupported @storage declarations", () => {
  expect(() => {
    return parseSchema("model Item { id: int @id @storage(timestamp) }");
  }).toThrow();
  expect(() => {
    return parseSchema("model Item { id: int @id at: datetime @storage(seconds) }");
  }).toThrow();
});
