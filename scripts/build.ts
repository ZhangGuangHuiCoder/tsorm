import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { cli, exec, run } from './lib.js';

const extensionDir = 'extensions';
const manifestFile = extensionDir + '/package.json';

async function buildOrm() {
  await rm('dist', { recursive: true, force: true });
  await exec('tsc', '-p', 'tsconfig.json');
}
/** 扩展只是仓库里的一个扩展：构建依赖装在根项目，复用根的 node_modules；产物用 Bun 自带打包器生成，把跨目录的 src 导入打平成自包含文件。 */
export async function buildVscode() {
  await exec('tsc', '-p', extensionDir + '/tsconfig.json');
  await rm(extensionDir + '/dist', { recursive: true, force: true });
  // 单一入口：把 src 和跨目录的 ORM 导入打平成自包含的 extension.cjs，vscode 由运行时提供；minify 压缩体积，消除 vsce 对大文件的提示。
  const result = await Bun.build({
    entrypoints: [`${extensionDir}/src/extension.ts`],
    target: 'node',
    format: 'cjs',
    external: ['vscode'],
    outdir: extensionDir + '/dist',
    naming: '[name].cjs',
    minify: true,
  });
  // Bun.build 失败不抛异常，需检查 success 并打印日志。
  if (!result.success) {
    for (const log of result.logs) console.error(log.message ?? log);
    throw new Error('Bun failed to bundle extension entry: extension');
  }
}
/** 扩展版本与 ORM 包版本保持一致，打包前从根 package.json 同步。 */
async function syncVersion() {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (manifest.version === version) return;
  manifest.version = version;
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
}
/** 构建 VS Code 扩展并打包到 artifacts/tsorm-vscode.vsix。 */
async function packageVscode() {
  await syncVersion();
  // vsce 要求扩展目录内有 LICENSE 文件（声明了 license 字段），从仓库根同步，保持单一来源。
  await copyFile('LICENSE', extensionDir + '/LICENSE');
  await buildVscode();
  await mkdir('artifacts', { recursive: true });
  const vsce = 'node_modules/@vscode/vsce/vsce';
  const out = 'artifacts/tsorm-vscode.vsix';
  // vsce 必须在扩展目录里运行，从根 node_modules 取，路径用 ../ 换算过去。
  await run(
    process.execPath,
    ['../' + vsce, 'package', '--no-dependencies', '--allow-missing-repository', '--out', '../' + out],
    extensionDir,
  );
}
/** 完整构建：编译 ORM 到 dist/，并把 VS Code 扩展打包到 artifacts/。 */
export async function build() {
  await buildOrm();
  await packageVscode();
}
await cli(import.meta, build);
