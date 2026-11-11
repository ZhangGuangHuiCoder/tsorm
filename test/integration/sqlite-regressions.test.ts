// SQLite 范围的回归用例：事务生命周期、复合主键、迁移数据源，以及历次审查发现的跨模块缺口。
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "../../src/index.js";
import { parseSchema, generateClient } from "../../src/schema/index.js";
import { sqlite } from "../../src/adapters/sqlite/index.js";
import { providerFor } from "../../src/adapters/providers.js";
import { postgresProvider } from "../../src/adapters/postgres/migration.js";
import { modified } from "../../src/migrations/history.js";
import { observeAdapter } from "../../src/core/events.js";
import { migrate, push } from "../../src/migrations/index.js";
import type { Adapter } from "../../src/core/adapter.js";

const empty = parseSchema("model Item {\n id: int @id @auto\n value: string\n}");
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("transaction lifecycle regressions", () => {
  test("logging preserves optional cancellation and its session receiver", async () => {
    const base = await sqlite().connect(empty);
    let cancelled = 0;
    const sessionWithCancel = {
      ...(await base.acquire()),
      async cancel() {
        expect(this).toBe(sessionWithCancel);
        cancelled++;
      },
    };
    const adapter: Adapter = {
      name: "sqlite",
      connect: () => {
        return {
          ...base,
          acquire: async () => {
            return sessionWithCancel;
          },
        };
      },
    };
    try {
      const observed = await observeAdapter(adapter, empty, () => {});
      const session = await observed.acquire();
      expect(typeof session.cancel).toBe("function");
      await session.cancel!();
      expect(cancelled).toBe(1);
      await session.release();
    } finally {
      await base.close();
    }
  });

  test("a logged transaction cancels an in-flight statement on timeout", async () => {
    const base = await sqlite().connect(empty);
    const finish = deferred();
    let cancelled = 0;
    const db = await createClient(empty, {
      logger: () => {},
      adapter: {
        name: "sqlite",
        connect: () => {
          return {
            ...base,
            async acquire() {
              const session = await base.acquire();
              return {
                ...session,
                async execute() {
                  await finish.promise;
                  return { rows: [], affectedRows: 0 };
                },
                async cancel() {
                  cancelled++;
                  finish.resolve();
                },
              };
            },
          };
        },
      },
    });
    const transaction = db.$transaction(
      async (tx) => {
        return tx.$executeRaw`SELECT 1`;
      },
      { timeout: 20 },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const error = await Promise.race([
      transaction.catch((error) => {
        return error;
      }),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          return resolve(null);
        }, 500);
      }),
    ]);
    if (timer) {
      clearTimeout(timer);
    }
    const cancelCount = cancelled;
    finish.resolve();
    await transaction.catch(() => {});
    await db.$close();
    expect(cancelCount).toBe(1);
    expect(error).toMatchObject({ code: "TRANSACTION_TIMEOUT" });
  });

  test("concurrent close calls through extended clients await the same shutdown", async () => {
    const base = await sqlite().connect(empty);
    const started = deferred();
    const finish = deferred();
    let closes = 0;
    const db = await createClient(empty, {
      adapter: {
        name: "sqlite",
        connect: () => {
          return {
            ...base,
            async close() {
              closes++;
              started.resolve();
              await finish.promise;
              await base.close();
            },
          };
        },
      },
    });
    const first = db.$close();
    await started.promise;
    let completed = false;
    const second = db
      .$extend()
      .$close()
      .then(() => {
        completed = true;
      });
    await Promise.resolve();
    await Promise.resolve();
    const premature = completed;
    finish.resolve();
    await Promise.all([first, second]);
    expect(premature).toBe(false);
    expect(closes).toBe(1);
  });

  test("concurrent close callers observe the same shutdown error", async () => {
    const base = await sqlite().connect(empty);
    const finish = deferred();
    const failure = new Error("close failed");
    const db = await createClient(empty, {
      adapter: {
        name: "sqlite",
        connect: () => {
          return {
            ...base,
            async close() {
              await finish.promise;
              await base.close();
              throw failure;
            },
          };
        },
      },
    });
    const results = Promise.allSettled([db.$close(), db.$extend().$close()]);
    finish.resolve();
    expect(
      (await results).map((result) => {
        return result.status;
      }),
    ).toEqual(["rejected", "rejected"]);
  });
});

describe("composite primary key regressions", () => {
  const schema = parseSchema("model Member {\n team: string\n email: string\n level: int = 1\n @@id(team, email)\n}");
  test("generated update types exclude every primary key component", () => {
    const source = generateClient(schema);
    const update = source.split("export type MemberScalarUpdate = ")[1].split("\n")[0];
    expect(update).not.toContain('"team"');
    expect(update).not.toContain('"email"');
    expect(update).toContain('"level"');
  });
  test("relations bound to primary key components are excluded from update input", () => {
    const linked = parseSchema("model Team {\n id: int @id @auto\n}\nmodel Member {\n team: Team\n email: string\n level: int = 1\n @@id(team, email)\n}");
    const update = generateClient(linked).split("export type MemberUpdate = ")[1].split("\n")[0];
    expect(update).not.toContain('"team"');
  });
  test("single and bulk updates reject primary key changes and retain data", async () => {
    const db = await createClient(schema, { adapter: sqlite({ initialize: true }) });
    try {
      const where = { team: "core", email: "a@example.com" };
      await db.member.create({ data: where });
      await expect(db.member.update({ where, data: { team: "other" } })).rejects.toMatchObject({
        code: "VALIDATION",
      });
      await expect(db.member.updateMany({ where: { team: "core" }, data: { email: "b@example.com" } })).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await db.member.findUnique({ where })).toMatchObject({ ...where, level: 1 });
    } finally {
      await db.$close();
    }
  });
});

