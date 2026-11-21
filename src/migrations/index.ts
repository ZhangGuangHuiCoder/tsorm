/**
 * `@ofis/tsorm/migrations` 入口：迁移命令的运行时值与配套类型。
 * 公开符号集合由本文件确定，文档 `docs/reference/client-api.md` 与
 * `test/unit/runtime.test.ts` 的守卫用例以此为准。
 * Entry point for `@ofis/tsorm/migrations`: runtime values and accompanying types for migration commands.
 * This file defines the public symbol set; the guards in `docs/reference/client-api.md` and
 * `test/unit/runtime.test.ts` use it as the source of truth.
 */

// ─── 运行时值：错误类型与命令函数 ──────────────────────────────────────────
export { MigrationError } from "./provider.js";
export { migrate, deploy, status, resolve, diff, push } from "./commands.js";

// ─── 命令选项与结果类型 ────────────────────────────────────────────────────
export type { Prompter, CommandOptions, MigrateResult, StatusResult, DiffSource, DiffResult } from "./commands.js";

// ─── 结构差异与提供者类型 ──────────────────────────────────────────────────
export type { SchemaDiff } from "./diff.js";
export type { MigrationProvider } from "./provider.js";
