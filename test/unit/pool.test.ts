// 连接池配置完全来自连接 URL，参数名与驱动一致：mariadb 用 connectionLimit 等，pg 用 max 等。
import { describe, expect, test } from "bun:test";
import { defaultPoolSize } from "../../src/shared/index.js";
import { mariadbPool } from "../../src/adapters/mysql/driver.js";
import { postgresPool } from "../../src/adapters/postgres/driver.js";
import { sqlite } from "../../src/adapters/sqlite/index.js";

const mysqlURL = (query = "") => {
  return new URL(`mysql://u:p@localhost/app${query}`);
};
const postgresURL = (query = "") => {
  return new URL(`postgresql://u:p@localhost/app${query}`);
};

describe("mariadbPool", () => {
  test("reads the driver names straight from the URL", () => {
    expect(mariadbPool(mysqlURL("?connectionLimit=20&minimumIdle=2&acquireTimeout=5000&idleTimeout=1800"))).toEqual({
      connectionLimit: 20,
      minimumIdle: 2,
      acquireTimeout: 5000,
      idleTimeout: 1800,
    });
  });

  test("defaults connectionLimit to two connections per CPU plus one", () => {
    expect(mariadbPool(mysqlURL())).toEqual({ connectionLimit: defaultPoolSize() });
  });

  test("requires integers and keeps minimumIdle at or below connectionLimit", () => {
    for (const query of ["?connectionLimit=0", "?connectionLimit=2.5", "?minimumIdle=-1", "?acquireTimeout=0", "?idleTimeout=-1"]) {
      expect(() => {
        return mariadbPool(mysqlURL(query));
      }).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    }
    expect(mariadbPool(mysqlURL("?minimumIdle=0&idleTimeout=0"))).toEqual({ connectionLimit: defaultPoolSize(), minimumIdle: 0, idleTimeout: 0 });
    expect(() => {
      return mariadbPool(mysqlURL("?connectionLimit=2&minimumIdle=3"));
    }).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    expect(() => {
      return mariadbPool(mysqlURL(`?minimumIdle=${defaultPoolSize() + 1}`));
    }).toThrow(expect.objectContaining({ code: "VALIDATION" }));
  });
});

describe("postgresPool", () => {
  test("reads the pg names straight from the URL and removes them", () => {
    const source = postgresURL("?max=20&min=2&connectionTimeoutMillis=5000&idleTimeoutMillis=30000&sslmode=require");
    expect(postgresPool(source)).toEqual({ max: 20, min: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
    for (const key of ["max", "min", "connectionTimeoutMillis", "idleTimeoutMillis"]) {
      expect(source.searchParams.has(key)).toBe(false);
    }
    expect(source.searchParams.get("sslmode")).toBe("require");
  });

  test("defaults max to two connections per CPU plus one", () => {
    expect(postgresPool(postgresURL())).toEqual({ max: defaultPoolSize() });
  });

  test("requires integers and keeps min at or below max", () => {
    for (const query of ["?max=0", "?max=2.5", "?min=-1", "?connectionTimeoutMillis=0", "?idleTimeoutMillis=-1"]) {
      expect(() => {
        return postgresPool(postgresURL(query));
      }).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    }
    expect(postgresPool(postgresURL("?min=0&idleTimeoutMillis=0"))).toEqual({ max: defaultPoolSize(), min: 0, idleTimeoutMillis: 0 });
    expect(() => {
      return postgresPool(postgresURL("?max=2&min=3"));
    }).toThrow(expect.objectContaining({ code: "VALIDATION" }));
  });
});

describe("SQLite", () => {
  test("rejects pool options because it has one connection", async () => {
    await expect(
      Promise.resolve().then(() => {
        return sqlite({ connection: "file::memory:", pool: { max: 4 } } as any).connect();
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
