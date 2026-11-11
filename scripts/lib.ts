import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 所有脚本都以仓库根目录为工作目录，路径一律相对根目录书写。 */
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);

/** 执行命令并继承 stdio；非零退出码转为异常，由 cli 统一打印。 */
export function run(command: string, args: string[], cwd = root): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      return code === 0 ? resolve() : reject(new Error(`${command} exited with ${signal ?? code}`));
    });
  });
}
export const node = (...args: string[]): Promise<void> => {
  return run(process.execPath, args);
};

/** 运行 node_modules/.bin 下的本地可执行文件；不走 bunx，避免解析与联网开销，缺失时提示安装依赖。 */
export async function bin(name: string, ...args: string[]): Promise<void> {
  const command = `node_modules/.bin/${name}`;
  if (!existsSync(command)) {
    throw new Error(`Missing ${command}; run bun install`);
  }
  await run(command, args);
}

/** 作为命令直接运行时执行 task；被其他脚本导入时什么也不做。出错只打印消息并以 1 退出。 */
export async function cli(meta: ImportMeta, task: (args: string[]) => Promise<unknown>) {
  if (!meta.main) {
    return;
  }
  try {
    await task(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
