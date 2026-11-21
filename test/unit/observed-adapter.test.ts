// 懒连接运行时的生命周期回归：关闭竞态、失败重试与关闭语义。
import { describe, expect, test } from "bun:test";
import { observeAdapter } from "../../src/core/events.js";
import { sqlite } from "../../src/adapters/sqlite/index.js";
import { OrmError } from "../../src/shared/index.js";
import type { Adapter, RuntimeAdapter, Session } from "../../src/core/adapter.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const session = (): Session => {
  return {
    execute: async () => {
      return { rows: [], affectedRows: 0 };
    },
    begin: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
};

/** 复用真实方言/能力，但连接与会话都是假的，测试不碰驱动。 */
const runtime = (base: Adapter, acquire: RuntimeAdapter["acquire"], close: RuntimeAdapter["close"] = async () => {}): RuntimeAdapter => {
  return { dialect: base.dialect, capabilities: base.capabilities, translate: base.translate, acquire, close };
};

describe("observed adapter lifecycle", () => {
  test("close drains an in-flight acquire before closing the pool", async () => {
    const base = sqlite();
    const lease = deferred<Session>();
    const entered = deferred<void>();
    let closes = 0;
    const observed = observeAdapter({
      ...base,
      connect: () => {
        return runtime(
          base,
          () => {
            entered.resolve();
            return lease.promise;
          },
          async () => {
            closes++;
          },
        );
      },
    });
    const acquiring = observed.acquire();
    await entered.promise; // 租约已登记
    const closing = observed.close();
    expect(closes).toBe(0);
    let done = false;
    void closing.then(() => {
      done = true;
    });
    await Bun.sleep(0);
    expect(done).toBeFalse();
    const leased = session();
    lease.resolve(leased);
    expect(await acquiring).toBe(leased);
    await closing;
    expect(closes).toBe(1);
    await leased.release();
  });

  test("acquire after close fails with CLIENT_CLOSED", async () => {
    const observed = observeAdapter(sqlite());
    await observed.close(); // 从未连接，无需关闭底层池
    try {
      await observed.acquire();
      throw new Error("expected CLIENT_CLOSED");
    } catch (error) {
      expect(error).toBeInstanceOf(OrmError);
      expect((error as OrmError).code).toBe("CLIENT_CLOSED");
    }
  });

  test("an acquire waiting for the connection is rejected when close wins", async () => {
    const base = sqlite();
    const opening = deferred<RuntimeAdapter>();
    const connected = deferred<void>();
    let acquires = 0;
    const observed = observeAdapter({
      ...base,
      connect: () => {
        connected.resolve();
        return opening.promise;
      },
    });
    const acquiring = observed.acquire();
    await connected.promise;
    const closing = observed.close();
    opening.resolve(
      runtime(base, async () => {
        acquires++;
        return session();
      }),
    );
    await expect(acquiring).rejects.toMatchObject({ code: "CLIENT_CLOSED" });
    await closing;
    expect(acquires).toBe(0);
  });

  test("a failed connect can be retried on the next acquire", async () => {
    const base = sqlite();
    const leased = session();
    let attempts = 0;
    const observed = observeAdapter({
      ...base,
      connect: () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("offline");
        }
        return runtime(base, async () => {
          return leased;
        });
      },
    });
    await expect(observed.acquire()).rejects.toThrow("offline");
    expect(await observed.acquire()).toBe(leased);
    expect(attempts).toBe(2);
    await leased.release();
    await observed.close();
  });
});
