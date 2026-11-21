import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mariadb, { type PoolConfig as MariaPoolConfig } from "mariadb";
import pg from "pg";
import { mysql, mysqlSchemaSQL } from "../../src/adapters/mysql/index.js";
import { postgres, postgresSchemaSQL } from "../../src/adapters/postgres/index.js";
import { sqlite, sqliteSchemaSQL } from "../../src/adapters/sqlite/index.js";
import { parseSchema, type Schema } from "../../src/schema/index.js";
import type { Adapter } from "../../src/index.js";

/**
 * 集成测试要运行的数据库。
 *
 * SQLite 总会运行；服务端数据库来自 `examples/compose.yaml`，可连接时自动加入。
 * 用 `TEST_DATABASES=sqlite,postgres` 显式指定；显式列出却连不上的数据库会让测试失败，
 * 而不是被静默跳过。
 */
export type Target = "sqlite" | "postgres" | "mysql" | "mariadb";

const env = process.env;

let fixture: Schema | undefined;
const fixtureSchema = (): Schema => {
  return (fixture ??= parseSchema(readFileSync("test/fixtures/schema.orm", "utf8")));
};

/** 连接后按模型建表的适配器（适配器本身不提供建表能力，测试自行准备）。 */
export function initialized(adapter: Adapter, schema: Schema = fixtureSchema()): Adapter {
  const ddl = { sqlite: sqliteSchemaSQL, postgres: postgresSchemaSQL, mysql: mysqlSchemaSQL }[adapter.name as "sqlite"];
  return {
    name: adapter.name,
    dialect: adapter.dialect,
    capabilities: adapter.capabilities,
    translate: adapter.translate,
    connect: async () => {
      const runtime = await adapter.connect();
      try {
        const session = await runtime.acquire();
        try {
          for (const text of ddl(schema)) {
            await session.execute({ text, values: [] });
          }
        } finally {
          await session.release();
        }
      } catch (error) {
        await runtime.close();
        throw error;
      }
      return runtime;
    },
  };
}

const pgConfig = (database = env.PGDATABASE ?? "test_database"): pg.PoolConfig => {
  return {
    host: env.PGHOST ?? "127.0.0.1",
    port: Number(env.PGPORT ?? 5433),
    user: env.PGUSER ?? "postgres",
    password: env.PGPASSWORD ?? "test_password",
    database,
    connectionTimeoutMillis: 2000,
    max: 5,
  };
};

const mysqlConfig = (target: "mysql" | "mariadb", database?: string): MariaPoolConfig => {
  return {
    host: env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(target === "mysql" ? (env.MYSQL_PORT ?? 3307) : (env.MARIADB_PORT ?? 3308)),
    user: env.MYSQL_USER ?? "root",
    password: env.MYSQL_PASSWORD ?? "test_password",
    database,
    allowPublicKeyRetrieval: true,
    connectTimeout: 2000,
    connectionLimit: 5,
  };
};

/** 尝试连接一次，判断数据库是否可用。 */
async function reachable(target: Target): Promise<boolean> {
  try {
    if (target === "postgres") {
      const client = new pg.Client(pgConfig());
      await client.connect();
      await client.end();
    } else if (target !== "sqlite") {
      const conn = await mariadb.createConnection(mysqlConfig(target));
      await conn.end();
    }
    return true;
  } catch {
    return false;
  }
}

/** Validate explicit targets before any server probing or sandbox creation. */
export function parseTargets(value: string | undefined): Target[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const selected = value
    .split(",")
    .map((item) => {
      return item.trim();
    })
    .filter(Boolean);
  const allowed: Target[] = ["sqlite", "postgres", "mysql", "mariadb"];
  if (
    !selected.length ||
    selected.some((item) => {
      return !allowed.includes(item as Target);
    })
  ) {
    throw new Error("TEST_DATABASES must list sqlite, postgres, mysql or mariadb");
  }
  return [...new Set(selected)] as Target[];
}

/** 按环境变量或连通性探测，决定本次运行的目标数据库。 */
async function detect(): Promise<Target[]> {
  const requested = parseTargets(env.TEST_DATABASES);
  if (requested) {
    for (const target of requested) {
      if (!(await reachable(target))) {
        throw new Error(`TEST_DATABASES lists ${target}, but it is unreachable`);
      }
    }
    return requested;
  }
  const servers: Target[] = ["postgres", "mysql", "mariadb"];
  const found = await Promise.all(servers.map(reachable));
  return [
    "sqlite",
    ...servers.filter((_, i) => {
      return found[i];
    }),
  ];
}

export const targets: Target[] = await detect();

/** 随机的沙箱名，避免并行运行或残留数据互相干扰。 */
const uniqueName = () => {
  return "tsorm_t_" + randomBytes(6).toString("hex");
};

/** 供单个测试文件使用的隔离空数据库（PostgreSQL 下是一个独立 schema）。 */
export interface Sandbox {
  target: Target;
  /** 创建指向沙箱的适配器；传 `Schema` 按该模型建表；为真（默认）时按 fixture 模型建表；为 `false` 时不建表。 */
  adapter(initialize?: boolean | Schema): Adapter;
  /** 指向同一沙箱的迁移工具 URL。 */
  url: string;
  dispose(): Promise<void>;
}

/** 创建沙箱：SQLite 用临时文件，PostgreSQL 建 schema，MySQL / MariaDB 建库。 */
export async function sandbox(target: Target): Promise<Sandbox> {
  const name = uniqueName();
  if (target === "sqlite") {
    const dir = mkdtempSync(join(tmpdir(), "tsorm-test-"));
    const filename = join(dir, name + ".db");
    return {
      target,
      adapter: (initialize: boolean | Schema = true) => {
        const adapter = sqlite({ connection: "file:" + filename });
        return initialize === false ? adapter : initialized(adapter, initialize === true ? undefined : initialize);
      },
      url: "file:" + filename,
      dispose: async () => {
        return rmSync(dir, { recursive: true, force: true });
      },
    };
  }
  if (target === "postgres") {
    const admin = new pg.Client(pgConfig());
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${name}"`);
    await admin.end();
    const c = pgConfig();
    return {
      target,
      adapter: (initialize: boolean | Schema = true) => {
        const adapter = postgres({
          connection: `postgresql://${encodeURIComponent(String(c.user))}:${encodeURIComponent(String(c.password))}@${c.host}:${c.port}/${c.database}?schema=${name}`,
        });
        return initialize === false ? adapter : initialized(adapter, initialize === true ? undefined : initialize);
      },
      url: `postgresql://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}?schema=${name}`,
      dispose: async () => {
        const client = new pg.Client(pgConfig());
        await client.connect();
        await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
        await client.end();
      },
    };
  }
  const admin = await mariadb.createConnection(mysqlConfig(target));
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  await admin.end();
  const c = mysqlConfig(target);
  return {
    target,
    adapter: (initialize: boolean | Schema = true) => {
      const adapter = mysql({
        connection: `mysql://${encodeURIComponent(String(c.user))}:${encodeURIComponent(String(c.password))}@${c.host}:${c.port}/${name}?allowPublicKeyRetrieval=true`,
      });
      return initialize === false ? adapter : initialized(adapter, initialize === true ? undefined : initialize);
    },
    url: `mysql://${c.user}:${c.password}@${c.host}:${c.port}/${name}?allowPublicKeyRetrieval=true`,
    dispose: async () => {
      const conn = await mariadb.createConnection(mysqlConfig(target));
      await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await conn.end();
    },
  };
}
