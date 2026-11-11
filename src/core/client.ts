import { createMany, updateMany } from "./bulk-writes.js";
import { acquireTransaction } from "./transaction-wait.js";
import { withVirtuals } from "./virtuals.js";
import { visibleWhere } from "../query/visibility.js";
import { dateTimeInput, utcDateTime, timezoneOffset, type DateTimeFormat } from "../shared/datetime.js";
import { compileRaw, rawQuery } from "./raw.js";
import { analytics } from "./analytics.js";
import { observeAdapter } from "./events.js";
import type { Logger } from "./events.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Schema } from "../schema/index.js";
import type { Spec, Client } from "./types.js";
import type { Adapter, RuntimeAdapter, Session, TransactionOptions } from "./adapter.js";
import { Engine, keyOf } from "./engine.js";
import { OrmError, fail, guardMassWrite } from "../shared/errors.js";
import { safeInteger } from "../shared/scalars.js";
import { checkObject, requireWhere } from "../shared/validation.js";
/** Virtual fields and global omit are added through `$extend`, keeping `createClient` connection-only. */
export interface ClientOptions {
  adapter: Adapter;
  timezone?: string;
  /** Model datetime output: local SQL datetime (default) or ISO UTC. */
  datetimeFormat?: DateTimeFormat;
  logger?: Logger;
  /** Abort a bulk write that matches more rows than this; full-table work uses `$clear`. */
  maxAffected?: number;
}
export async function createClient<S extends Spec = Spec>(schema: Schema, options: ClientOptions): Promise<Client<S>> {
  if (!options?.adapter) {
    fail("An adapter is required");
  }
  const timezone = options.timezone ?? "+08:00";
  timezoneOffset(timezone);
  const datetimeFormat = options.datetimeFormat ?? "local";
  if (!["local", "utc"].includes(datetimeFormat)) {
    fail("datetimeFormat must be local or utc");
  }
  const maxAffected = options.maxAffected;
  if (maxAffected !== undefined && (!Number.isSafeInteger(maxAffected) || maxAffected <= 0)) {
    fail("maxAffected requires a positive integer");
  }
  const adapter = await observeAdapter(options.adapter, schema, options.logger);
  const dialect = adapter.dialect;
  const dateMillis = (value: any) => {
    if (typeof value === "bigint" || (typeof value === "string" && /^-?\d+$/.test(value))) {
      value = safeInteger(value);
    }
    const local = dateTimeInput(value, timezone, datetimeFormat);
    return Date.parse(utcDateTime(local, timezone));
  };
  return makeClient<S>(
    schema,
    {
      ...adapter,
      dialect: {
        ...dialect,
        decode: (table, raw) => {
          const row = dialect.decode(table, raw);
          for (const [key, column] of Object.entries(table.columns)) {
            if (column.type === "datetime" && row[key] != null) {
              let local = row[key];
              if (column.dateStorage === "timestamp") {
                local = dateTimeInput(safeInteger(row[key]), timezone, "local");
              }
              row[key] = datetimeFormat === "utc" ? utcDateTime(local, timezone) : local;
            }
          }
          return row;
        },
        groupKey: (column, value) => {
          if (column.type === "datetime" && column.dateStorage === "timestamp" && value != null) {
            return String(dateMillis(value));
          }
          let input = value;
          if (column.type === "datetime" && value != null) {
            input = dateTimeInput(value, timezone, datetimeFormat);
          }
          return dialect.groupKey(column, input);
        },
        encode: (column, value) => {
          if (column.type !== "datetime" || value === null) {
            return dialect.encode(column, value);
          }
          if (column.dateStorage === "timestamp") {
            return dialect.encode(column, dateMillis(value));
          }
          return dialect.encode(column, dateTimeInput(value, timezone, datetimeFormat));
        },
      },
    },
    undefined,
    maxAffected,
  );
}
function withOmit(schema: Schema, omit: unknown): Schema {
  if (omit === undefined) {
    return schema;
  }
  checkObject(omit, "omit");
  const tables = { ...schema.tables };
  for (const [model, fields] of Object.entries(omit as object)) {
    const table = Object.values(tables).find((t) => {
      return t.name[0].toLowerCase() + t.name.slice(1) === model;
    });
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
    p.then(
      () => {
        return running.delete(p);
      },
      () => {
        return running.delete(p);
      },
    );
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
      client[t.name[0].toLowerCase() + t.name.slice(1)] = {
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
          return exec(async (e) => {
            e.validate(t, { ...a, take: a.take < 0 ? -a.take : a.take });
            let take = 1;
            if (a.take === 0) {
              take = 0;
            } else if (a.take < 0) {
              take = -1;
            }
            return (await e.find(t, { ...a, take }))[0] ?? null;
          });
        },
        findUnique: (a: any) => {
          return exec(async (e) => {
            e.unique(t, a.where);
            return (await e.find(t, a))[0] ?? null;
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
            checkObject(a, "restoreMany");
            if (
              Object.keys(a).some((k) => {
                return k !== "where";
              })
            ) {
              fail("Unknown restoreMany option");
            }
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
          return exec(async (e) => {
            checkObject(a, "forceDeleteMany");
            if (
              Object.keys(a).some((k) => {
                return k !== "where";
              })
            ) {
              fail("Unknown forceDeleteMany option");
            }
            requireWhere(a, "forceDeleteMany");
            // Counting is only needed for the limit; without it the delete itself is the single round-trip.
            if (maxAffected !== undefined) {
              guardMassWrite("forceDeleteMany", t.name, await e.count(t, { where: a.where, deleted: "include" }), maxAffected);
            }
            return {
              count: (
                await e.execute({
                  kind: "delete",
                  table: t,
                  where: visibleWhere(a.where, "include"),
                  physical: true,
                })
              ).affectedRows,
            };
          }, true);
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
            e.unique(t, a.where);
            const row = (await e.find(t, a))[0];
            if (!row) {
              throw new OrmError("NOT_FOUND", t.name + " not found");
            }
            return row;
          });
        },
        findFirstOrThrow: (a: any = {}) => {
          return exec(async (e) => {
            e.validate(t, { ...a, take: a.take < 0 ? -a.take : a.take });
            let take = 1;
            if (a.take === 0) {
              take = 0;
            } else if (a.take < 0) {
              take = -1;
            }
            const row = (await e.find(t, { ...a, take }))[0];
            if (!row) {
              throw new OrmError("NOT_FOUND", t.name + " not found");
            }
            return row;
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
          return exec(async (e) => {
            checkObject(a, "deleteMany");
            if (
              Object.keys(a).some((k) => {
                return k !== "where";
              })
            ) {
              fail("Unknown deleteMany option");
            }
            requireWhere(a, "deleteMany");
            // Counting is only needed for the limit; without it the delete itself is the single round-trip.
            if (maxAffected !== undefined) {
              guardMassWrite("deleteMany", t.name, await e.count(t, { where: a.where }), maxAffected);
            }
            return {
              count: (await e.execute({ kind: "delete", table: t, where: a.where })).affectedRows,
            };
          }, true);
        },
      };
    }
    /** Explicit full-table write. Bulk methods reject an empty `where`, so clearing a table goes through here; the call itself is the confirmation, so `maxAffected` does not apply. */
    client.$clear = (model: any, options: any = {}) => {
      return exec(async (e) => {
        if (typeof model !== "string") {
          fail("$clear requires a model name");
        }
        const t = Object.values(schema.tables).find((x) => {
          return x.name[0].toLowerCase() + x.name.slice(1) === model;
        });
        if (!t) {
          fail("Unknown model " + model);
        }
        checkObject(options, "$clear");
        if (
          Object.keys(options).some((k) => {
            return k !== "force";
          })
        ) {
          fail("Unknown $clear option");
        }
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
