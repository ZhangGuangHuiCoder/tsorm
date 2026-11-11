#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseSchema, generateClient } from "./schema/index.js";
import { deploy, diff, migrate, push, resolve as resolveMigration, status, type CommandOptions, type DiffSource, type Prompter } from "./migrations/index.js";

const usageEn = `Usage: tsorm <command> [options]

  migrate     Create and apply a migration from schema changes (development)
              --name <name>   --create-only   --reset   --force
  deploy      Apply pending migrations (production)
              --check: only report whether the database is up to date
  resolve     Mark a failed migration: --applied <name> | --rolled-back <name>
  diff        Print the SQL between two sources, default migrations -> schema
              --from migrations|database|empty   --to schema|database   --check
  push        Sync the database with the schema, without migrations
              --reset   --force

  validate    Validate the schema file
  generate    Generate the TypeScript client (--out <file>)

  Run tsorm <command> --help for one command's options.

Options:
  --schema <file>   Schema file, default schema.orm; migrations live next to it
  --force           Skip confirmations and accept data loss

Environment:
  DATABASE_URL          Default file:./dev.db; also postgresql://... or mysql://...
  SHADOW_DATABASE_URL   Optional shadow database for MySQL and PostgreSQL`;

const usageZh = `用法: tsorm <命令> [选项]

  migrate     根据模型变更生成并应用迁移（开发）
              --name <名称>   --create-only   --reset   --force
  deploy      应用待执行的迁移（上线）
              --check: 只检查数据库是否为最新
  resolve     标记失败的迁移: --applied <名称> | --rolled-back <名称>
  diff        输出两份结构之间的 SQL，默认 迁移历史 -> 模型
              --from migrations|database|empty   --to schema|database   --check
  push        不经迁移文件，直接同步数据库结构
              --reset   --force

  validate    校验模型文件
  generate    生成 TypeScript 客户端 (--out <文件>)

  运行 tsorm <命令> --help 查看单个命令的选项。

选项:
  --schema <文件>   模型文件，默认 schema.orm；迁移目录固定在它旁边
  --force           跳过确认，接受数据丢失

环境变量:
  DATABASE_URL          默认 file:./dev.db；也支持 postgresql://... 或 mysql://...
  SHADOW_DATABASE_URL   MySQL 和 PostgreSQL 的可选影子库`;

/** Help follows the system locale; command output and error codes stay English. */
const chinese = () => {
  const locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "";
  if (/^zh([-_.@]|$)/i.test(locale)) {
    return true;
  }
  // An unset or C/POSIX locale carries no language; fall back to the OS locale.
  if (locale && !/^C(\.|$)/i.test(locale) && !/^POSIX$/i.test(locale)) {
    return false;
  }
  if (process.platform === "darwin") {
    // Node's ICU ignores AppleLocale on macOS, so ask the system directly.
    const apple = spawnSync("defaults", ["read", "-g", "AppleLocale"], {
      encoding: "utf8",
      timeout: 2000,
    });
    return apple.status === 0 && /^zh([-_]|$)/i.test((apple.stdout ?? "").trim());
  }
  // Windows ICU reports the OS UI locale when no env locale is set; Linux keeps its en-US default.
  return /^zh([-_]|$)/i.test(Intl.DateTimeFormat().resolvedOptions().locale);
};
const usage = () => {
  return chinese() ? usageZh : usageEn;
};

