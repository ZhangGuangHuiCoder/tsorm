import { readFileSync, writeFileSync } from "node:fs";
import { assertBuilt, cli } from "./lib.js";

/** 由测试模型生成测试客户端。保持导入 src，让 `bun test` 不需先构建就能断言源码类型；示例客户端由 scripts/example.ts 生成，用包名导入代表消费者。 */
export async function fixtures(): Promise<void> {
  assertBuilt("dist/schema/index.js");
  const { parseSchema, generateClient } = await import("../dist/schema/index.js");
  const schema = parseSchema(readFileSync("test/fixtures/schema.orm", "utf8"));
  writeFileSync("test/fixtures/client.ts", generateClient(schema, "../../src/index.js"));
}
await cli(import.meta, fixtures);
