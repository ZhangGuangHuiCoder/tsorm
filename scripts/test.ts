import { cli, run } from "./lib.js";

const compose = ["compose", "-f", "examples/compose.yaml"];

/** 启动测试数据库并运行测试；失败时打印容器日志，额外参数透传给 bun test。 */
async function test(args: string[]): Promise<void> {
  await run("docker", [...compose, "up", "-d", "--wait"]);
  try {
    await run("bun", ["test", ...args]);
  } catch (error) {
    await run("docker", [...compose, "logs", "--no-color"]).catch(() => {});
    throw error;
  }
}
await cli(import.meta, test);
