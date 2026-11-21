import type { RuntimeAdapter, Session } from "../../core/adapter.js";
import type { DialectImplementation } from "../../core/dialect.js";
import { OrmError } from "../../shared/errors.js";
import { bigintsAsText } from "../../shared/codec.js";

/**
 * SQLite 驱动细节：单连接传输（一条同步连接 + 语句缓存 + 串行租借）。
 * 只在本适配器内部使用，不从适配器入口导出。
 *
 * SQLite driver details: single-connection transport (one synchronous connection, statement
 * cache, and serialized leasing). Internal to this adapter; not exported from its entry point.
 */

/**
 * 单连接存储的语句接口（node:sqlite）。
 * Statement interface for single-connection storage (`node:sqlite`).
 */
export interface SingleStatement {
  columns(): readonly unknown[];
  all(...values: any[]): any[];
  run(...values: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  /** Return big integers as text to avoid precision loss. */
  setReadBigInts?(enabled: boolean): void;
}

/**
 * 单连接存储的连接接口（node:sqlite）。
 * Connection interface for single-connection storage (`node:sqlite`).
 */
export interface SingleConnection {
  prepare(sql: string): SingleStatement;
  exec(sql: string): void;
  close(): void;
}

/**
 * 单连接运行时：一条连接串行使用（同一时刻只有一个会话），
 * 语句按 SQL 文本缓存，prepare 比执行本身更贵。
 *
 * Single-connection runtime: serializes sessions on one connection and caches statements by SQL
 * text because preparing is more expensive than executing.
 */
export function createSingleRuntime(dialect: DialectImplementation, db: SingleConnection, unusable: string): RuntimeAdapter {
  const statements = new Map<string, SingleStatement>();
  let tail: Promise<void> = Promise.resolve();
  let broken = false;
  return {
    dialect,
    capabilities: dialect.capabilities,
    translate: dialect.translate,
    acquire: async (): Promise<Session> => {
      const previous = tail;
      let unlock!: () => void;
      tail = new Promise<void>((resolve) => {
        return (unlock = resolve);
      });
      await previous;
      if (broken) {
        unlock();
        throw new OrmError("CLIENT_CLOSED", unusable);
      }
      return {
        execute: async ({ text, values }) => {
          let statement = statements.get(text);
          if (statement === undefined) {
            statement = db.prepare(text);
            statement.setReadBigInts?.(true);
            statements.set(text, statement);
          }
          if (statement.columns().length) {
            const rows = statement.all(...values).map(bigintsAsText);
            return { rows, affectedRows: rows.length };
          }
          const result = statement.run(...values);
          return { rows: [], affectedRows: Number(result.changes), insertId: result.lastInsertRowid };
        },
        begin: async (options) => {
          db.exec(options?.readOnly ? "BEGIN" : "BEGIN IMMEDIATE");
        },
        commit: async () => {
          db.exec("COMMIT");
        },
        rollback: async () => {
          db.exec("ROLLBACK");
        },
        release: (brokenConnection?: boolean) => {
          if (brokenConnection) {
            broken = true;
          }
          unlock();
        },
      };
    },
    close: async (): Promise<void> => {
      statements.clear();
      db.close();
    },
  };
}
