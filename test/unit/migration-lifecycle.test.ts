import { describe, expect, test } from "bun:test";
import mariadb from "mariadb";
import pg from "pg";
import { providerFor } from "../../src/adapters/providers.js";

// Stub external I/O to verify ORM-owned cleanup after migration failures.
describe("migration provider lifecycle", () => {
  test.each(["clear", "close"])("MySQL scratch cleanup after %s failure", async (failure) => {
    const original = mariadb.createConnection;
    let tempClosed = 0;
    let dropped = 0;
    mariadb.createConnection = (async (options: any) => {
      const temporary = String(options.database ?? "").startsWith("tsorm_shadow_db_");
      return {
        async query(sql: string) {
          if (sql.startsWith("DROP DATABASE")) {
            dropped++;
          }
          if (temporary && sql.startsWith("SELECT TABLE_NAME") && failure === "clear") {
            throw new Error("clear failed");
          }
          return [];
        },
        async end() {
          if (temporary) {
            tempClosed++;
            if (failure === "close") {
              throw new Error("close failed");
            }
          }
        },
      };
    }) as typeof mariadb.createConnection;
    try {
      const provider = await providerFor("mysql://u:p@host/app");
      const scratch = await provider.createScratch(provider.parseDatasource("mysql://u:p@host/app", "."));
      if (failure === "clear") {
        await expect(scratch.open()).rejects.toThrow("clear failed");
        await scratch.dispose();
      } else {
        await scratch.open();
        await expect(scratch.dispose()).rejects.toThrow("close failed");
      }
      expect(tempClosed).toBe(1);
      expect(dropped).toBe(1);
    } finally {
      mariadb.createConnection = original;
    }
  });

  test.each(["clear", "close"])("PostgreSQL scratch cleanup after %s failure", async (failure) => {
    const original = pg.Client;
    let tempClosed = 0;
    let dropped = 0;
    pg.Client = class {
      temporary: boolean;
      constructor(options: any) {
        this.temporary = new URL(options.connectionString).pathname.startsWith("/tsorm_shadow_db_");
      }
      on() {}
      async connect() {}
      async query(sql: string) {
        if (sql.startsWith("SELECT current_setting")) {
          return { rows: [{ v: "140000" }] };
        }
        if (sql.startsWith("DROP DATABASE")) {
          dropped++;
        }
        if (this.temporary && sql.startsWith("DROP SCHEMA") && failure === "clear") {
          throw new Error("clear failed");
        }
        return { rows: [] };
      }
      async end() {
        if (this.temporary) {
          tempClosed++;
          if (failure === "close") {
            throw new Error("close failed");
          }
        }
      }
    } as unknown as typeof pg.Client;
    try {
      const provider = await providerFor("postgres://u:p@host/app");
      const scratch = await provider.createScratch(provider.parseDatasource("postgres://u:p@host/app", "."));
      if (failure === "clear") {
        await expect(scratch.open()).rejects.toThrow("clear failed");
        await scratch.dispose();
      } else {
        await scratch.open();
        await expect(scratch.dispose()).rejects.toThrow("close failed");
      }
      expect(tempClosed).toBe(1);
      expect(dropped).toBe(1);
    } finally {
      pg.Client = original;
    }
  });

  test("PostgreSQL closes the connection when namespace inspection fails", async () => {
    const original = pg.Client;
    let targetClosed = 0;
    pg.Client = class {
      target: boolean;
      constructor(options: any) {
        this.target = new URL(options.connectionString).pathname === "/app";
      }
      on() {}
      async connect() {}
      async query(sql: string) {
        if (sql.startsWith("SELECT current_setting")) {
          return { rows: [{ v: "140000" }] };
        }
        if (sql.startsWith("SELECT 1 FROM pg_database")) {
          return { rows: [{ exists: 1 }] };
        }
        if (this.target && sql.startsWith("SELECT 1 FROM pg_namespace")) {
          throw new Error("namespace failed");
        }
        return { rows: [] };
      }
      async end() {
        if (this.target) {
          targetClosed++;
        }
      }
    } as unknown as typeof pg.Client;
    try {
      const provider = await providerFor("postgres://u:p@host/app");
      await expect(provider.connectOrCreate(provider.parseDatasource("postgres://u:p@host/app", "."))).rejects.toThrow("namespace failed");
      expect(targetClosed).toBe(1);
    } finally {
      pg.Client = original;
    }
  });
});
