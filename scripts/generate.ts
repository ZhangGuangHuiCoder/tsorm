import { cli, node } from './lib.js';

/** 由示例模型生成示例客户端，依赖 build 产出的 dist/cli.js。 */
export async function generate() {
  await node('dist/cli.js', 'generate', '--schema', 'examples/schema.orm', '--out', 'examples/client.ts');
}
await cli(import.meta, generate);
