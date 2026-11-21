import { createMany, updateMany, keyOf } from "./bulk-writes.js";
import { withVirtuals } from "./client-types.js";
import { visibleWhere } from "../query/predicates.js";
import { compileRaw, rawQuery } from "./raw.js";
import { analytics } from "./analytics.js";
import { observeAdapter } from "./events.js";
import type { Logger } from "./events.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { internalModelKey, internalModelTable, type Schema } from "../schema/model.js";
import type { Spec, Client } from "./client-types.js";
import type { Adapter, RuntimeAdapter, Session, TransactionOptions } from "./adapter.js";
import { Engine } from "./engine.js";
import { OrmError, fail, guardMassWrite, checkObject, checkOptions, requireWhere } from "../shared/index.js";
/**
 * 虚拟字段与全局 omit 通过 `$extend` 添加，使 `createClient` 只负责连接。
 * Virtual fields and global omit are added through `$extend`, keeping `createClient` connection-only.
 */
export interface ClientOptions {
  adapter: Adapter;
  logger?: Logger;
  /** Abort a bulk write that matches more rows than this; full-table work uses `$clear`. */
  maxAffected?: number;
}
async function acquireTransaction(adapter: RuntimeAdapter, maxWait?: number): Promise<Session> {
  if (maxWait === undefined) {
    return adapter.acquire();
  }
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = adapter.acquire().then(async (session) => {
    if (expired) {
      await session.release();
      throw new OrmError("TRANSACTION_MAX_WAIT", "Connection arrived after maxWait");
    }
    return session;
  });
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new OrmError("TRANSACTION_MAX_WAIT", "Timed out waiting for transaction connection"));
        }, maxWait);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
/**
 * 同步创建客户端；适配器在首次数据库操作时连接。
 * Creates a client synchronously; the adapter connects on the first database operation.
 */
