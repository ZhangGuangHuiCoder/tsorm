import { rm } from "node:fs/promises";
import { cli } from "./lib.js";

/** 构建产物、打包结果与文档缓存，均可由对应命令重新生成。 */
const targets = ["dist", "extensions/dist", "artifacts", "docs/.vitepress/.temp", "docs/.vitepress/cache", "docs/.vitepress/dist"];

/** 并行清理互不依赖的目标。 */
async function clean(): Promise<void> {
  await Promise.all(
    targets.map((target) => {
      return rm(target, { recursive: true, force: true });
    }),
  );
}
await cli(import.meta, clean);
