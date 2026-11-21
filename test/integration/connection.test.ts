import { expect, test } from "bun:test";
import { connectionURL } from "../../src/shared/index.js";
import { mysqlConnection } from "../../src/adapters/mysql/driver.js";
import { internalCreateClient, sql } from "../../src/index.js";
import { mysql } from "../../src/adapters/mysql/index.js";
import { postgres } from "../../src/adapters/postgres/index.js";
import { sqlite } from "../../src/adapters/sqlite/index.js";
import { createClient } from "../../src/core/client.js";
import { initialized, sandbox, targets } from "../helpers/databases.js";
import { parseSchema } from "../../src/schema/index.js";
const schema = parseSchema("model Item { id: int @id @auto }");
test("ORM connection URL parsing decodes credentials and converts query parameters", () => {
  expect(mysqlConnection("mysql://u:p%40ss@localhost:3307/app?allowPublicKeyRetrieval=true").options).toMatchObject({
    user: "u",
    password: "p@ss",
    port: 3307,
    database: "app",
    allowPublicKeyRetrieval: true,
  });
  expect(connectionURL("postgresql://localhost/app", ["postgresql:"]).protocol).toBe("postgresql:");
  expect(() => {
    return mysqlConnection("mysql://localhost/app?database=other");
  }).toThrow();
  expect(() => {
    return connectionURL({}, ["postgresql:"]);
  }).toThrow();
});
test("connection query parameters keep unsafe integers as strings to avoid precision loss", () => {
  expect(mysqlConnection("mysql://u:p@localhost/app?allowPublicKeyRetrieval=true&big=9007199254740993").options).toMatchObject({
    allowPublicKeyRetrieval: true,
    big: "9007199254740993",
  });
});
test("timezone keeps its sign whether or not the plus is percent-encoded", () => {
  const timezone = (connection: string) => {
    return mysqlConnection(connection).options.timezone;
  };
  expect(timezone("mysql://u:p@localhost/app?timezone=+08:00")).toBe("+08:00");
  expect(timezone("mysql://u:p@localhost/app?timezone=%2B08%3A00")).toBe("+08:00");
  expect(timezone("mysql://u:p@localhost/app?timezone=+0800")).toBe("+0800");
  expect(timezone("mysql://u:p@localhost/app?timezone=-05:00")).toBe("-05:00");
  expect(timezone("mysql://u:p@localhost/app?timezone=Asia/Shanghai")).toBe("Asia/Shanghai");
});
test("only the three documented URL families are accepted", async () => {
  const { adapterFor } = await import("../../src/adapters/registry.js");
  expect(adapterFor("postgresql://u:p@localhost:5432/app?schema=sample").name).toBe("postgres");
  expect(adapterFor("mysql://u:p@localhost:3306/app").name).toBe("mysql");
  expect(adapterFor("mariadb://u:p@localhost:3306/app").name).toBe("mysql");
  expect(adapterFor("file:./dev.db").name).toBe("sqlite");
  for (const url of ["postgres://u:p@localhost/app", "jdbc:postgresql://u:p@localhost/app", "./dev.db", "mongodb://localhost/app"]) {
    expect(() => {
      return adapterFor(url);
    }).toThrow("Use a file:, postgresql:// or mysql:// url");
  }
});
test("connection URL rejects invalid percent-encoding with a VALIDATION error", () => {
  for (const url of ["mysql://us%er:p@localhost/app", "mysql://u:p%w@localhost/app", "mysql://u:p@localhost/d%b"]) {
    expect(() => {
      return mysqlConnection(url);
    }).toThrow(expect.objectContaining({ code: "VALIDATION" }));
  }
});
test("server adapters reject connection objects before connecting", async () => {
  for (const factory of [mysql, postgres]) {
    await expect(
      Promise.resolve().then(() => {
        return factory({ connection: {} as any }).connect();
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  }
});
test("postgres reads the target schema from the URL", async () => {
  for (const schema of ["pg_catalog", "information_schema", ""]) {
    await expect(
      Promise.resolve().then(() => {
        return postgres({ connection: `postgresql://u:p@localhost/app?schema=${schema}` }).connect();
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  }
});
test("internalCreateClient builds the client from the connection URL", async () => {
  const db = internalCreateClient(schema, { connection: "file::memory:" });
  try {
    expect(await db.$executeRaw(sql`CREATE TABLE item (id INTEGER PRIMARY KEY)`)).toBe(0);
  } finally {
    await db.$close();
  }
});
test("internalCreateClient rejects a missing or unsupported connection URL synchronously", () => {
  const attempts = [() => internalCreateClient(schema, {} as any), () => internalCreateClient(schema, { connection: "" }), () => internalCreateClient(schema, { connection: "redis://localhost/app" })];
  for (const attempt of attempts) {
    expect(attempt).toThrow(expect.objectContaining({ code: "VALIDATION" }));
  }
});
test("server adapters reject invalid pool parameters before allocating pools", async () => {
  const attempts = [
    () => mysql({ connection: "mysql://u:p@localhost/app?connectionLimit=0" }).connect(),
    () => mysql({ connection: "mysql://u:p@localhost/app?connectionLimit=2&minimumIdle=3" }).connect(),
    () => postgres({ connection: "postgresql://u:p@localhost/app?max=0" }).connect(),
    () => postgres({ connection: "postgresql://u:p@localhost/app?connectionTimeoutMillis=0" }).connect(),
  ];
  for (const attempt of attempts) {
    await expect(Promise.resolve().then(attempt)).rejects.toMatchObject({ code: "VALIDATION" });
  }
});
test("SQLite accepts file URLs and rejects legacy filename options", async () => {
  for (const attempt of [() => sqlite({ filename: ":memory:" } as any).connect(), () => sqlite({ connection: {} as any }).connect()]) {
    await expect(Promise.resolve().then(attempt)).rejects.toMatchObject({ code: "VALIDATION" });
  }
  const runtime = await initialized(sqlite({ connection: "file::memory:" }), schema).connect();
  await runtime.close();
});
// 驱动选项由适配器固定：URL 里的 dateStrings=true 不会让日期字段变成纯文本，读写两端都是 Date。
for (const target of targets.filter((item) => {
  return item === "mysql" || item === "mariadb";
})) {
  test(`dateStrings in the connection URL does not affect datetime decoding [${target}]`, async () => {
    const box = await sandbox(target);
    const eventSchema = parseSchema("model Event { id: int @id @auto at: datetime }");
    const db: any = createClient(eventSchema, {
      adapter: initialized(mysql({ connection: box.url + "&dateStrings=true" }), eventSchema),
    });
    try {
      const at = new Date("2026-01-02T03:04:05.678Z");
      // create 在 MySQL 上通过回读返回值，写入后立即经过日期解码。
      const created = await db.event.create({ data: { at } });
      expect(created.at).toEqual(at);
      expect((await db.event.findFirstOrThrow()).at).toEqual(at);
    } finally {
      await db.$close();
      await box.dispose();
    }
  });
}