export function createClient<S extends Spec = Spec>(schema: Schema, options: ClientOptions): Client<S> {
  if (!options?.adapter) {
    fail("An adapter is required");
  }
  const maxAffected = options.maxAffected;
  if (maxAffected !== undefined && (!Number.isSafeInteger(maxAffected) || maxAffected <= 0)) {
    fail("maxAffected requires a positive integer");
  }
  // The connection opens on first use; client creation only validates options.
  const runtime = observeAdapter(options.adapter, options.logger);
  return makeClient<S>(schema, runtime, undefined, maxAffected);
}
function withOmit(schema: Schema, omit: unknown): Schema {
  if (omit === undefined) {
    return schema;
  }
  checkObject(omit, "omit");
  const tables = { ...schema.tables };
  for (const [model, fields] of Object.entries(omit as object)) {
    const table = internalModelTable(schema, model);
    if (!table) {
      fail("Unknown omit model " + model);
    }
    checkObject(fields, "omit");
    for (const [name, value] of Object.entries(fields)) {
      if ((!table!.columns[name] && !table!.virtuals?.[name]) || typeof value !== "boolean") {
        fail("Invalid omitted field");
      }
    }
    // Merge instead of replace so `$extend` layers omit on top of the current ones.
    tables[table!.name] = { ...table!, omit: { ...table!.omit, ...fields } };
  }
  return { ...schema, tables };
}
interface Scope {
  session: Session;
  tail: Promise<void>;
  active: boolean;
  accepting: boolean;
  failed?: boolean;
  failure?: unknown;
  isolationLevel: string;
  deadline?: number;
  cancelling?: Promise<void>;
}
/** Connection-independent client state: extended clients share it so transactions and close stay in sync. */
interface Lifecycle {
  context: AsyncLocalStorage<Scope>;
  running: Set<Promise<unknown>>;
  closed: boolean;
  closing?: Promise<void>;
}
function makeClient<S extends Spec>(schema: Schema, adapter: RuntimeAdapter, life: Lifecycle = { context: new AsyncLocalStorage(), running: new Set(), closed: false }, maxAffected?: number): Client<S> {
  const { context, running } = life;
  const isolation = (options: TransactionOptions = {}) => {
    for (const k of Object.keys(options)) {
      if (!["isolationLevel", "maxWait", "timeout"].includes(k)) {
        fail(`Unknown transaction option ${k}`);
      }
    }
    for (const key of ["maxWait", "timeout"] as const) {
      if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key]! <= 0)) {
        fail(key + " requires positive milliseconds");
      }
    }
    if (options.isolationLevel && !adapter.capabilities.isolationLevels.includes(options.isolationLevel)) {
      throw new OrmError("UNSUPPORTED_CAPABILITY", `${adapter.dialect.name} does not support isolation ${options.isolationLevel}`);
    }
  };
  function tracked<T>(fn: () => Promise<T>): Promise<T> {
    if (life.closed) {
      return Promise.reject(new OrmError("CLIENT_CLOSED", "Client closed"));
    }
    if (context.getStore()) {
      return Promise.reject(new OrmError("TRANSACTION_SCOPE", "Use tx inside transaction"));
    }
    const p = fn();
    running.add(p);
    const done = () => {
      running.delete(p);
    };
    p.then(done, done);
    return p;
  }
  function enqueue<T>(scope: Scope, fn: () => Promise<T>) {
    if (!scope.active || !scope.accepting) {
      return Promise.reject(new OrmError("TRANSACTION_CLOSED", "Transaction ended"));
    }
    const p = scope.tail.then(async () => {
      if (scope.failed) {
        throw new OrmError("TRANSACTION_ABORTED", "Transaction operation failed");
      }
      try {
        if (scope.deadline !== undefined && performance.now() >= scope.deadline) {
          throw new OrmError("TRANSACTION_TIMEOUT", "Transaction exceeded timeout");
        }
        const result = await fn();
        if (scope.deadline !== undefined && performance.now() >= scope.deadline) {
          throw new OrmError("TRANSACTION_TIMEOUT", "Transaction exceeded timeout");
        }
        return result;
      } catch (e) {
        scope.failed = true;
        scope.failure = e;
        throw adapter.translate(e);
      }
    });
    scope.tail = p.then(
      () => {},
      () => {},
    );
    return p;
  }
  const make = (scope?: Scope) => {
    const client: any = Object.create(null);
    const exec = (fn: (e: Engine) => Promise<any>, mode: boolean | "snapshot" = false): Promise<any> => {
      const current = scope ?? context.getStore();
      if (current) {
        if (mode === "snapshot" && current.isolationLevel === "read committed") {
          return Promise.reject(new OrmError("TRANSACTION_ISOLATION", "findManyAndCount requires repeatable read or serializable"));
        }
        return enqueue(current, () => {
          return fn(new Engine(schema, adapter, current.session));
        });
      }
      return tracked(async () => {
        let session: Session | undefined;
        let begun = false;
        let broken = false;
        try {
          session = await adapter.acquire();
          if (mode) {
            await session.begin(
              mode === "snapshot"
                ? {
                    readOnly: true,
                    isolationLevel: adapter.dialect.defaultTransactionIsolation(true),
                  }
                : undefined,
            );
            begun = true;
          }
          const result = await fn(new Engine(schema, adapter, session));
          if (begun) {
            await session.commit();
            begun = false;
          }
          return result;
        } catch (error) {
          if (session && begun) {
            try {
              await session.rollback();
            } catch {
              broken = true;
            }
          }
          throw adapter.translate(error);
        } finally {
          await session?.release(broken);
        }
      });
    };
    for (const t of Object.values(schema.tables)) {
      const readback = async (e: Engine, row: any, args: any) => {
        const query = { ...args };
        delete query.data;
        delete query.create;
        delete query.update;
        delete query.where;
        e.validate(t, query);
        return (await e.project(t, [row], query))[0];
      };
      const first = async (e: Engine, a: any) => {
        e.validate(t, { ...a, take: a.take < 0 ? -a.take : a.take });
        let take = 1;
        if (a.take === 0) {
          take = 0;
        } else if (a.take < 0) {
          take = -1;
        }
        return (await e.find(t, { ...a, take }))[0] ?? null;
      };
      const unique = async (e: Engine, a: any) => {
        e.unique(t, a.where);
        return (await e.find(t, a))[0] ?? null;
      };
      const found = (row: any) => {
        if (!row) {
          throw new OrmError("NOT_FOUND", t.name + " not found");
        }
        return row;
      };
      /** `forceDeleteMany` removes rows physically, soft-deleted ones included. */
      const deleteMany = (operation: "deleteMany" | "forceDeleteMany", a: any) => {
        return exec(async (e) => {
          checkOptions(a, operation, "where");
          requireWhere(a, operation);
          const force = operation === "forceDeleteMany";
          // Counting is only needed for the limit; without it the delete itself is the single round-trip.
          if (maxAffected !== undefined) {
            guardMassWrite(operation, t.name, await e.count(t, force ? { where: a.where, deleted: "include" } : { where: a.where }), maxAffected);
          }
          const result = await e.execute(force ? { kind: "delete", table: t, where: visibleWhere(a.where, "include"), physical: true } : { kind: "delete", table: t, where: a.where });
          return { count: result.affectedRows };
        }, true);
      };
      client[internalModelKey(t)] = {
        findMany: (a: any = {}) => {
          return exec((e) => {
            return e.find(t, a);
          });
        },
        findManyAndCount: (a: any = {}) => {
          return exec(async (e) => {
            const data = await e.find(t, a);
            const total = await e.count(t, {
              where: a.where,
              distinct: a.distinct,
              deleted: a.deleted,
            });
            return { data, total };
          }, "snapshot");
        },
        findFirst: (a: any = {}) => {
          return exec((e) => {
            return first(e, a);
          });
        },
        findUnique: (a: any) => {
          return exec((e) => {
            return unique(e, a);
          });
        },
        aggregate: (a: any = {}) => {
          return exec((e) => {
            return analytics(e, t, a);
          });
        },
        groupBy: (a: any) => {
          return exec((e) => {
            return analytics(e, t, a, true);
          });
        },
        count: (a: any = {}) => {
          return exec((e) => {
            return e.count(t, a);
          });
        },
        restore: (a: any) => {
          return exec(async (e) => {
            if (!t.softDelete) {
              fail("Model does not support soft delete");
            }
            const row = await e.locate(t, a.where, "only");
            await e.execute({
              kind: "update",
              table: t,
              where: visibleWhere(keyOf(t, row), "only"),
              data: e.updateValues(t, { [t.softDelete!]: null }, true),
            });
            return readback(e, await e.locate(t, keyOf(t, row)), a);
          }, true);
        },
        restoreMany: (a: any = {}) => {
          return exec(async (e) => {
            checkOptions(a, "restoreMany", "where");
            requireWhere(a, "restoreMany");
            if (!t.softDelete) {
              fail("Model does not support soft delete");
            }
            const count = await e.count(t, { where: a.where, deleted: "only" });
            guardMassWrite("restoreMany", t.name, count, maxAffected);
            await e.execute({
              kind: "update",
              table: t,
              where: visibleWhere(a.where, "only"),
              data: e.updateValues(t, { [t.softDelete!]: null }, true),
            });
            return { count };
          }, true);
        },
        forceDelete: (a: any) => {
          return exec(async (e) => {
            const row = await e.locate(t, a.where, "include");
            const result = await readback(e, row, a);
            await e.execute({
              kind: "delete",
              table: t,
              where: visibleWhere(keyOf(t, row), "include"),
              physical: true,
            });
            return result;
          }, true);
        },
        forceDeleteMany: (a: any = {}) => {
          return deleteMany("forceDeleteMany", a);
        },
        create: (a: any) => {
          return exec(async (e) => {
            return readback(e, await e.create(t, a.data), a);
          }, true);
        },
        createMany: (a: any) => {
          return exec((e) => {
            return createMany(e, t, a);
          }, true);
        },
        createManyAndReturn: (a: any) => {
          return exec((e) => {
            return createMany(e, t, a, true);
          }, true);
        },
        updateManyAndReturn: (a: any) => {
          return exec((e) => {
            return updateMany(e, t, a, true, maxAffected);
          }, true);
        },
        upsert: (a: any) => {
          return exec(async (e) => {
            return readback(e, await e.upsert(t, a.where, a.create, a.update), a);
          }, true);
        },
        findUniqueOrThrow: (a: any) => {
          return exec(async (e) => {
            return found(await unique(e, a));
          });
        },
        findFirstOrThrow: (a: any = {}) => {
          return exec(async (e) => {
            return found(await first(e, a));
          });
        },
        update: (a: any) => {
          return exec(async (e) => {
            return readback(e, await e.update(t, a.where, a.data), a);
          }, true);
        },
        updateMany: (a: any) => {
          return exec((e) => {
            return updateMany(e, t, a, false, maxAffected);
          }, true);
        },
        delete: (a: any) => {
          return exec(async (e) => {
            const row = await e.locate(t, a.where);
            const result = t.softDelete ? undefined : await readback(e, row, a);
            await e.execute({ kind: "delete", table: t, where: keyOf(t, row) });
            return t.softDelete ? readback(e, await e.locate(t, keyOf(t, row), "only"), a) : result;
          }, true);
        },
        deleteMany: (a: any = {}) => {
          return deleteMany("deleteMany", a);
        },
      };
    }
    /** Explicit full-table write. Bulk methods reject an empty `where`, so clearing a table goes through here; the call itself is the confirmation, so `maxAffected` does not apply. */
    client.$clear = (model: any, options: any = {}) => {
      return exec(async (e) => {
        if (typeof model !== "string") {
          fail("$clear requires a model name");
        }
        const t = internalModelTable(schema, model);
        if (!t) {
          fail("Unknown model " + model);
        }
        checkOptions(options, "$clear", "force");
        if (options.force !== undefined && typeof options.force !== "boolean") {
          fail("force requires boolean");
        }
        const force = options.force === true;
        const result = await e.execute({
          kind: "delete",
          table: t!,
          where: force ? visibleWhere({}, "include") : {},
          physical: force,
        });
        return { count: result.affectedRows };
      }, true);
    };
    client.$queryRaw = (query: any, ...values: any[]) => {
      return exec(async (e) => {
        return (await e.session.execute(compileRaw(adapter, rawQuery(query, values)))).rows;
      });
    };
    client.$executeRaw = (query: any, ...values: any[]) => {
      return exec(async (e) => {
        return (await e.session.execute(compileRaw(adapter, rawQuery(query, values)))).affectedRows;
      }, true);
    };
    return client;
  };
  const client = make();
  Object.defineProperty(client, "$capabilities", {
    value: Object.freeze({
      ...adapter.capabilities,
      isolationLevels: Object.freeze([...adapter.capabilities.isolationLevels]),
    }),
    enumerable: true,
  });
  client.$transaction = (fn: any, options: TransactionOptions = {}) => {
    if (context.getStore()) {
      return (async () => {
        const current = context.getStore()!;
        if (!current.active || !current.accepting) {
          throw new OrmError("TRANSACTION_CLOSED", "Transaction ended");
        }
        isolation(options);
        if (options.maxWait !== undefined || options.timeout !== undefined) {
          throw new OrmError("TRANSACTION_OPTIONS", "Nested transaction inherits timeout settings");
        }
        if (options.isolationLevel && options.isolationLevel !== current.isolationLevel) {
          throw new OrmError("TRANSACTION_ISOLATION", "Nested transaction cannot change isolation");
        }
        try {
          return await fn(make(current));
        } catch (error) {
          current.failed = true;
          current.failure = error;
          throw error;
        }
      })();
    }
    return tracked(async () => {
      isolation(options);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let s: Session | undefined;
      let scope: Scope | undefined;
      let begun = false;
      let broken = false;
      try {
        s = await acquireTransaction(adapter, options.maxWait);
        await s.begin(options);
        begun = true;
        scope = {
          session: s,
          tail: Promise.resolve(),
          active: true,
          accepting: true,
          isolationLevel: options.isolationLevel ?? adapter.dialect.defaultTransactionIsolation(false),
        };
        scope.deadline = options.timeout === undefined ? undefined : performance.now() + options.timeout;
        const callback = Promise.resolve(
          context.run(scope, () => {
            return fn(make(scope));
          }),
        );
        const result =
          options.timeout === undefined
            ? await callback
            : await Promise.race([
                callback,
                new Promise<never>((_, reject) => {
                  timer = setTimeout(() => {
                    scope!.accepting = false;
                    scope!.failed = true;
                    scope!.failure = new OrmError("TRANSACTION_TIMEOUT", "Transaction callback exceeded timeout");
                    // Stop the running statement on the server instead of waiting for it.
                    scope!.cancelling = s!.cancel?.().catch(() => {});
                    reject(scope!.failure);
                  }, options.timeout);
                }),
              ]);
        scope.accepting = false;
        await scope.tail;
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (scope.deadline !== undefined && performance.now() >= scope.deadline) {
          throw new OrmError("TRANSACTION_TIMEOUT", "Transaction exceeded timeout");
        }
        if (scope.failed) {
          if (scope.failure instanceof OrmError && scope.failure.code === "TRANSACTION_TIMEOUT") {
            throw scope.failure;
          }
          throw new OrmError("TRANSACTION_ABORTED", "Transaction operation failed");
        }
        await s.commit();
        begun = false;
        return result;
      } catch (e) {
        if (scope) {
          scope.accepting = false;
          await scope.tail;
          await scope.cancelling;
        }
        if (s && begun) {
          try {
            await s.rollback();
          } catch {
            broken = true;
          }
        }
        throw adapter.translate(e);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
        if (scope) {
          scope.active = false;
        }
        await s?.release(broken);
      }
    });
  };
  client.$extend = (options: { virtuals?: unknown; omit?: unknown } = {}) => {
    return makeClient(withOmit(withVirtuals(schema, options.virtuals), options.omit), adapter, life, maxAffected);
  };
  client.$close = async () => {
    if (context.getStore()) {
      throw new OrmError("TRANSACTION_SCOPE", "Cannot close inside transaction");
    }
    if (life.closing) {
      return life.closing;
    }
    life.closed = true;
    life.closing = (async () => {
      await Promise.allSettled(running);
      await adapter.close();
    })();
    return life.closing;
  };
  return client;
}
