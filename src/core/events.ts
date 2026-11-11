import type { Adapter, RuntimeAdapter, Session } from "./adapter.js";
type Base = {
  readonly database: Adapter["name"];
  readonly timestamp: Date;
  readonly durationMs: number;
};
export type ClientEvent = Base &
  (
    | {
        readonly type: "query";
        readonly sql: string;
        readonly parameters: readonly unknown[];
        readonly status: "success" | "error";
        readonly affectedRows?: number;
        readonly error?: unknown;
      }
    | {
        readonly type: "transaction";
        readonly action: "begin" | "commit" | "rollback";
        readonly status: "success" | "error";
        readonly error?: unknown;
      }
    | {
        readonly type: "client";
        readonly action: "connect" | "close";
        readonly status: "success" | "error";
        readonly error?: unknown;
      }
  );
export type Logger = (event: ClientEvent) => void | Promise<void>;
function eventEmitter(logger?: Logger) {
  return (event: ClientEvent) => {
    try {
      const result = logger?.(Object.freeze(event));
      if (result) {
        Promise.resolve(result).catch(() => {});
      }
    } catch {
      /* Observer failures do not change database operations. */
    }
  };
}
export async function observeAdapter(adapter: Adapter, schema: Parameters<Adapter["connect"]>[0], logger?: Logger): Promise<RuntimeAdapter> {
  if (!logger) {
    return adapter.connect(schema);
  }
  const emit = eventEmitter(logger);
  const database = adapter.name;
  const lifecycle = async <T>(action: "connect" | "close", run: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      const result = await run();
      emit({
        type: "client",
        database,
        action,
        status: "success",
        timestamp: new Date(),
        durationMs: performance.now() - start,
      });
      return result;
    } catch (error) {
      emit({
        type: "client",
        database,
        action,
        status: "error",
        timestamp: new Date(),
        durationMs: performance.now() - start,
        error,
      });
      throw error;
    }
  };
  const runtime = await lifecycle("connect", async () => {
    return adapter.connect(schema);
  });
  return {
    ...runtime,
    async close() {
      await lifecycle("close", () => {
        return runtime.close();
      });
    },
    async acquire() {
      const session = await runtime.acquire();
      const transaction = async (action: "begin" | "commit" | "rollback", run: () => Promise<void>) => {
        const start = performance.now();
        try {
          await run();
          emit({
            type: "transaction",
            database,
            action,
            status: "success",
            timestamp: new Date(),
            durationMs: performance.now() - start,
          });
        } catch (error) {
          emit({
            type: "transaction",
            database,
            action,
            status: "error",
            timestamp: new Date(),
            durationMs: performance.now() - start,
            error: runtime.translate(error),
          });
          throw error;
        }
      };
      const observed: Session = {
        async execute(sql) {
          const start = performance.now();
          const parameters = Object.freeze([...sql.values]);
          try {
            const result = await session.execute(sql);
            emit({
              type: "query",
              database,
              sql: sql.text,
              parameters,
              status: "success",
              affectedRows: result.affectedRows,
              timestamp: new Date(),
              durationMs: performance.now() - start,
            });
            return result;
          } catch (error) {
            emit({
              type: "query",
              database,
              sql: sql.text,
              parameters,
              status: "error",
              error: runtime.translate(error),
              timestamp: new Date(),
              durationMs: performance.now() - start,
            });
            throw error;
          }
        },
        begin: (options) => {
          return transaction("begin", () => {
            return session.begin(options);
          });
        },
        commit: () => {
          return transaction("commit", () => {
            return session.commit();
          });
        },
        rollback: () => {
          return transaction("rollback", () => {
            return session.rollback();
          });
        },
        release: (broken) => {
          return session.release(broken);
        },
        ...(session.cancel
          ? {
              cancel: () => {
                return session.cancel!();
              },
            }
          : {}),
      };
      return observed;
    },
  };
}
