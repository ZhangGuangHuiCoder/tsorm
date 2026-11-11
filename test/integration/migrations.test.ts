// 版本化迁移：migrate / deploy / status / resolve / diff / push 的完整流程。
// 每个用例使用独立的沙箱数据库和临时目录。
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploy, diff, migrate, MigrationError, push, resolve, status } from "../../src/migrations/index.js";
import type { CommandOptions } from "../../src/migrations/index.js";
import { sandbox, targets, type Sandbox } from "../helpers/databases.js";

/** 初始模型。 */
const V1 = `
model User {
  id: int @id @auto
  email: string(191) @unique
  posts: Post[] @via(author)
}
model Post {
  id: int @id @auto
  title: string(200)
  author: User
}
`;

/** 新增可空列、带默认值的列和索引。 */
const V2 = `
model User {
  id: int @id @auto
  email: string(191) @unique
  name?: string(100)
  posts: Post[] @via(author)
}
model Post {
  id: int @id @auto
  title: string(200)
  published: boolean = false
  author: User
  @@index(published)
}
`;

/** 在 V2 基础上删除 Post.title；表中有数据时属于数据丢失。 */
const V3 = V2.replace("  title: string(200)\n", "");

async function expectMigrationError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => {
      return undefined;
    },
    (e) => {
      return e;
    },
  );
  expect(error).toBeInstanceOf(MigrationError);
  expect(error.code).toBe(code);
  return error as MigrationError;
}

/** 迁移文件名是秒级时间戳，连续生成迁移前需要等待一秒。 */
const nextSecond = () => {
  return Bun.sleep(1100);
};

