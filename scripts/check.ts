import { build } from './build.js';
import { example } from './example.js';
import { generate } from './generate.js';
import { bunTest, cli, exec } from './lib.js';

/** 提交前的完整检查：构建、生成、类型检查、测试、示例和文档构建。 */
async function check() {
  await build();
  await generate();
  await exec('tsc', '-p', 'tsconfig.types.json');
  // 只跑无外部依赖的套件；mysql/postgres 套件由 bun test 全量运行时按探活自动跳过或执行。
  await bunTest('--timeout=30000', './test/unit', './test/integration', './test/vscode');
  await example(['sqlite']);
  await exec('vitepress', 'build', 'docs');
}
await cli(import.meta, check);
