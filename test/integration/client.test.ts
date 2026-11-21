// 客户端：能力、事件日志、批量关系加载、时区、虚拟字段、全局 omit 和生命周期。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OrmError, type ClientEvent } from "../../src/index.js";
import { sandbox, targets, type Sandbox } from "../helpers/databases.js";
import { createClient, eachDatabase, expectOrmError, makeUser } from "../helpers/client.js";

eachDatabase("client basics", (ctx) => {
  // $capabilities 描述当前适配器能力
  test("$capabilities describes the adapter", () => {
    const caps = ctx.db.$capabilities;
    expect(caps.isolationLevels).toContain("serializable");
    expect(typeof caps.returning).toBe("boolean");
    expect(caps.returning).toBe(!(ctx.target === "mysql" || ctx.target === "mariadb"));
  });

  // logger 收到 query 和 transaction 事件
  test("logger receives query and transaction events", async () => {
    await makeUser(ctx.db);
    await ctx.db.user.findMany({ where: { name: "nobody" } });
    const queries = ctx.events.filter((e) => {
      return e.type === "query";
    });
    expect(queries.length).toBeGreaterThanOrEqual(2);
    for (const event of queries) {
      expect(event.status).toBe("success");
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
      expect(event.database).toBeString();
    }
    expect(
      ctx.queries().some((sql) => {
        return sql.startsWith("SELECT");
      }),
    ).toBeTrue();
    expect(
      ctx.events.some((e) => {
        return e.type === "transaction" && e.action === "commit";
      }),
    ).toBeTrue();
  });

  // 失败的查询事件带有映射后的错误
  test("logger receives failed queries with the mapped error", async () => {
    await makeUser(ctx.db, { email: "dup@x.com" });
    ctx.events.length = 0;
    await makeUser(ctx.db, { email: "dup@x.com" }).catch(() => {});
    const failed = ctx.events.find((e) => {
      return e.type === "query" && e.status === "error";
    });
    expect(failed).toBeDefined();
    expect((failed as any).error).toBeInstanceOf(OrmError);
    expect(
      ctx.events.some((e) => {
        return e.type === "transaction" && e.action === "rollback";
      }),
    ).toBeTrue();
  });

  // datetime 写入只接受 Date，读写两端都是 Date
  test("datetime writes require Date objects", async () => {
    const user = await makeUser(ctx.db);
    const post = await ctx.db.post.create({
      data: { title: "tz", authorId: user.id, createdAt: new Date("2026-11-02T07:30:00Z") },
    });
    expect(post.createdAt).toEqual(new Date("2026-11-02T07:30:00Z"));
    const local = await ctx.db.post.create({
      data: { title: "local", authorId: user.id, createdAt: new Date(2026, 1, 28, 23, 59, 59, 500) },
    });
    expect(local.createdAt).toEqual(new Date(2026, 1, 28, 23, 59, 59, 500));
    const found = await ctx.db.post.findMany({
      where: { createdAt: { gte: new Date("2026-11-02T07:00:00Z"), lt: new Date(2026, 10, 3) } },
    });
    expect(
      found.map((p) => {
        return p.title;
      }),
    ).toEqual(["tz"]);
  });
});

