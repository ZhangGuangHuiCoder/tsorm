import { expect, test } from "bun:test";
import { mysqlConnection, connectionURL } from "../../src/shared/connection.js";
import { mysql } from "../../src/adapters/mysql/index.js";
import { postgres } from "../../src/adapters/postgres/index.js";
import { sqlite } from "../../src/adapters/sqlite/index.js";
import { parseSchema } from "../../src/schema/index.js";
const schema = parseSchema("model Item { id: int @id @auto }");
test("ORM connection URL parsing decodes credentials and converts query parameters", () => {
  expect(mysqlConnection("mysql://u:p%40ss@localhost:3307/app?connectionLimit=5&allowPublicKeyRetrieval=true")).toMatchObject({
    user: "u",
    password: "p@ss",
    port: 3307,
    database: "app",
    connectionLimit: 5,
    allowPublicKeyRetrieval: true,
  });
  expect(() => {
    return mysqlConnection("mysql://localhost/app?database=other");
  }).toThrow();
  expect(() => {
    return connectionURL({}, ["postgresql:"]);
  }).toThrow();
});
test("server adapters reject connection objects before connecting", async () => {
  for (const factory of [mysql, postgres]) {
    await expect(
      Promise.resolve().then(() => {
        return factory({ connection: {} as any }).connect(schema);
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  }
});
test("SQLite accepts file URLs and rejects legacy filename options", async () => {
  expect(() => {
    return sqlite({ filename: ":memory:" } as any).connect(schema);
  }).toThrow();
  expect(() => {
    return sqlite({ connection: {} as any }).connect(schema);
  }).toThrow();
  const runtime = await sqlite({ connection: "file::memory:", initialize: true }).connect(schema);
  await runtime.close();
});