for (const target of targets) {
  describe(`migrations [${target}]`, () => {
    let box: Sandbox;
    let dir: string;
    let options: CommandOptions;
    const logs: string[] = [];
    const writeSchema = (text: string) => {
      return writeFileSync(join(dir, "schema.orm"), text);
    };
    const migrationFiles = () => {
      return readdirSync(join(dir, "migrations"))
        .filter((f) => {
          return f.endsWith(".sql");
        })
        .sort();
    };

    beforeEach(async () => {
      box = await sandbox(target);
      dir = mkdtempSync(join(tmpdir(), "tsorm-mig-"));
      logs.length = 0;
      options = {
        url: box.url,
        cwd: dir,
        log: (m) => {
          return void logs.push(m);
        },
      };
      writeSchema(V1);
    });
    afterEach(async () => {
      rmSync(dir, { recursive: true, force: true });
      await box.dispose();
    });

    // migrate 生成首个迁移、执行它并写入锁文件
    test("migrate creates the first migration, applies it and writes the lock file", async () => {
      const result = await migrate({ ...options, name: "init" });
      expect(result.migration).toMatch(/^\d{14}_init$/);
      expect(result.applied).toEqual([result.migration!]);
      expect(migrationFiles()).toEqual([result.migration + ".sql"]);
      const engines: Record<string, string> = {
        sqlite: "sqlite",
        postgres: "postgresql",
        mysql: "mysql",
        mariadb: "mysql",
      };
      expect(readFileSync(join(dir, "migrations", "migration_lock.toml"), "utf8")).toContain(engines[target]);
      const st = await status(options);
      expect(st.exitCode).toBe(0);
      expect(st.applied).toEqual([result.migration!]);
      expect(st.pending).toEqual([]);
    });

    // 模型未变化时 migrate 不生成新文件
    test('migrate reports "already in sync" when the schema did not change', async () => {
      await migrate(options);
      const again = await migrate(options);
      expect(again.migration).toBeUndefined();
      expect(migrationFiles()).toHaveLength(1);
    });

    // 模型变化生成增量迁移，执行后数据库与模型一致
    test("schema changes produce an incremental migration", async () => {
      await migrate({ ...options, name: "init" });
      await nextSecond();
      writeSchema(V2);
      const result = await migrate({ ...options, name: "add name" });
      expect(result.migration).toMatch(/^\d{14}_add_name$/);
      const sql = readFileSync(join(dir, "migrations", result.migration + ".sql"), "utf8");
      expect(sql).toMatch(/name/);
      expect(sql).toMatch(/published/);
      const check = await diff({ ...options, from: "database", to: "schema" });
      expect(check.sql.trim()).toBe("-- This is an empty migration.");
    });

    // createOnly 只生成不执行，deploy 执行待处理迁移
    test("createOnly writes the file without applying it, and deploy applies pending migrations", async () => {
      const created = await migrate({ ...options, createOnly: true });
      expect(created.applied).toEqual([]);
      const pending = await status(options);
      expect(pending.exitCode).toBe(1);
      expect(pending.pending).toEqual([created.migration!]);
      const deployed = await deploy(options);
      expect(deployed.applied).toEqual([created.migration!]);
      expect((await status(options)).exitCode).toBe(0);
      expect((await deploy(options)).applied).toEqual([]);
    });

    // diff --from empty 输出完整建表 SQL，不访问数据库
    test("diff from empty renders the full DDL without touching the database", async () => {
      const result = await diff({ ...options, from: "empty" });
      expect(result.sql).toMatch(/CREATE TABLE/);
      expect(result.sql).toMatch(/User/);
      expect(result.sql).toMatch(/Post/);
    });

    // diff 能发现忘记生成的迁移
    test("diff from migrations detects a forgotten migration", async () => {
      await migrate(options);
      writeSchema(V2);
      const result = await diff(options);
      expect(result.sql.trim()).not.toBe("-- This is an empty migration.");
      expect(result.summary.length).toBeGreaterThan(0);
    });

    // 没有迁移历史的非空数据库，deploy 拒绝执行
    test("deploy refuses a non-empty database without history", async () => {
      await push(options);
      const sql = (await diff({ ...options, from: "empty" })).sql;
      await Bun.write(join(dir, "migrations", "20260101000000_init.sql"), sql);
      await expectMigrationError(deploy(options), "DATABASE_NOT_EMPTY");
    });

    // migrate 检测到漂移，重置前需要确认
    test("migrate detects drift and needs confirmation before resetting", async () => {
      await push(options);
      const error = await expectMigrationError(migrate(options), "NON_INTERACTIVE");
      expect(error.message).toContain("Drift detected");
      const declined = await expectMigrationError(
        migrate({
          ...options,
          prompt: {
            confirm: async () => {
              return false;
            },
          },
        }),
        "ABORTED",
      );
      expect(declined.message.length).toBeGreaterThan(0);
      const accepted = await migrate({
        ...options,
        prompt: {
          confirm: async () => {
            return true;
          },
        },
      });
      expect(accepted.reset).toBeTrue();
      expect((await status(options)).exitCode).toBe(0);
    });

    // 失败的迁移阻塞 deploy，直到用 resolve 处理
    test("a failed migration blocks deploy until resolved", async () => {
      await migrate({ ...options, name: "init" });
      await nextSecond();
      writeSchema(V2);
      const broken = await migrate({ ...options, name: "broken", createOnly: true });
      const file = join(dir, "migrations", broken.migration + ".sql");
      writeFileSync(file, "THIS IS NOT SQL;\n");

      await expectMigrationError(deploy(options), "MIGRATION_FAILED");
      expect((await status(options)).failed).toEqual([broken.migration!]);
      await expectMigrationError(deploy(options), "FAILED_MIGRATIONS");

      await resolve({ ...options, rolledBack: broken.migration });
      rmSync(file);
      await nextSecond();
      const fixed = await migrate({ ...options, name: "fixed" });
      expect(fixed.applied).toContain(fixed.migration!);
      expect((await status(options)).exitCode).toBe(0);
    });

    // resolve 校验参数和迁移名
    test("resolve validates its arguments and migration names", async () => {
      await migrate(options);
      await expectMigrationError(resolve(options), "VALIDATION");
      await expectMigrationError(resolve({ ...options, applied: "a", rolledBack: "b" }), "VALIDATION");
      await expectMigrationError(resolve({ ...options, applied: "20000101000000_missing" }), "MIGRATION_NOT_FOUND");
      const [name] = migrationFiles();
      await expectMigrationError(resolve({ ...options, applied: name.replace(".sql", "") }), "MIGRATION_ALREADY_APPLIED");
    });

    // 用 resolve --applied 为已有数据库建立基线
    test("baselining an existing database with resolve --applied", async () => {
      await push(options);
      const baseline = await diff({ ...options, from: "empty" });
      const fresh = mkdtempSync(join(tmpdir(), "tsorm-mig-"));
      try {
        writeFileSync(join(fresh, "schema.orm"), V1);
        const opts = { ...options, cwd: fresh };
        const migrations = join(fresh, "migrations");
        await Bun.write(join(migrations, "00000000000000_init.sql"), baseline.sql);
        await resolve({ ...opts, applied: "00000000000000_init" });
        expect((await deploy(opts)).applied).toEqual([]);
        expect((await status(opts)).exitCode).toBe(0);
      } finally {
        rmSync(fresh, { recursive: true, force: true });
      }
    });

    // 拒绝不符合命名规则的迁移文件
    test("invalid migration file names are rejected", async () => {
      await migrate(options);
      writeFileSync(join(dir, "migrations", "oops.sql"), "SELECT 1;");
      await expectMigrationError(status(options), "INVALID_MIGRATION_FILE");
    });

    // push 直接同步结构，会丢数据时需要 force
    test("push syncs the schema directly and refuses data loss without force", async () => {
      expect((await push(options)).changed).toBeTrue();
      expect((await push(options)).changed).toBeFalse();
      writeSchema(V2);
      expect((await push(options)).changed).toBeTrue();

      // 先插入数据，使删除有值的列被判定为数据丢失。
      const { createClient } = await import("../../src/index.js");
      const { parseSchema } = await import("../../src/schema/index.js");
      const db = await createClient(parseSchema(V2), { adapter: box.adapter(false) });
      const user = await db.user.create({ data: { email: "keep@x.com" } });
      await db.post.create({ data: { title: "populated", authorId: user.id } });
      await db.$close();

      writeSchema(V3);
      await expectMigrationError(push(options), "DATA_LOSS");
      expect((await push({ ...options, force: true })).changed).toBeTrue();
    });

    // 锁文件固定数据库类型，切换时报 PROVIDER_MISMATCH
    test("the lock file pins the provider", async () => {
      await migrate(options);
      const lock = join(dir, "migrations", "migration_lock.toml");
      const other = target === "sqlite" ? "postgresql" : "sqlite";
      writeFileSync(lock, readFileSync(lock, "utf8").replace(/provider = ".*"/, `provider = "${other}"`));
      await expectMigrationError(status(options), "PROVIDER_MISMATCH");
    });
  });
}

describe("migration options", () => {
  // 影子库地址不能与主库相同
  test("the shadow url must differ from the database url", async () => {
    await expectMigrationError(status({ url: "file:./x.db", shadowDatabaseUrl: "file:./x.db" }), "INVALID_URL");
  });

  // 找不到模型文件时报错
  test("a missing schema file is reported", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tsorm-mig-"));
    try {
      await expectMigrationError(diff({ cwd: dir, from: "empty" }), "SCHEMA_NOT_FOUND");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
