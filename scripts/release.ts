import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { cli, run } from "./lib.js";

/** 按 patch|minor|major 递增版本号。 */
function bump(version: string, level: string): string {
  const [major, minor, patch] = version.split(".").map(Number);
  if (level === "major") {
    return `${major + 1}.0.0`;
  }
  if (level === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  if (level === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }
  throw new Error(`未知的版本级别: ${level}，可用 patch、minor 或 major`);
}

/** 不传参数直接发 package.json 当前版本，传 patch|minor|major 则先递增并提交，再打标签推送。 */
await cli(import.meta, async (args) => {
  // 未提交的改动不会进标签，发出去的就是旧代码，直接拒绝。
  if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) {
    throw new Error("工作区有未提交的改动，请先提交后再发布");
  }
  const text = await readFile("package.json", "utf8");
  const { version } = JSON.parse(text) as { version: string };
  const next = args[0] ? bump(version, args[0]) : version;
  if (next !== version) {
    await writeFile("package.json", text.replace(`"version": "${version}"`, `"version": "${next}"`));
    await run("git", ["commit", "-am", `chore: release v${next}`]);
  }
  const tag = `v${next}`;
  await run("git", ["tag", tag]);
  await run("git", ["push", "origin", "main", tag]);
});