for (const target of targets) {
  describe(`client options [${target}]`, () => {
    let box: Sandbox;
    const clients: { $close(): Promise<void> }[] = [];
    const open = async (options: Record<string, unknown> = {}, initialize = true) => {
      const db = createClient({ adapter: box.adapter(initialize), ...options } as any);
      clients.push(db);
      return db;
    };

    beforeAll(async () => {
      box = await sandbox(target);
      const db = await open();
      // 客户端连接是懒的：先执行一次空事务，让适配器完成建表。
      await db.$transaction(async () => {});
    });
    afterAll(async () => {
      for (const db of clients) {
        await db.$close().catch(() => {});
      }
      await box.dispose();
    });

    // 虚拟字段由声明的依赖计算
    test("virtual fields are computed from declared dependencies", async () => {
      const base = createClient({ adapter: box.adapter(false) });
      const db = base.$extend({
        virtuals: {
          user: {
            label: {
              needs: { name: true, email: true },
              compute: (u) => {
                return u.name ?? u.email;
              },
            },
          },
        },
      });
      clients.push(base, db);
      await db.$clear("user", { force: true });
      await db.user.create({ data: { email: "v@x.com" } });
      await db.user.create({ data: { email: "w@x.com", name: "Named" } });
      const rows = await db.user.findMany({ orderBy: { email: "asc" } });
      expect(
        rows.map((r) => {
          return r.label;
        }),
      ).toEqual(["v@x.com", "Named"]);
      const selected = await db.user.findMany({
        select: { label: true },
        orderBy: { email: "asc" },
      });
      expect(selected).toEqual([{ label: "v@x.com" }, { label: "Named" }]);
      const omitted = await db.user.findFirstOrThrow({ omit: { label: true } });
      expect(omitted).not.toHaveProperty("label");
      await db.$clear("user", { force: true });
    });

    // 虚拟字段拒绝未知依赖和异步 compute
    test("virtual fields reject unknown dependencies and async compute", async () => {
      // $extend 的校验是同步抛错，与 createClient 的异步拒绝不同。
      const base = createClient({ adapter: box.adapter(false) });
      clients.push(base);
      expect(() => {
        return base.$extend({
          virtuals: {
            user: {
              bad: {
                needs: { nope: true } as any,
                compute: () => {
                  return 1;
                },
              },
            },
          },
        });
      }).toThrow();
      const db = base.$extend({
        virtuals: {
          user: {
            later: {
              needs: { email: true },
              compute: async () => {
                return 1;
              },
            },
          },
        },
      });
      clients.push(db);
      // create 返回完整记录，因此虚拟字段会立即计算，并在这里被拒绝。
      await expectOrmError(db.user.create({ data: { email: "async@x.com" } }), "VALIDATION");
      // 投影失败时，插入也一并回滚。
      expect(await db.user.count()).toBe(0);
    });

    // $extend 扩展客户端：叠加虚拟字段与 omit，原客户端不变，事务与连接共享
    test("$extend extends a client with layered virtuals and omit", async () => {
      const base = createClient({ adapter: box.adapter(false) });
      clients.push(base);
      await base.$clear("user", { force: true });
      await base.user.create({ data: { email: "ext@x.com" } });
      const extended = base.$extend({
        virtuals: {
          user: {
            label: {
              needs: { name: true, email: true },
              compute: (u) => {
                return u.name ?? u.email;
              },
            },
          },
        },
        omit: { user: { age: true } },
      });
      const rows = await extended.user.findMany();
      expect(rows[0].label).toBe("ext@x.com");
      expect(rows[0]).not.toHaveProperty("age");
      const plain = await base.user.findMany();
      expect(plain[0]).not.toHaveProperty("label");
      expect(plain[0].age).toBeNull();
      // 在扩展之上继续扩展，虚拟字段叠加（两层都可用）
      const twice = extended.$extend({
        virtuals: {
          user: {
            domain: {
              needs: { email: true },
              compute: (u) => {
                return String(u.email).split("@")[1];
              },
            },
          },
        },
      });
      const layered = (await twice.user.findMany({ select: { label: true, domain: true } }))[0];
      expect(layered.label).toBe("ext@x.com");
      expect(layered.domain).toBe("x.com");
      // 扩展后的客户端共享事务上下文：事务内的写入随回滚消失
      await expect(
        base.$transaction(async () => {
          await extended.user.create({ data: { email: "in-tx@x.com" } });
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await extended.user.findMany({ where: { email: "in-tx@x.com" } })).toEqual([]);
    });

    // 连续 $extend 的 omit 叠加而不是替换：后一次扩展保留前一次的字段
    test("$extend layers omit entries across extensions", async () => {
      const base = createClient({ adapter: box.adapter(false) });
      clients.push(base);
      await base.$clear("user", { force: true });
      await base.user.create({ data: { email: "layer@x.com", name: "L", age: 3 } });
      const first = base.$extend({ omit: { user: { email: true } } });
      const second = first.$extend({ omit: { user: { age: true } } });
      clients.push(first, second);
      const row = await second.user.findFirstOrThrow();
      expect(row).not.toHaveProperty("email");
      expect(row).not.toHaveProperty("age");
      expect(row.name).toBe("L");
      // 同一字段再次出现时以最后一次为准
      const third = second.$extend({ omit: { user: { email: false } } });
      clients.push(third);
      expect((await third.user.findFirstOrThrow()).email).toBe("layer@x.com");
    });

    // $extend 的客户端共享连接生命周期：任一 $close 都会关闭全部
    test("$extend clients share the connection lifecycle", async () => {
      const base = createClient({ adapter: box.adapter(false) });
      const extended = base.$extend({});
      clients.push(base, extended);
      await extended.$close();
      await expect(base.user.findMany()).rejects.toThrow();
      await expect(extended.user.findMany()).rejects.toThrow();
    });

    // 全局 omit 默认隐藏字段，查询可显式取回
    test("global omit hides fields unless a query asks for them", async () => {
      const db = createClient({ adapter: box.adapter(false) }).$extend({
        omit: { user: { email: true } },
      });
      clients.push(db);
      const user = await db.user.create({ data: { email: "hidden@x.com", name: "H" } });
      expect(user).not.toHaveProperty("email");
      const found = await db.user.findUniqueOrThrow({ where: { email: "hidden@x.com" } });
      expect(found).not.toHaveProperty("email");
      const back = await db.user.findUniqueOrThrow({
        where: { id: user.id },
        omit: { email: false },
      });
      expect(back.email).toBe("hidden@x.com");
      const selected = await db.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { email: true },
      });
      expect(selected.email).toBe("hidden@x.com");
      await db.$clear("user", { force: true });
    });

    // logger 抛错不影响查询
    test("a throwing logger never breaks queries", async () => {
      const db = createClient({
        adapter: box.adapter(false),
        logger: () => {
          throw new Error("logger failure");
        },
      });
      clients.push(db);
      expect(await db.user.count()).toBe(0);
    });

    // 客户端生命周期事件：首次操作时 connect，$close 时 close
    test("client lifecycle events", async () => {
      const events: ClientEvent[] = [];
      const db = createClient({
        adapter: box.adapter(false),
        logger: (e) => {
          return void events.push(e);
        },
      });
      await db.user.count();
      await db.$close();
      expect(
        events
          .filter((e) => {
            return e.type === "client";
          })
          .map((e: any) => {
            return e.action;
          }),
      ).toEqual(["connect", "close"]);
    });

    // 创建客户端不连接；未使用时关闭也不会建立连接
    test("creating a client defers the connection until first use", async () => {
      const events: ClientEvent[] = [];
      const base = box.adapter(false);
      let connects = 0;
      const db = createClient({
        adapter: {
          ...base,
          connect: () => {
            connects++;
            return base.connect();
          },
        },
        logger: (e) => {
          return void events.push(e);
        },
      });
      expect(connects).toBe(0);
      await db.$close();
      expect(connects).toBe(0);
      expect(events).toEqual([]);
    });

    // 并发的首次操作共用同一次连接
    test("concurrent first operations share one connection", async () => {
      const base = box.adapter(false);
      let connects = 0;
      const db = createClient({
        adapter: {
          ...base,
          connect: () => {
            connects++;
            return base.connect();
          },
        },
      });
      await Promise.all([db.user.count(), db.user.count(), db.user.count()]);
      expect(connects).toBe(1);
      await db.$close();
    });

    // $close 之后的调用抛出 CLIENT_CLOSED
    test("calls after $close raise CLIENT_CLOSED", async () => {
      const db = createClient({ adapter: box.adapter(false) });
      await db.$close();
      await expectOrmError(db.user.count(), "CLIENT_CLOSED");
    });

    // $close 会等待进行中的操作完成
    test("$close waits for in-flight operations", async () => {
      const db = createClient({ adapter: box.adapter(false) });
      const pending = db.user.count();
      await db.$close();
      expect(await pending).toBe(0);
    });

    // maxAffected 阻止命中行数超过上限的批量写，$clear 不受限制
    test("maxAffected blocks writes above the row limit", async () => {
      expect(() => {
        return createClient({ adapter: box.adapter(false), maxAffected: 0 });
      }).toThrow("maxAffected requires a positive integer");
      const db = await open({ maxAffected: 1 }, false);
      await db.user.createMany({ data: [{ email: "limit-1@x.com" }, { email: "limit-2@x.com" }] });
      const where = { email: { startsWith: "limit-" } };
      const error = await expectOrmError(db.user.updateMany({ where, data: { age: 1 } }), "MASS_WRITE_BLOCKED");
      expect(error.message).toBe("updateMany on User matched 2 rows, above maxAffected 1");
      await expectOrmError(db.user.updateManyAndReturn({ where, data: { age: 2 } }), "MASS_WRITE_BLOCKED");
      await expectOrmError(db.user.deleteMany({ where }), "MASS_WRITE_BLOCKED");
      // 命中行数在限额内时照常执行
      expect(await db.user.updateMany({ where: { email: "limit-1@x.com" }, data: { age: 3 } })).toEqual({ count: 1 });
      // $clear 本身就是显式清空，不受 maxAffected 约束
      expect((await db.$clear("user", { force: true })).count).toBeGreaterThanOrEqual(2);
      expect(await db.user.count()).toBe(0);
    });
  });
}
