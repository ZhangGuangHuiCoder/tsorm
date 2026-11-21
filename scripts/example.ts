import { assertBuilt, cli, node } from "./lib.js";

const targets = ["sqlite", "mysql", "pgsql"];

function isTarget(value: string | undefined): value is string {
  return value !== undefined && targets.includes(value);
}

/** 由示例模型生成示例客户端，依赖 build 产出的 dist。测试客户端由 scripts/fixtures.ts 单独生成。 */
async function generate(): Promise<void> {
  assertBuilt("dist/cli.js");
  await node("dist/cli.js", "generate", "--schema", "examples/schema.orm", "--out", "examples/client.ts");
}

/** 唯一入口：先重新生成示例客户端；给出数据库时再运行 examples/demo.ts，省略则只生成。 */
export async function example(args: string[]): Promise<void> {
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
