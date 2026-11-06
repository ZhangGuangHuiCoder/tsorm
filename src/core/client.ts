import { createMany, updateMany } from './bulk-writes.js';
import { acquireTransaction } from './transaction-wait.js';
import { withVirtuals } from './virtuals.js';
import type { Virtuals, WithVirtuals } from './virtuals.js';
import { visibleWhere } from '../query/visibility.js';
import { localDateTime, timezoneOffset } from '../shared/datetime.js';
import { compileRaw, rawQuery } from './raw.js';
import { analytics } from './analytics.js';
import { observeAdapter } from './events.js';
import type { Logger } from './events.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Schema } from '../schema/index.js';
import type { Spec, Client, GlobalOmit, WithOmit } from './types.js';
import type { Adapter, RuntimeAdapter, Session, TransactionOptions } from './adapter.js';
import { Engine, keyOf } from './engine.js';
import { OrmError, fail } from '../shared/errors.js';
import { checkObject } from '../shared/validation.js';
export interface ClientOptions<
  S extends Spec = Spec,
  V extends Virtuals<S> = Virtuals<S>,
  O extends GlobalOmit<WithVirtuals<S, V>> = GlobalOmit<WithVirtuals<S, V>>,
> {
  adapter: Adapter;
  virtuals?: V;
  /** Fields left out of every result unless a query selects them or sets omit to false. */
  omit?: O;
  timezone?: string;
  logger?: Logger;
}
export async function createClient<
  S extends Spec = Spec,
  const V extends Virtuals<S> = {},
  const O extends GlobalOmit<WithVirtuals<S, V>> = {},
