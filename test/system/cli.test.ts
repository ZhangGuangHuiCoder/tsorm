// 命令行：全部命令的行为与退出码（validate / generate / migrate / deploy / resolve / diff / push）。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = new URL("../../src/cli.ts", import.meta.url).pathname;

/** 初始模型。 */
const V1 = "model Note {\n  id: int @id @auto\n  text: string\n}\n";
/** 在 V1 基础上新增一列。 */
const V2 = "model Note {\n  id: int @id @auto\n  text: string\n  done: boolean = false\n}\n";
let dir: string;
const workdirs: string[] = [];

/** 为迁移流程建立独立的临时目录，模型固定为 V1。 */
function workdir() {
  const d = mkdtempSync(join(tmpdir(), "tsorm-cli-mig-"));
  workdirs.push(d);
  writeFileSync(join(d, "schema.orm"), V1);
  return d;
}

/** 在 `cwd`（默认 `dir`）中运行 CLI：先清除可能干扰的环境变量并固定英文 locale（避开 macOS 系统语言回退），再叠加 `env`。 */
function run(args: string[], env: Record<string, string> = {}, cwd = dir) {
  const base = { ...process.env };
  for (const key of ["DATABASE_URL", "CI", "LC_ALL", "LC_MESSAGES", "LANG"]) {
    delete base[key];
  }
  const result = Bun.spawnSync(["bun", cli, ...args], {
    cwd,
    env: { ...base, LANG: "en_US.UTF-8", ...env },
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tsorm-cli-"));
  writeFileSync(join(dir, "schema.orm"), V1);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const d of workdirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("cli", () => {
  // validate 接受合法模型，错误时给出位置
  test("validate accepts a valid schema and reports errors with positions", () => {
    expect(run(["validate"]).code).toBe(0);
    writeFileSync(join(dir, "bad.orm"), "model Bad {\n  id int @id\n}\n");
    const bad = run(["validate", "--schema", "bad.orm"]);
    expect(bad.code).not.toBe(0);
    expect(bad.stderr + bad.stdout).toMatch(/2:\d+/);
  });

  // generate 生成客户端文件
  test("generate writes a client", () => {
    expect(run(["generate", "--out", "client.ts"]).code).toBe(0);
    expect(readFileSync(join(dir, "client.ts"), "utf8")).toContain("export type NoteRow");
  });

  // diff --from empty 输出建表 SQL
  test("diff --from empty prints DDL", () => {
    const result = run(["diff", "--from", "empty"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('CREATE TABLE "Note"');
  });

  // 拒绝未知命令和未知选项
  test("unknown commands and options are rejected", () => {
    expect(run(["explode"]).code).not.toBe(0);
    expect(run(["deploy", "--nope"]).code).not.toBe(0);
  });
});

describe("cli migrations", () => {
  // --help / -h 输出用法；无命令时以退出码 1 显示用法；命令后跟 --help 输出子命令帮助
  test("--help prints usage", () => {
    const help = run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage: tsorm");
    expect(run(["-h"]).code).toBe(0);
    expect(run(["migrate", "--help"]).stdout).toContain("Usage: tsorm migrate");
    expect(run(["migrate", "--help"]).code).toBe(0);
    expect(run([]).code).toBe(1);
  });

  // 帮助跟随系统 locale：zh 开头输出中文用法，其余保持英文；C/POSIX 在 macOS 回退系统语言，结果随环境而定，只断言正常退出
  test("--help follows the system locale", () => {
    const zh = run(["--help"], { LANG: "zh_CN.UTF-8" });
    expect(zh.code).toBe(0);
    expect(zh.stdout).toContain("用法: tsorm");
    expect(run(["--help"], { LANG: "en_US.UTF-8" }).stdout).toContain("Usage: tsorm");
    expect(run(["--help"], { LC_ALL: "zh" }).stdout).toContain("用法: tsorm");
    expect(run(["migrate", "--help"], { LANG: "zh_CN.UTF-8" }).stdout).toContain("用法: tsorm migrate");
    expect(run(["--help"], { LANG: "C.UTF-8" }).code).toBe(0);
  });

  // migrate 读取 DATABASE_URL 建库并应用迁移；--create-only 只生成，由 deploy 应用
  test("migrate reads DATABASE_URL and deploy applies pending migrations", async () => {
    const d = workdir();
    const env = { DATABASE_URL: "file:./app.db" };
    expect(run(["migrate", "--name", "init"], env, d).code).toBe(0);
    expect(existsSync(join(d, "app.db"))).toBeTrue();
    expect(
      readdirSync(join(d, "migrations")).filter((f) => {
        return f.endsWith(".sql");
      }),
    ).toHaveLength(1);
    writeFileSync(join(d, "schema.orm"), V2);
    // 迁移文件名是秒级时间戳，连续生成迁移前需要等待一秒
    await Bun.sleep(1100);
    expect(run(["migrate", "--create-only"], env, d).code).toBe(0);
    const pending = run(["deploy", "--check"], env, d);
    expect(pending.code).toBe(1);
    expect(pending.stdout).toContain("not yet been applied");
    expect(run(["deploy"], env, d).code).toBe(0);
    expect(run(["deploy", "--check"], env, d).code).toBe(0);
    expect(run(["diff", "--check"], env, d).code).toBe(0);
  });

  // diff --check 在模型领先于迁移时退出码 2，一致时退出码 0
  test("diff --check exits 2 when the schema is ahead of the migrations", () => {
    const d = workdir();
    const env = { DATABASE_URL: "file:./drift.db" };
    expect(run(["migrate"], env, d).code).toBe(0);
    expect(run(["diff", "--check"], env, d).code).toBe(0);
    writeFileSync(join(d, "schema.orm"), V2);
    expect(run(["diff", "--check"], env, d).code).toBe(2);
  });

  // 非交互环境中，migrate --reset 报 NON_INTERACTIVE，--force 跳过确认
  test("migrate --reset needs --force outside a terminal", () => {
    const d = workdir();
    const env = { DATABASE_URL: "file:./reset.db", CI: "1" };
    expect(run(["migrate"], env, d).code).toBe(0);
    const denied = run(["migrate", "--reset"], env, d);
    expect(denied.code).toBe(1);
    expect(denied.stderr).toContain("Error: NON_INTERACTIVE");
    expect(run(["migrate", "--reset", "--force"], env, d).code).toBe(0);
  });

  // resolve --applied 为已有数据库建立基线；缺少参数时报 VALIDATION
  test("resolve --applied baselines an existing database", () => {
    const d = workdir();
    const env = { DATABASE_URL: "file:./baseline.db" };
    expect(run(["push"], env, d).code).toBe(0);
    const ddl = run(["diff", "--from", "empty"], env, d);
    expect(ddl.code).toBe(0);
    mkdirSync(join(d, "migrations"));
    writeFileSync(join(d, "migrations", "00000000000000_init.sql"), ddl.stdout);
    const marked = run(["resolve", "--applied", "00000000000000_init"], env, d);
    expect(marked.code).toBe(0);
    expect(marked.stdout).toContain("marked as applied");
    expect(run(["deploy", "--check"], env, d).code).toBe(0);
    expect(run(["resolve"], env, d).code).toBe(1);
  });

  // push 直接同步结构，重复执行提示已同步
  test("push syncs the database directly", () => {
    const d = workdir();
    const env = { DATABASE_URL: "file:./push.db" };
    const first = run(["push"], env, d);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("now in sync with your schema");
    const second = run(["push"], env, d);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("already in sync with the schema");
  });

  // --schema 指定模型文件，迁移目录固定在它旁边
  test("--schema places migrations next to the schema file", () => {
    const d = workdir();
    mkdirSync(join(d, "sub"));
    writeFileSync(join(d, "sub", "schema.orm"), V1);
    const env = { DATABASE_URL: "file:./app.db" };
    expect(run(["migrate", "--schema", "sub/schema.orm"], env, d).code).toBe(0);
    expect(existsSync(join(d, "sub", "migrations"))).toBeTrue();
  });

  // 缺少值和非法的 --from 直接报错
  test("missing values and invalid sources are rejected", () => {
    const missing = run(["migrate", "--name"]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("Missing value for --name");
    const from = run(["diff", "--from", "bogus"]);
    expect(from.code).toBe(1);
    expect(from.stderr).toContain("--from must be");
  });
});
