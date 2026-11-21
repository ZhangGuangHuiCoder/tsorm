import type { Adapter, RuntimeAdapter, Session } from "./adapter.js";
import { OrmError } from "../shared/index.js";
type Base = {
  readonly database: Adapter["name"];
  readonly timestamp: Date;
  readonly durationMs: number;
};
type Outcome = { readonly status: "success" | "error"; readonly error?: unknown };
export type ClientEvent = Base &
  Outcome &
  (
    | {
        readonly type: "query";
        readonly sql: string;
        readonly parameters: readonly unknown[];
        readonly affectedRows?: number;
      }
    | {
        readonly type: "transaction";
        readonly action: "begin" | "commit" | "rollback";
      }
    | {
        readonly type: "client";
        readonly action: "connect" | "close";
      }
  );
export type Logger = (event: ClientEvent) => void | Promise<void>;
type Pending = ClientEvent extends infer E ? (E extends unknown ? Omit<E, keyof Base | keyof Outcome> : never) : never;

/** Runs one operation and reports its outcome; observer failures never change database operations. */
class Observer {
  constructor(
    private readonly adapter: Adapter,
    private readonly logger: Logger,
  ) {}

  run = async <T>(event: Pending, run: () => T | Promise<T>, details?: (result: T) => object, translate = (error: unknown) => error): Promise<T> => {
    const start = performance.now();
    const emit = (outcome: object) => {
      try {
        const reported = this.logger(Object.freeze({ ...event, ...outcome, database: this.adapter.name, timestamp: new Date(), durationMs: performance.now() - start }) as ClientEvent);
        if (reported) {
          Promise.resolve(reported).catch(() => {});
        }
      } catch {
        /* Observer failures do not change database operations. */
      }
    };
    let result: T;
    try {
      result = await run();
    } catch (error) {
      emit({ status: "error", error: translate(error) });
      throw error;
    }
    emit({ status: "success", ...details?.(result) });
    return result;
  };
}

/** Wraps a session so every statement and transaction reports through the observer. */
class ObservedSession implements Session {
  cancel?: () => Promise<void>;

  constructor(
    private readonly session: Session,
    private readonly observe: Observer,
    private readonly translate: (error: any) => Error,
  ) {
    this.cancel = session.cancel
      ? () => {
          return session.cancel!();
        }
      : undefined;
  }

  private transaction(action: "begin" | "commit" | "rollback", run: () => Promise<void>) {
    return this.observe.run({ type: "transaction", action }, run, undefined, this.translate);
  }

  execute = (sql: Parameters<Session["execute"]>[0]) => {
    return this.observe.run(
      { type: "query", sql: sql.text, parameters: Object.freeze([...sql.values]) },
      () => {
        return this.session.execute(sql);
      },
      (result) => {
        return { affectedRows: result.affectedRows };
      },
      this.translate,
    );
  };
  begin = (options?: Parameters<Session["begin"]>[0]) => {
    return this.transaction("begin", () => {
      return this.session.begin(options);
    });
  };
  commit = () => {
    return this.transaction("commit", () => {
      return this.session.commit();
    });
  };
  rollback = () => {
    return this.transaction("rollback", () => {
      return this.session.rollback();
    });
  };
  release = (broken?: boolean) => {
    return this.session.release(broken);
  };
}

/** A runtime whose connection opens on first use; creating a client does not touch the database. */
class ObservedAdapter implements RuntimeAdapter {
  readonly dialect: RuntimeAdapter["dialect"];
  readonly capabilities: RuntimeAdapter["capabilities"];
  readonly translate: RuntimeAdapter["translate"];
  private starting?: Promise<RuntimeAdapter>;
  private closing?: Promise<void>;
  private readonly acquiring = new Set<Promise<Session>>();
  private closed = false;
  private readonly observe?: Observer;

  constructor(
    private readonly adapter: Adapter,
    logger?: Logger,
  ) {
    this.dialect = adapter.dialect;
    this.capabilities = adapter.capabilities;
    this.translate = adapter.translate;
    this.observe = createObserver(adapter, logger);
  }

  private ensure = (): Promise<RuntimeAdapter> => {
    if (this.closed) {
      return Promise.reject(new OrmError("CLIENT_CLOSED", "Client closed"));
    }
    if (!this.starting) {
      const opened = Promise.resolve().then(() => {
        return this.adapter.connect();
      });
      this.starting = (this.observe ? this.observe.run({ type: "client", action: "connect" }, () => opened) : opened).catch((error: unknown) => {
        this.starting = undefined;
        throw error;
      });
    }
    return this.starting;
  };

  acquire = async (): Promise<Session> => {
    const runtime = await this.ensure();
    // The connection may have opened while close() was called; never lease a session from a closed runtime.
    if (this.closed) {
      throw new OrmError("CLIENT_CLOSED", "Client closed");
    }
    // Register the in-flight lease synchronously so close() can drain it before shutting down the pool.
    const opening = Promise.resolve().then(() => {
      return runtime.acquire();
    });
    this.acquiring.add(opening);
    try {
      const session = await opening;
      return this.observe ? new ObservedSession(session, this.observe, runtime.translate) : session;
    } finally {
      this.acquiring.delete(opening);
    }
  };
  close = async (): Promise<void> => {
    this.closed = true;
    // Cache the in-flight close so repeated/concurrent callers share one shutdown
    // and the underlying runtime is closed at most once.
    if (this.closing) {
      return this.closing;
    }
    if (!this.starting) {
      return;
    }
    const starting = this.starting;
    this.closing = (async () => {
      let runtime: RuntimeAdapter;
      try {
        runtime = await starting;
      } catch {
        return;
      }
      // A lease already in progress must finish before the pool is closed; otherwise it would
      // be handed a session from a pool that is shutting down. New leases are rejected by closed.
      await Promise.allSettled(this.acquiring);
      await (this.observe ? this.observe.run({ type: "client", action: "close" }, () => runtime.close()) : runtime.close());
    })();
    return this.closing;
  };
}

function createObserver(adapter: Adapter, logger?: Logger): Observer | undefined {
  return logger ? new Observer(adapter, logger) : undefined;
}

export function observeAdapter(adapter: Adapter, logger?: Logger): RuntimeAdapter {
  return new ObservedAdapter(adapter, logger);
}
