import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { cli, run } from "./lib.js";

/** 捕获命令输出；读取 git 分支、状态与已有标签，不能继承 stdio。 */
function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/** 按 patch|minor|major 递增，或直接接受显式的 x.y.z 版本。 */
function nextVersion(current: string, spec: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) {
    throw new Error(`package.json 版本格式无效: ${current}`);
  }
  if (/^\d+\.\d+\.\d+$/.test(spec)) {
    return spec;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (spec === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }
  if (spec === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  if (spec === "major") {
    return `${major + 1}.0.0`;
  }
  throw new Error(`未知的版本级别: ${spec}，可用 patch、minor、major 或 x.y.z`);
}

/** 只改写 version，其余字段与两空格缩进保持不变。 */
async function bumpVersion(version: string): Promise<void> {
  const text = await readFile("package.json", "utf8");
  const manifest = JSON.parse(text) as Record<string, unknown>;
  manifest.version = version;
  await writeFile("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
}

/** 提升版本、构建校验、提交并打标签推送；标签推送后由 CI 发布 npm 包与 Release。 */
async function release(args: string[]): Promise<void> {
  if (args.length > 1) {
    throw new Error("用法: bun run release [patch|minor|major|x.y.z]");
  }
  const branch = await capture("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    throw new Error(`必须在 main 分支发布，当前分支: ${branch}`);
  }
  if (await capture("git", ["status", "--porcelain"])) {
    throw new Error("工作区有未提交的改动，请先提交后再发布");
  }

  const manifest = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
  const version = nextVersion(manifest.version, args[0] ?? "patch");
  const tag = `v${version}`;
  if (await capture("git", ["tag", "--list", tag])) {
    throw new Error(`标签 ${tag} 已存在`);
  }

  console.log(`发布 ${manifest.version} -> ${version}`);
  await bumpVersion(version);
  // 构建顺带把版本同步到扩展清单，并在打标签前暴露类型检查与文档构建的错误。
  await run("bun", ["run", "build"]);
  await run("git", ["add", "package.json", "extensions/package.json"]);
  await run("git", ["commit", "-m", `chore: release ${tag}`]);
  await run("git", ["tag", tag]);
  await run("git", ["push", "origin", "main"]);
  await run("git", ["push", "origin", tag]);
  console.log(`已推送 ${tag}，CI 将发布 npm 包与 GitHub Release`);
}

await cli(import.meta, release);
