import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { example } from "./example.js";
import { fixtures } from "./fixtures.js";
import { bin, cli, run } from "./lib.js";

const extensionDir = "extensions";
const manifestFile = `${extensionDir}/package.json`;
const extensionOut = `${extensionDir}/dist`;
const vsceBin = "node_modules/@vscode/vsce/vsce";
const artifactFile = "artifacts/tsorm-vscode.vsix";

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

/** 调用 vsce 把扩展目录打包到 artifacts/。 */
async function packageVscode(): Promise<void> {
  // vsce 要求扩展目录内有 LICENSE；从仓库根同步，保持单一来源。
  await Promise.all([syncVersion(), copyFile("LICENSE", `${extensionDir}/LICENSE`)]);
  await mkdir("artifacts", { recursive: true });
  // vsce 必须在扩展目录里运行，从根 node_modules 取，路径用 ../ 换算过去。
  await run(process.execPath, [`../${vsceBin}`, "package", "--no-dependencies", "--out", `../${artifactFile}`], extensionDir);
}

/** 两个生成的客户端都不入 git，全仓类型检查前必须先生成；模板来自刚编译出的 dist。 */
async function generateClients(): Promise<void> {
  await Promise.all([example([]), fixtures()]);
}

/** 完整构建：编译 ORM 与扩展类型检查、生成客户端、全仓类型检查与文档、打包扩展。 */
async function build(): Promise<void> {
  // tsc 不删除旧产物，先清空 dist 保证与源码一致；扩展类型检查不产出文件。
  await rm("dist", { recursive: true, force: true });
  await Promise.all([bin("tsc", "-p", "tsconfig.json"), bin("tsc", "-p", `${extensionDir}/tsconfig.json`)]);
  await generateClients();
  // 全仓类型检查会解析 scripts 对 dist 声明的引用，文档构建顺带校验死链与锚点。
  await Promise.all([bin("tsc", "-p", "tsconfig.types.json"), bin("vitepress", "build", "docs")]);
  await bundleExtension();
  await packageVscode();
}
await cli(import.meta, build);
