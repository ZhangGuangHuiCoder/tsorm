// 事务：提交与回滚、自动加入事务、失败语义、嵌套、超时和隔离级别。
import { expect, test } from "bun:test";
import { OrmError } from "../../src/index.js";
import { eachDatabase, expectOrmError, makeUser } from "../helpers/client.js";

eachDatabase("transactions", (ctx) => {
  // 回调正常返回时提交，并透传返回值
  test("commits when the callback returns and passes its result through", async () => {
    const result = await ctx.db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: "tx@x.com" } });
      await tx.post.create({ data: { title: "in tx", authorId: user.id } });
      return user.id;
    });
    expect(result).toBeNumber();
    expect(await ctx.db.post.count({ where: { authorId: result } })).toBe(1);
  });

  // 回调抛错时回滚，并原样抛出该错误
  test("rolls back when the callback throws and preserves the error", async () => {
    const boom = new Error("boom");
    const caught = await ctx.db
      .$transaction(async (tx) => {
        await tx.user.create({ data: { email: "gone@x.com" } });
        throw boom;
      })
      .catch((e) => {
        return e;
      });
    expect(caught).toBe(boom);
    expect(await ctx.db.user.count()).toBe(0);
  });

  // 回调内直接使用根客户端也会加入当前事务
  test("root client calls inside the callback join the transaction", async () => {
    await ctx.db
      .$transaction(async () => {
        await ctx.db.user.create({ data: { email: "als@x.com" } });
        expect(await ctx.db.user.count()).toBe(1);
        throw new Error("rollback");
      })
      .catch(() => {});
    expect(await ctx.db.user.count()).toBe(0);
  });

  // 事务内的读取能看到本事务未提交的写入
  test("reads inside a transaction see its own uncommitted writes", async () => {
    await ctx.db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: "see@x.com", name: "v1" } });
      await tx.user.update({ where: { id: user.id }, data: { name: "v2" } });
      expect((await tx.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe("v2");
    });
  });

  // 语句失败后即使捕获错误，事务也只能回滚
  test("a failed statement aborts the transaction even if the error is caught", async () => {
    await makeUser(ctx.db, { email: "dup@x.com" });
    const error = await ctx.db
      .$transaction(async (tx) => {
        await tx.user.create({ data: { email: "first@x.com" } });
        await tx.user.create({ data: { email: "dup@x.com" } }).catch(() => {});
        await tx.user.create({ data: { email: "after@x.com" } });
      })
      .catch((e) => {
        return e;
      });
    expect(error).toBeInstanceOf(OrmError);
    expect(error.code).toBe("TRANSACTION_ABORTED");
    expect(await ctx.db.user.count()).toBe(1);
  });

  // 事务结束后继续使用 tx 抛出 TRANSACTION_CLOSED
  test("using tx after the transaction ends raises TRANSACTION_CLOSED", async () => {
    let leaked: any;
    await ctx.db.$transaction(async (tx) => {
      leaked = tx;
    });
    await expectOrmError(leaked.user.count(), "TRANSACTION_CLOSED");
  });

  // 嵌套 $transaction 加入外层事务
  test("nested $transaction joins the outer transaction", async () => {
    await ctx.db
      .$transaction(async (tx) => {
        await tx.user.create({ data: { email: "outer@x.com" } });
        await ctx.db.$transaction(async (inner) => {
          await inner.user.create({ data: { email: "inner@x.com" } });
        });
        throw new Error("rollback both");
      })
      .catch(() => {});
    expect(await ctx.db.user.count()).toBe(0);
  });

  // 嵌套事务不能设置 timeout / maxWait
  test("nested transactions cannot set timing options", async () => {
    const error = await ctx.db
      .$transaction(async () => {
        await ctx.db.$transaction(async () => {}, { timeout: 1000 });
      })
      .catch((e) => {
        return e;
      });
    expect(error.code).toBe("TRANSACTION_OPTIONS");
  });

  // 同一事务内的并发操作串行执行
  test("concurrent operations inside one transaction run serially", async () => {
    await ctx.db.$transaction(async (tx) => {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => {
          return tx.user.create({ data: { email: `c${i}@x.com` } });
        }),
      );
    });
    expect(await ctx.db.user.count()).toBe(10);
  });

  // 超过 timeout 的事务被回滚
  test("timeout rolls back a long transaction", async () => {
    const error = await ctx.db
      .$transaction(
        async (tx) => {
          await tx.user.create({ data: { email: "slow@x.com" } });
          await Bun.sleep(300);
          await tx.user.count();
        },
        { timeout: 100 },
      )
      .catch((e) => {
        return e;
      });
    expect(error).toBeInstanceOf(OrmError);
    expect(error.code).toBe("TRANSACTION_TIMEOUT");
    expect(await ctx.db.user.count()).toBe(0);
  });

  // 隔离级别遵循适配器能力，不支持时抛出 UNSUPPORTED_CAPABILITY
  test("isolation levels follow the adapter capabilities", async () => {
    const levels = ctx.db.$capabilities.isolationLevels;
    for (const level of ["read committed", "repeatable read", "serializable"] as const) {
      const run = ctx.db.$transaction(
        async (tx) => {
          return tx.user.count();
        },
        { isolationLevel: level },
      );
      if (levels.includes(level)) {
        expect(await run).toBe(0);
      } else {
        await expectOrmError(run, "UNSUPPORTED_CAPABILITY");
      }
    }
    if (ctx.target === "sqlite") {
      expect(levels).toEqual(["serializable"]);
    }
  });

  // 事务内的 findManyAndCount 需要快照级别的隔离
  test("findManyAndCount requires a snapshot isolation level inside a transaction", async () => {
    await makeUser(ctx.db);
    const ok = await ctx.db.$transaction(
      async (tx) => {
        return tx.user.findManyAndCount({});
      },
      {
        isolationLevel: "serializable",
      },
    );
    expect(ok.total).toBe(1);
    if (ctx.target === "postgres") {
      await expectOrmError(
        ctx.db.$transaction(async (tx) => {
          return tx.user.findManyAndCount({});
        }),
        "TRANSACTION_ISOLATION",
      );
    }
  });

  // 原生 SQL 也参与事务
  test("raw queries participate in the transaction", async () => {
    const user = await makeUser(ctx.db, { name: "raw" });
    const table = ctx.target === "mysql" || ctx.target === "mariadb" ? "`app_User`" : '"app_User"';
    const caught = await ctx.db
      .$transaction(async (tx) => {
        await tx.$executeRaw`DELETE FROM ${rawIdent(table)} WHERE id = ${user.id}`;
        expect(await tx.user.count()).toBe(0);
        throw new Error("undo");
      })
      .catch((e) => {
        return e;
      });
    // 回滚必须由主动抛出的 undo 触发，而非 SQL 失败（否则表名错误时用例会在吞错后空转通过）
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).toBe("undo");
    expect(await ctx.db.user.count()).toBe(1);
  });

  // 事务内不能调用 $close
  test("$close cannot be called inside a transaction", async () => {
    await expectOrmError(
      ctx.db.$transaction(async () => {
        return ctx.db.$close();
      }),
      "TRANSACTION_SCOPE",
    );
  });
});

import { sql } from "../../src/index.js";
/** 把可信的标识符作为 SQL 文本（而不是参数）拼进原生模板。 */
function rawIdent(text: string) {
  const strings = Object.assign([text], { raw: [text] }) as unknown as TemplateStringsArray;
  return sql(strings);
}
