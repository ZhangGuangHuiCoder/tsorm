import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 所有脚本都以仓库根目录为工作目录，路径一律相对根目录书写。 */
export const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);

export function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${signal ?? code}`)),
    );
  });
}
export const node = (...args) => run(process.execPath, args);
export const exec = (command, ...args) => run('bunx', [command, ...args]);
/** bun 内置测试运行器；--isolate 保证每个测试文件独立模块注册表（vi.mock 等价物不跨文件泄漏）。 */
export const bunTest = (...args) => run('bun', ['test', '--isolate', ...args]);

/** 作为命令直接运行时执行 task；被其他脚本导入时什么也不做。出错只打印消息并以 1 退出。 */
export async function cli(meta, task) {
  if (!meta.main) return;
  try {
    await task(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
