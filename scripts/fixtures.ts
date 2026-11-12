import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cli } from "./lib.js";

/** 生成用的模板来自构建产物，不是 src 源码；缺失时直接失败，避免用上一次构建的旧签名重新生成客户端。 */
function assertBuilt(): void {
  if (!existsSync("dist/schema/index.js")) {
    throw new Error("Missing dist/schema/index.js; run bun run build first");
  }
}

/** 由测试模型生成测试客户端。保持导入 src，让 `bun test` 不需先构建就能断言源码类型；示例客户端由 scripts/example.ts 生成，用包名导入代表消费者。 */
export async function fixtures(): Promise<void> {
  assertBuilt();
  const { parseSchema, generateClient } = await import("../dist/schema/index.js");
  const schema = parseSchema(readFileSync("test/fixtures/schema.orm", "utf8"));
  writeFileSync("test/fixtures/client.ts", generateClient(schema, "../../src/index.js"));
}
await cli(import.meta, fixtures);