const commandHelpEn: Record<string, string> = {
  migrate: `Usage: tsorm migrate [options]

  Generate and apply a migration from schema changes (development).
  Production databases use tsorm deploy.

Options:
  --name <name>      Migration slug, default init/update, prefixed with a
                     UTC timestamp YYYYMMDDHHMMSS_
  --create-only      Write the migration file without applying it
  --reset            Drop all data and rebuild from an empty database first
  --force            Skip confirmations and accept data loss
  --schema <file>    Schema file, default schema.orm`,
  deploy: `Usage: tsorm deploy [--check] [--schema <file>]

  Apply pending migrations in timestamp order, without confirmation. A
  failed migration blocks deploy until tsorm resolve handles it.

Options:
  --check            Read-only check; exit 1 when the database is not up to date
  --schema <file>    Schema file, default schema.orm`,
  resolve: `Usage: tsorm resolve (--applied <name> | --rolled-back <name>) [--schema <file>]

  Record a failed migration in the history table. Runs no SQL.
  The name is the migration file name without its .sql extension.

Options:
  --applied <name>         Finished by hand, record as applied
  --rolled-back <name>     Record as rolled back so a later deploy re-applies it
  --schema <file>          Schema file, default schema.orm`,
  diff: `Usage: tsorm diff [--from <source>] [--to <source>] [--check] [--schema <file>]

  Print the SQL between two sources without touching any database.

Options:
  --from <source>    migrations | database | empty, default migrations
  --to <source>      schema | database, default schema
  --check            Print only the summary; exit 2 when there are differences
  --schema <file>    Schema file, default schema.orm`,
  push: `Usage: tsorm push [--reset] [--force] [--schema <file>]

  Sync the database with the schema directly, without migration files.
  Suited to local prototyping; releases use tsorm migrate and deploy.

Options:
  --reset            Drop all data and rebuild before syncing
  --force            Skip confirmations and accept data loss
  --schema <file>    Schema file, default schema.orm`,
  validate: `Usage: tsorm validate [--schema <file>]

  Check the schema file and report the model count.
  Syntax errors include line and column numbers.

Options:
  --schema <file>    Schema file, default schema.orm`,
  generate: `Usage: tsorm generate [--out <file>] [--schema <file>]

  Generate the typed client from the schema file.

Options:
  --out <file>       Output path, default generated/client.ts
  --schema <file>    Schema file, default schema.orm`,
};

const commandHelpZh: Record<string, string> = {
  migrate: `用法: tsorm migrate [选项]

  根据模型变更生成并应用迁移（开发用）。生产数据库请使用 tsorm deploy。

选项:
  --name <名称>      迁移名称 slug，默认 init/update，前缀 UTC 时间戳
                     YYYYMMDDHHMMSS_
  --create-only      只生成迁移文件，不应用
  --reset            应用前清空数据，从空库重建
  --force            跳过确认，接受数据丢失
  --schema <文件>    模型文件，默认 schema.orm`,
  deploy: `用法: tsorm deploy [--check] [--schema <文件>]

  按时间戳顺序应用待执行的迁移，无需确认。存在失败迁移时会被阻止，
  需先用 tsorm resolve 处理。

选项:
  --check            只读检查；数据库不是最新时退出码 1
  --schema <文件>    模型文件，默认 schema.orm`,
  resolve: `用法: tsorm resolve (--applied <名称> | --rolled-back <名称>) [--schema <文件>]

  修改失败迁移的历史记录，不执行任何 SQL。
  名称为去掉 .sql 扩展名的迁移文件名。

选项:
  --applied <名称>         已手动补完，标记为已应用
  --rolled-back <名称>     标记为已回滚，供后续 deploy 重新应用
  --schema <文件>          模型文件，默认 schema.orm`,
  diff: `用法: tsorm diff [--from <来源>] [--to <来源>] [--check] [--schema <文件>]

  输出两份结构之间的 SQL，不改动任何数据库。

选项:
  --from <来源>      migrations | database | empty，默认 migrations
  --to <来源>        schema | database，默认 schema
  --check            只输出摘要；有差异时退出码 2
  --schema <文件>    模型文件，默认 schema.orm`,
  push: `用法: tsorm push [--reset] [--force] [--schema <文件>]

  不经迁移文件，直接把数据库同步到与模型一致，适合本地原型验证；
  上线请使用 tsorm migrate 和 deploy。

选项:
  --reset            同步前清空数据库重建
  --force            跳过确认，接受数据丢失
  --schema <文件>    模型文件，默认 schema.orm`,
  validate: `用法: tsorm validate [--schema <文件>]

  校验模型文件并报告模型数量，语法错误会带上行号和列号。

选项:
  --schema <文件>    模型文件，默认 schema.orm`,
  generate: `用法: tsorm generate [--out <文件>] [--schema <文件>]

  根据模型文件生成类型安全的客户端。

选项:
  --out <文件>       输出路径，默认 generated/client.ts
  --schema <文件>    模型文件，默认 schema.orm`,
};

/** Per-command help for `tsorm <command> --help`; falls back to the global usage. */
const commandHelp = (command: string) => {
  const table = chinese() ? commandHelpZh : commandHelpEn;
  return table[command] ?? usage();
};

