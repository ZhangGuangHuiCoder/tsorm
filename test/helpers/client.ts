import { afterAll, beforeAll, beforeEach, describe, expect } from "bun:test";
import { createClient } from "../fixtures/client.js";
import { OrmError } from "../../src/index.js";
import type { ClientEvent } from "../../src/index.js";
import { sandbox, targets, type Sandbox, type Target } from "./databases.js";

/** 测试客户端类型：虚拟字段与全局 omit 均不启用。 */
export type Db = Awaited<ReturnType<typeof createClient>>;

/** 先子表后父表清空所有数据，让每个用例都从空表开始。全表写入统一走 `$clear`。 */
export async function resetData(db: Db): Promise<void> {
  await db.$clear("note", { force: true });
  await db.$clear("attachment", { force: true });
  await db.$clear("comment", { force: true });
  await db.$clear("post", { force: true });
  await db.$clear("profile", { force: true });
  await db.$clear("user", { force: true });
  await db.$clear("tag", { force: true });
  await db.category.updateMany({ where: { id: { gt: 0 } }, data: { parentId: null } });
  await db.$clear("category", { force: true });
  await db.$clear("membership", { force: true });
  await db.$clear("product", { force: true });
  await db.$clear("slot", { force: true });
  await db.$clear("entry", { force: true });
  await db.$clear("account", { force: true });
  await db.$clear("restrictChild", { force: true });
  await db.$clear("restrictParent", { force: true });
  await db.$clear("noActionChild", { force: true });
  await db.$clear("noActionParent", { force: true });
  await db.$clear("keyedChild", { force: true });
  await db.$clear("keyedParent", { force: true });
}

export interface Context {
  target: Target;
  db: Db;
  /** 当前用例开始以来客户端记录的所有事件。 */
  events: ClientEvent[];
  /** 当前用例开始以来所有 `query` 事件的 SQL 文本。 */
  queries(): string[];
}

/**
 * 对每个可用数据库各运行一遍 `body`。每个数据库在整个文件内共用一个沙箱和一个客户端，
 * 每个用例开始前清空所有表。
 */
export function eachDatabase(title: string, body: (ctx: Context) => void): void {
  for (const target of targets) {
    describe(`${title} [${target}]`, () => {
      let box: Sandbox;
      const ctx = { target, events: [] as ClientEvent[] } as Context;
      ctx.queries = () => {
        return ctx.events.flatMap((e) => {
          return e.type === "query" ? [e.sql] : [];
        });
      };
      beforeAll(async () => {
        box = await sandbox(target);
        ctx.db = await createClient({
          adapter: box.adapter(),
          timezone: "+08:00",
          logger: (event) => {
            ctx.events.push(event);
          },
        });
      });
      afterAll(async () => {
        await ctx.db?.$close();
        await box?.dispose();
      });
      beforeEach(async () => {
        await resetData(ctx.db);
        ctx.events.length = 0;
      });
      body(ctx);
    });
  }
}

/** 断言 `promise` 以带有指定 `code` 的 `OrmError` 拒绝，并返回该错误。 */
export async function expectOrmError(promise: Promise<unknown>, code: string): Promise<OrmError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OrmError);
    expect((error as OrmError).code).toBe(code);
    return error as OrmError;
  }
  throw new Error(`Expected OrmError ${code}, but the promise resolved`);
}

/** 创建一个邮箱唯一的用户。 */
export function makeUser(db: Db, data: { email?: string; name?: string | null; age?: number | null } = {}) {
  return db.user.create({
    data: {
      email: data.email ?? `user-${crypto.randomUUID()}@example.com`,
      name: data.name,
      age: data.age,
    },
  });
}