describe("migration datasource regressions", () => {
  test.each([
    ["mysql://u:p@localhost/app", "mysql://other:secret@localhost:3306/app?connectTimeout=1000"],
    ["postgres://u:p@localhost/app", "postgresql://other:secret@localhost:5432/app?schema=public"],
    ["mysql://u:p@localhost/app", "mysql://u:p@127.0.0.1/app"],
    ["postgres://u:p@localhost/app", "postgresql://u:p@127.0.0.1/app"],
  ])("rejects equivalent target and shadow URLs: %s", async (url, shadowUrl) => {
    const provider = await providerFor(url);
    await expect(provider.createScratch(provider.parseDatasource(url, "."), provider.parseDatasource(shadowUrl, "."))).rejects.toMatchObject({ code: "INVALID_URL" });
  });

  test.each(["migrate", "push"])("%s closes the main connection when scratch creation fails", async (command) => {
    const dir = mkdtempSync(join(tmpdir(), "tsorm-cleanup-"));
    const provider = await providerFor("file:./test.db");
    const originalScratch = provider.createScratch;
    const originalConnect = provider.connectOrCreate;
    let closed = 0;
    provider.connectOrCreate = async (ds) => {
      const result = await originalConnect(ds);
      const close = result.conn.close.bind(result.conn);
      result.conn.close = async () => {
        closed++;
        await close();
      };
      return result;
    };
    provider.createScratch = async () => {
      throw new Error("scratch creation failed");
    };
    try {
      writeFileSync(join(dir, "schema.orm"), "model Item {\n id: int @id @auto\n}");
      await expect((command === "migrate" ? migrate : push)({ cwd: dir, url: "file:./test.db" })).rejects.toThrow("scratch creation failed");
      expect(closed).toBe(1);
    } finally {
      provider.createScratch = originalScratch;
      provider.connectOrCreate = originalConnect;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// 以下用例来自历次全量审查，同样只依赖 SQLite。
test("decimal foreign keys preserve precision and reject incompatible explicit columns", () => {
  const schema = parseSchema("model Parent { id: decimal(5, 2) @id } model Child { id: int @id parent: Parent }");
  expect(schema.tables.Child.columns.parentId.precision).toBe(5);
  expect(schema.tables.Child.columns.parentId.scale).toBe(2);
  expect(() => {
    return parseSchema("model Parent { id: decimal(5, 2) @id } model Child { id: int @id parentId: decimal(7, 3) parent: Parent @relation(field: parentId) }");
  }).toThrow();
});

test("migration checksums accept LF and legacy CRLF in either direction", () => {
  for (const [stored, local] of [
    ["SELECT 1;\r\nSELECT 2;\r\n", "SELECT 1;\nSELECT 2;\n"],
    ["SELECT 1;\n", "SELECT 1;\r\n"],
  ]) {
    const hash = (s: string) => {
      return createHash("sha256").update(s).digest("hex");
    };
    expect(modified({ checksum: hash(stored) } as any, { sql: local } as any)).toBe(false);
    expect(modified({ checksum: hash(stored) } as any, { sql: local + "SELECT 3;" } as any)).toBe(true);
  }
});

for (const namespace of ["", "pg_catalog", "information_schema", "a".repeat(64), "中".repeat(22), "bad\0name"]) {
  test(`migration rejects invalid PostgreSQL namespace ${JSON.stringify(namespace)}`, () => {
    expect(() => {
      return postgresProvider.parseDatasource("postgresql://localhost/app?schema=" + encodeURIComponent(namespace), ".");
    }).toThrow();
  });
}

test("timeout cancellation remains armed while queued statements drain", async () => {
  const schema = parseSchema("model Item { id: int @id @auto }");
  const base = await sqlite().connect(schema);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let cancelled = 0;
  const db: any = await createClient(schema, {
    adapter: {
      name: "sqlite",
      connect: () => {
        return {
          ...base,
          async acquire() {
            const session = await base.acquire();
            return {
              ...session,
              async execute() {
                await pending;
                return { rows: [], affectedRows: 0 };
              },
              async cancel() {
                cancelled++;
                finish();
              },
            };
          },
        };
      },
    },
  });
  const fallback = setTimeout(finish, 150);
  try {
    await expect(
      db.$transaction(
        async (tx: any) => {
          void tx.$executeRaw`SELECT 1`.catch(() => {});
        },
        { timeout: 20 },
      ),
    ).rejects.toMatchObject({ code: "TRANSACTION_TIMEOUT" });
    expect(cancelled).toBe(1);
  } finally {
    clearTimeout(fallback);
    finish();
    await db.$close();
  }
});

for (const name of ["Partial", "Pick", "Omit", "Required", "Exclude", "PropertyKey", "Uint8Array"]) {
  test(`JSON type ${name} cannot shadow generated client dependencies`, () => {
    expect(() => {
      return parseSchema(`type ${name} = string model Item { id: int @id }`);
    }).toThrow();
  });
}

test("model names cannot produce duplicate generated aliases", () => {
  expect(() => {
    return parseSchema("model Item { id: int @id } model ItemScalar { id: int @id }");
  }).toThrow();
});