const valued = ["--schema", "--name", "--applied", "--rolled-back", "--from", "--to", "--out"];
const flags: Record<string, string[]> = {
  migrate: ["--schema", "--name", "--create-only", "--reset", "--force"],
  deploy: ["--schema", "--check"],
  resolve: ["--schema", "--applied", "--rolled-back"],
  diff: ["--schema", "--from", "--to", "--check"],
  push: ["--schema", "--reset", "--force"],
  validate: ["--schema"],
  generate: ["--schema", "--out"],
};

/** Parses `--flag value`, `--flag=value` and boolean flags, rejecting unknown ones. */
function parseArgs(command: string, args: string[]) {
  const values = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const [name, inline] = args[i].split(/=(.*)/s, 2);
    if (!flags[command].includes(name)) {
      throw Error(`Unknown option ${args[i]}\n\n${usage()}`);
    }
    if (!valued.includes(name)) {
      if (inline !== undefined) {
        throw Error(`${name} does not accept a value`);
      }
      values.set(name, true);
      continue;
    }
    const value = inline ?? args[++i];
    if (value === undefined || value.startsWith("--")) {
      throw Error(`Missing value for ${name}`);
    }
    values.set(name, value);
  }
  return {
    get: (name: string) => {
      const v = values.get(name);
      return typeof v === "string" ? v : undefined;
    },
    has: (name: string) => {
      return values.has(name);
    },
  };
}

const interactive = () => {
  return !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI;
};
const prompter = (): Prompter | undefined => {
  return interactive()
    ? {
        async confirm(message) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            return /^y(es)?$/i.test((await rl.question(`${message} › (y/N) `)).trim());
          } finally {
            rl.close();
          }
        },
      }
    : undefined;
};

const source = (value: string | undefined, allowed: DiffSource[], name: string) => {
  if (value !== undefined && !allowed.includes(value as DiffSource)) {
    throw Error(`${name} must be ${allowed.join(", ")}`);
  }
  return value as DiffSource | undefined;
};

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const log = (message: string) => {
    return console.log(message);
  };
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return command ? 0 : 1;
  }
  if (!flags[command]) {
    throw Error(`Unknown command ${command}\n\n${usage()}`);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(commandHelp(command));
    return 0;
  }
  const options = parseArgs(command, args);
  if (command === "validate" || command === "generate") {
    const path = resolve(options.get("--schema") ?? "schema.orm");
    const schema = parseSchema(readFileSync(path, "utf8"));
    if (command === "validate") {
      log(`The schema at ${relative(process.cwd(), path)} is valid: ${Object.keys(schema.tables).length} models`);
      return 0;
    }
    if (command === "generate") {
      const output = resolve(options.get("--out") ?? "generated/client.ts");
      mkdirSync(dirname(output), { recursive: true });
      // 运行时固定用包名导入：与生成文件的位置无关，走包的 exports 解析。
      writeFileSync(output, generateClient(schema));
      log(output);
      return 0;
    }
  }
  const base: CommandOptions = {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
    schema: options.get("--schema"),
    force: options.has("--force"),
    prompt: prompter(),
    log,
  };
  switch (command) {
    case "migrate":
      await migrate({
        ...base,
        name: options.get("--name"),
        createOnly: options.has("--create-only"),
        reset: options.has("--reset"),
      });
      return 0;
    case "deploy": {
      if (!options.has("--check")) {
        await deploy(base);
        return 0;
      }
      const result = await status(base);
      log(result.message);
      return result.exitCode;
    }
    case "resolve":
      await resolveMigration({
        ...base,
        applied: options.get("--applied"),
        rolledBack: options.get("--rolled-back"),
      });
      return 0;
    case "diff": {
      const result = await diff({
        ...base,
        from: source(options.get("--from"), ["migrations", "database", "empty"], "--from"),
        to: source(options.get("--to"), ["schema", "database"], "--to"),
      });
      if (!options.has("--check")) {
        process.stdout.write(result.sql);
        return 0;
      }
      process.stdout.write(result.summary);
      return result.diff.empty ? 0 : 2;
    }
    default:
      await push({ ...base, reset: options.has("--reset") });
      return 0;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const code = (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : String(error);
  console.error(typeof code === "string" && /^[A-Z_]+$/.test(code) ? `Error: ${code}\n\n${message}` : message);
  process.exitCode = 1;
}