>(
  schema: Schema,
  options: ClientOptions<S, V, O>,
): Promise<Client<WithOmit<WithVirtuals<S, V>, O>>> {
  if (!options?.adapter) fail('An adapter is required');
  const timezone = options.timezone ?? '+08:00';
  timezoneOffset(timezone);
  const runtimeSchema = withOmit(withVirtuals(schema, options.virtuals), options.omit);
  const adapter = await observeAdapter(options.adapter, schema, options.logger);
  const dialect = adapter.dialect;
  return makeClient<WithOmit<WithVirtuals<S, V>, O>>(runtimeSchema, {
    ...adapter,
    dialect: {
      ...dialect,
      encode: (column, value) =>
        dialect.encode(
          column,
          column.type === 'date' && value !== null ? localDateTime(value, timezone) : value,
        ),
    },
  });
}
function withOmit(schema: Schema, omit: unknown): Schema {
  if (omit === undefined) return schema;
  checkObject(omit, 'omit');
  const tables = { ...schema.tables };
  for (const [model, fields] of Object.entries(omit as object)) {
    const table = Object.values(tables).find(
      (t) => t.name[0].toLowerCase() + t.name.slice(1) === model,
    );
    if (!table) fail('Unknown omit model ' + model);
    checkObject(fields, 'omit');
    for (const [name, value] of Object.entries(fields))
      if ((!table!.columns[name] && !table!.virtuals?.[name]) || typeof value !== 'boolean')
        fail('Invalid omitted field');
    tables[table!.name] = { ...table!, omit: fields };
  }
  return { ...schema, tables };
}
interface Scope {
  session: Session;
  tail: Promise<void>;
  active: boolean;
  accepting: boolean;
  failure?: unknown;
  isolationLevel: string;
  deadline?: number;
  cancelling?: Promise<void>;
}
function makeClient<S extends Spec>(schema: Schema, adapter: RuntimeAdapter): Client<S> {
  const context = new AsyncLocalStorage<Scope>();
  const running = new Set<Promise<unknown>>();
  let closed = false;
  const isolation = (options: TransactionOptions = {}) => {
    for (const k of Object.keys(options))
      if (!['isolationLevel', 'maxWait', 'timeout'].includes(k))
        fail(`Unknown transaction option ${k}`);
    for (const key of ['maxWait', 'timeout'] as const)
      if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key]! <= 0))
        fail(key + ' requires positive milliseconds');
    if (
      options.isolationLevel &&
      !adapter.capabilities.isolationLevels.includes(options.isolationLevel)
    )
      throw new OrmError(
        'UNSUPPORTED_CAPABILITY',
        `${adapter.dialect.name} does not support isolation ${options.isolationLevel}`,
      );
  };
  function tracked<T>(fn: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new OrmError('CLIENT_CLOSED', 'Client closed'));
    if (context.getStore())
      return Promise.reject(new OrmError('TRANSACTION_SCOPE', 'Use tx inside transaction'));
    const p = fn();
    running.add(p);
    p.then(
      () => running.delete(p),
      () => running.delete(p),
    );
    return p;
  }
  function enqueue<T>(scope: Scope, fn: () => Promise<T>) {
    if (!scope.active || !scope.accepting)
      return Promise.reject(new OrmError('TRANSACTION_CLOSED', 'Transaction ended'));
    const p = scope.tail.then(async () => {
      if (scope.failure) throw new OrmError('TRANSACTION_ABORTED', 'Transaction operation failed');
      try {
        if (scope.deadline !== undefined && performance.now() >= scope.deadline)
          throw new OrmError('TRANSACTION_TIMEOUT', 'Transaction exceeded timeout');
        const result = await fn();
        if (scope.deadline !== undefined && performance.now() >= scope.deadline)
          throw new OrmError('TRANSACTION_TIMEOUT', 'Transaction exceeded timeout');
        return result;
      } catch (e) {
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
    const exec = (
      fn: (e: Engine) => Promise<any>,
      mode: boolean | 'snapshot' = false,
    ): Promise<any> => {
      const current = scope ?? context.getStore();
      if (current) {
        if (mode === 'snapshot' && current.isolationLevel === 'read committed')
          return Promise.reject(
            new OrmError(
              'TRANSACTION_ISOLATION',
              'findManyAndCount requires repeatable read or serializable',
            ),
          );
        return enqueue(current, () => fn(new Engine(schema, adapter, current.session)));
      }
      return tracked(async () => {
        let session: Session | undefined;
        let begun = false;
        let broken = false;
        try {
          session = await adapter.acquire();
          if (mode) {
            await session.begin(
              mode === 'snapshot'
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
        findMany: (a: any = {}) => exec((e) => e.find(t, a)),
        findManyAndCount: (a: any = {}) =>
          exec(async (e) => {
            const data = await e.find(t, a);
            const total = await e.count(t, {
              where: a.where,
              distinct: a.distinct,
              deleted: a.deleted,
            });
            return { data, total };
          }, 'snapshot'),
        findFirst: (a: any = {}) =>
          exec(async (e) => {
            e.validate(t, { ...a, take: a.take < 0 ? -a.take : a.take });
            return (await e.find(t, { ...a, take: a.take === 0 ? 0 : a.take < 0 ? -1 : 1 }))[0] ?? null;
          }),
        findUnique: (a: any) =>
          exec(async (e) => {
            e.unique(t, a.where);
            return (await e.find(t, a))[0] ?? null;
          }),
        aggregate: (a: any = {}) => exec((e) => analytics(e, t, a)),
        groupBy: (a: any) => exec((e) => analytics(e, t, a, true)),
        count: (a: any = {}) => exec((e) => e.count(t, a)),
        restore: (a: any) =>
          exec(async (e) => {
            if (!t.softDelete) fail('Model does not support soft delete');
            const row = await e.locate(t, a.where, 'only');
            await e.execute({
              kind: 'update',
              table: t,
              where: visibleWhere(keyOf(t, row), 'only'),
              data: e.updateValues(t, { [t.softDelete!]: null }, true),
            });
            return readback(e, await e.locate(t, keyOf(t, row)), a);
          }, true),
        restoreMany: (a: any = {}) =>
          exec(async (e) => {
            checkObject(a, 'restoreMany');
            if (Object.keys(a).some((k) => k !== 'where')) fail('Unknown restoreMany option');
            if (!t.softDelete) fail('Model does not support soft delete');
            const count = await e.count(t, { where: a.where, deleted: 'only' });
            await e.execute({
              kind: 'update',
              table: t,
              where: visibleWhere(a.where, 'only'),
              data: e.updateValues(t, { [t.softDelete!]: null }, true),
            });
            return { count };
          }, true),
        forceDelete: (a: any) =>
          exec(async (e) => {
            const row = await e.locate(t, a.where, 'include');
            const result = await readback(e, row, a);
            await e.execute({
              kind: 'delete',
              table: t,
              where: visibleWhere(keyOf(t, row), 'include'),
              physical: true,
            });
            return result;
          }, true),
        forceDeleteMany: (a: any = {}) =>
          exec(async (e) => {
            checkObject(a, 'forceDeleteMany');
            if (Object.keys(a).some((k) => k !== 'where')) fail('Unknown forceDeleteMany option');
            return {
              count: (
                await e.execute({
                  kind: 'delete',
                  table: t,
                  where: visibleWhere(a.where, 'include'),
                  physical: true,
                })
              ).affectedRows,
            };
          }, true),
        create: (a: any) => exec(async (e) => readback(e, await e.create(t, a.data), a), true),
        createMany: (a: any) => exec((e) => createMany(e, t, a), true),
        createManyAndReturn: (a: any) => exec((e) => createMany(e, t, a, true), true),
        updateManyAndReturn: (a: any) => exec((e) => updateMany(e, t, a, true), true),
        upsert: (a: any) =>
          exec(async (e) => readback(e, await e.upsert(t, a.where, a.create, a.update), a), true),
        findUniqueOrThrow: (a: any) =>
          exec(async (e) => {
            e.unique(t, a.where);
            const row = (await e.find(t, a))[0];
            if (!row) throw new OrmError('NOT_FOUND', t.name + ' not found');
            return row;
          }),
        findFirstOrThrow: (a: any = {}) =>
          exec(async (e) => {
            e.validate(t, { ...a, take: a.take < 0 ? -a.take : a.take });
            const row = (await e.find(t, { ...a, take: a.take === 0 ? 0 : a.take < 0 ? -1 : 1 }))[0];
            if (!row) throw new OrmError('NOT_FOUND', t.name + ' not found');
            return row;
          }),
        update: (a: any) =>
          exec(async (e) => readback(e, await e.update(t, a.where, a.data), a), true),
        updateMany: (a: any) => exec((e) => updateMany(e, t, a), true),
        delete: (a: any) =>
          exec(async (e) => {
            const row = await e.locate(t, a.where);
            const result = t.softDelete ? undefined : await readback(e, row, a);
            await e.execute({ kind: 'delete', table: t, where: keyOf(t, row) });
            return t.softDelete
              ? readback(e, await e.locate(t, keyOf(t, row), 'only'), a)
              : result;
          }, true),
        deleteMany: (a: any = {}) =>
          exec(async (e) => {
            checkObject(a, 'deleteMany');
            if (Object.keys(a).some((k) => k !== 'where')) fail('Unknown deleteMany option');
            return {
              count: (await e.execute({ kind: 'delete', table: t, where: a.where })).affectedRows,
            };
          }, true),
      };
    }
    client.$queryRaw = (query: any, ...values: any[]) =>
      exec(
        async (e) => (await e.session.execute(compileRaw(adapter, rawQuery(query, values)))).rows,
      );
    client.$executeRaw = (query: any, ...values: any[]) =>
      exec(
        async (e) =>
          (await e.session.execute(compileRaw(adapter, rawQuery(query, values)))).affectedRows,
        true,
      );
    return client;
  };
  const client = make();
  Object.defineProperty(client, '$capabilities', {
    value: Object.freeze({
      ...adapter.capabilities,
      isolationLevels: Object.freeze([...adapter.capabilities.isolationLevels]),
    }),
    enumerable: true,
  });
  client.$transaction = (fn: any, options: TransactionOptions = {}) =>
    context.getStore()
      ? (async () => {
          const current = context.getStore()!;
          if (!current.active || !current.accepting)
            throw new OrmError('TRANSACTION_CLOSED', 'Transaction ended');
          isolation(options);
          if (options.maxWait !== undefined || options.timeout !== undefined)
            throw new OrmError(
              'TRANSACTION_OPTIONS',
              'Nested transaction inherits timeout settings',
            );
          if (options.isolationLevel && options.isolationLevel !== current.isolationLevel)
            throw new OrmError(
              'TRANSACTION_ISOLATION',
              'Nested transaction cannot change isolation',
            );
          try {
            return await fn(make(current));
          } catch (error) {
            current.failure = error;
            throw error;
          }
        })()
      : tracked(async () => {
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
              isolationLevel:
                options.isolationLevel ?? adapter.dialect.defaultTransactionIsolation(false),
            };
            scope.deadline =
              options.timeout === undefined ? undefined : performance.now() + options.timeout;
            const callback = Promise.resolve(context.run(scope, () => fn(make(scope))));
            const result =
              options.timeout === undefined
                ? await callback
                : await Promise.race([
                    callback,
                    new Promise<never>((_, reject) => {
                      timer = setTimeout(() => {
                        scope!.accepting = false;
                        scope!.failure = new OrmError(
                          'TRANSACTION_TIMEOUT',
                          'Transaction callback exceeded timeout',
                        );
                        // Stop the running statement on the server instead of waiting for it.
                        scope!.cancelling = s!.cancel?.().catch(() => {});
                        reject(scope!.failure);
                      }, options.timeout);
                    }),
                  ]);
            if (timer) {
              clearTimeout(timer);
              timer = undefined;
            }
            scope.accepting = false;
            await scope.tail;
            if (scope.deadline !== undefined && performance.now() >= scope.deadline)
              throw new OrmError('TRANSACTION_TIMEOUT', 'Transaction exceeded timeout');
            if (scope.failure) {
              if (scope.failure instanceof OrmError && scope.failure.code === 'TRANSACTION_TIMEOUT')
                throw scope.failure;
              throw new OrmError('TRANSACTION_ABORTED', 'Transaction operation failed');
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
            if (timer) clearTimeout(timer);
            if (scope) scope.active = false;
            await s?.release(broken);
          }
        });
  client.$close = async () => {
    if (context.getStore())
      throw new OrmError('TRANSACTION_SCOPE', 'Cannot close inside transaction');
    if (closed) return;
    closed = true;
    await Promise.allSettled([...running]);
    await adapter.close();
  };
  return client;
}
