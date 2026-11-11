import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cli, node } from "./lib.js";

const targets = ["sqlite", "mysql", "pgsql"];

/** 生成用的模板来自构建产物，不是 src 源码。 */
const artifacts = ["dist/cli.js", "dist/schema/index.js"];

function isTarget(value: string | undefined): value is string {
  return value !== undefined && targets.includes(value);
}

/** 缺失产物时直接失败，避免用上一次构建的旧签名重新生成客户端。 */
function assertBuilt(): void {
  const missing = artifacts.filter((file) => {
    return !existsSync(file);
  });
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}; run bun run build first`);
  }
}

/** 由示例模型生成示例客户端与测试客户端，依赖 build 产出的 dist。 */
async function generate(): Promise<void> {
  assertBuilt();
  await node("dist/cli.js", "generate", "--schema", "examples/schema.orm", "--out", "examples/client.ts");
  // 测试客户端保持导入 src，让 `bun test` 不需先构建就能断言源码类型；examples/client.ts 则用默认的包名导入，代表消费者。
  const { parseSchema, generateClient } = await import("../dist/schema/index.js");
  const schema = parseSchema(readFileSync("test/fixtures/schema.orm", "utf8"));
  writeFileSync("test/fixtures/client.ts", generateClient(schema, "../../src/index.js"));
}

/** 唯一入口：先重新生成客户端；给出数据库时再运行 examples/demo.ts，省略则只生成。 */
async function example(args: string[]): Promise<void> {
  const [database] = args;
  if (database !== undefined && !isTarget(database)) {
    throw new Error(`Use bun run example [${targets.join("|")}]`);
  }
  await generate();
  if (database) {
    await node("examples/demo.ts", database);
  }
}
await cli(import.meta, example);
