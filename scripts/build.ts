import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { example } from "./example.js";
import { fixtures } from "./fixtures.js";
import { bin, cli, run } from "./lib.js";

const extensionDir = "extensions";
const manifestFile = `${extensionDir}/package.json`;
const extensionOut = `${extensionDir}/dist`;
const vsceBin = "node_modules/@vscode/vsce/vsce";
const artifactFile = "artifacts/tsorm-vscode.vsix";

/** 编译 ORM 到 dist/。tsc 不删除旧产物，先清空目录保证 dist 与源码一致。 */
async function buildOrm(): Promise<void> {
  await rm("dist", { recursive: true, force: true });
  await bin("tsc", "-p", "tsconfig.json");
}

/** 类型检查扩展源码；extensions/tsconfig.json 已设 noEmit，不产出文件。 */
async function typecheckExtension(): Promise<void> {
  await bin("tsc", "-p", `${extensionDir}/tsconfig.json`);
}

/** 扩展只是仓库里的一个扩展：构建依赖装在根项目，复用根的 node_modules；产物用 Bun 自带打包器生成，把跨目录的 src 导入打平成自包含文件。 */
async function bundleExtension(): Promise<void> {
  await rm(extensionOut, { recursive: true, force: true });
  // 单一入口：把 src 和跨目录的 ORM 导入打平成自包含的 extension.cjs，vscode 由运行时提供；minify 压缩体积，消除 vsce 对大文件的提示。
  const result = await Bun.build({
    entrypoints: [`${extensionDir}/src/extension.ts`],
    target: "node",
    format: "cjs",
    external: ["vscode"],
    outdir: extensionOut,
    naming: "[name].cjs",
    minify: true,
  });
  // Bun.build 失败不抛异常，需检查 success 并打印日志。
  if (!result.success) {
    for (const log of result.logs) {
      console.error(log.message ?? log);
    }
    throw new Error("Bun failed to bundle extension entry: extension");
  }
}

/** 扩展版本与 ORM 包版本保持一致，打包前从根 package.json 同步。 */
async function syncVersion(): Promise<void> {
  const { version } = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as Record<string, unknown>;
  if (manifest.version === version) {
    return;
  }
  manifest.version = version;
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
}

/** vsce 要求扩展目录内有 LICENSE 文件（清单声明了 license 字段），从仓库根同步，保持单一来源。 */
async function syncLicense(): Promise<void> {
  await copyFile("LICENSE", `${extensionDir}/LICENSE`);
}

/** 调用 vsce 把扩展目录打包到 artifacts/。 */
async function packageVscode(): Promise<void> {
  await Promise.all([syncVersion(), syncLicense()]);
  await mkdir("artifacts", { recursive: true });
  // vsce 必须在扩展目录里运行，从根 node_modules 取，路径用 ../ 换算过去。
  await run(process.execPath, [`../${vsceBin}`, "package", "--no-dependencies", "--allow-missing-repository", "--out", `../${artifactFile}`], extensionDir);
}

/** 全仓类型检查：除 src 外还覆盖 examples、test/fixtures、scripts 与文档配置，不产出文件。 */
async function typecheckProject(): Promise<void> {
  await bin("tsc", "-p", "tsconfig.types.json");
}

/** 构建文档站点到 docs/.vitepress/dist；死链与锚点错误在这一步暴露。 */
async function buildDocs(): Promise<void> {
  await bin("vitepress", "build", "docs");
}

/** 两个生成的客户端都不入 git，全仓类型检查前必须先生成；模板来自刚编译出的 dist。 */
async function generateClients(): Promise<void> {
  await Promise.all([example([]), fixtures()]);
}

/** 完整构建：编译 ORM 到 dist/，生成示例与测试客户端，类型检查、打包 VS Code 扩展到 artifacts/，并构建文档站点。 */
async function build(): Promise<void> {
  await Promise.all([buildOrm(), typecheckExtension()]);
  await generateClients();
  // 全仓类型检查会解析 scripts 对 dist 声明的引用，必须等 ORM 编译完成；与文档构建并行。
  await Promise.all([typecheckProject(), buildDocs()]);
  await bundleExtension();
  await packageVscode();
}
await cli(import.meta, build);
