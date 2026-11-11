// 生成客户端类型的编译期检查，由 `tsc -p tsconfig.types.json` 校验，不会被执行。
// 每个 @ts-expect-error 下一行都必须编译失败，否则 tsc 会报告该指令未被使用。
import { createClient, type PostRow, type UserRow } from "../fixtures/client.ts";
import { sqlite } from "../../src/adapters/sqlite/index.ts";
import type { DateTime } from "../../src/index.ts";

/** 双向可赋值即视为相等；能容忍生成类型中的交叉类型写法。 */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const assert = <T extends true>() => {
  return undefined as unknown as T;
};

export async function checks() {
  const db = await createClient({ adapter: sqlite() });

  // 完整记录的字段类型
  const user = await db.user.findUniqueOrThrow({ where: { id: 1 } });
  assert<Equal<typeof user.name, string | null>>();
  assert<Equal<typeof user.role, "admin" | "member">>();
  assert<Equal<typeof user.createdAt, DateTime>>();
  const maybe = await db.user.findUnique({ where: { email: "a" } });
  assert<Equal<typeof maybe, UserRow | null>>();

  // select 收窄字段，include 附加关系，omit 去掉字段
  const selected = await db.user.findMany({
    select: { email: true, posts: { select: { title: true } } },
  });
  assert<Equal<(typeof selected)[number], { email: string; posts: { title: string }[] }>>();
  const included = await db.post.findFirstOrThrow({ include: { author: true, reviewer: true } });
  assert<Equal<typeof included.author, UserRow>>();
  assert<Equal<typeof included.reviewer, UserRow | null>>();
  const omitted = await db.post.findFirstOrThrow({ omit: { content: true } });
  assert<Equal<keyof typeof omitted, Exclude<keyof PostRow, "content">>>();

  // 标量类型
  const product = await db.product.findFirstOrThrow();
  assert<Equal<typeof product.price, string>>();
  assert<Equal<typeof product.stock, string>>();
  assert<Equal<typeof product.payload, Uint8Array | null>>();
  const account = await db.account.findFirstOrThrow();
  assert<Equal<NonNullable<typeof account.settings>["theme"], "light" | "dark">>();

  // 聚合结果类型
  const agg = await db.post.aggregate({
    _count: true,
    _sum: { views: true },
    _avg: { views: true },
  });
  assert<Equal<typeof agg._count, number>>();
  assert<Equal<typeof agg._avg.views, number | null>>();

  // bigint 字段支持算术更新，操作数可以是 bigint 或安全整数
  await db.product.update({ where: { sku: "s" }, data: { stock: { increment: 1n } } });
  await db.product.update({ where: { sku: "s" }, data: { stock: { decrement: 2 } } });

  // 扩展覆盖的类型必须与运行时合并语义一致。
  const restoredFields = db.$extend({ omit: { user: { name: true } } }).$extend({ omit: { user: { name: false, age: true } } });
  const restoredUser = await restoredFields.user.findFirstOrThrow();
  assert<Equal<typeof restoredUser.name, string | null>>();
  // @ts-expect-error 后续 omit 仍排除 age。
  restoredUser.age; // oxlint-disable-line no-unused-expressions
  const overriddenVirtual = db
    .$extend({
      virtuals: {
        user: {
          label: {
            needs: {},
            compute: () => {
              return "text";
            },
          },
        },
      },
    })
    .$extend({
      virtuals: {
        user: {
          label: {
            needs: {},
            compute: () => {
              return 42;
            },
          },
        },
      },
    });
  const virtualUser = await overriddenVirtual.user.findFirstOrThrow();
  assert<Equal<typeof virtualUser.label, number>>();

  const numericStats = await db.product.aggregate({
    _sum: { price: true, stock: true },
    _avg: { price: true, stock: true },
  });
  assert<Equal<typeof numericStats._sum.price, string | null>>();
  assert<Equal<typeof numericStats._sum.stock, string | null>>();
  assert<Equal<typeof numericStats._avg.price, string | null>>();
  assert<Equal<typeof numericStats._avg.stock, string | null>>();
  await db.product.groupBy({
    by: ["sku"],
    _avg: { price: true },
    having: { price: { _avg: { gt: "0.50" } } },
  });
  // @ts-expect-error 非数值字段不接受 sum 聚合过滤。
  await db.user.groupBy({ by: ["email"], _count: true, having: { email: { _sum: { gt: 1 } } } });
  const booleanStats = await db.post.aggregate({ _min: { published: true } });
  assert<Equal<typeof booleanStats._min.published, boolean | null>>();

  // 非法输入必须在编译期报错
  // @ts-expect-error 未知字段
  await db.user.findMany({ where: { nope: 1 } });
  // @ts-expect-error findUnique 需要唯一键
  await db.user.findUnique({ where: { name: "x" } });
  // @ts-expect-error 复合键必须给全所有字段
  await db.membership.findUnique({ where: { organization: "acme" } });
  await db.membership.update({
    where: { organization: "acme", email: "a" },
    // @ts-expect-error 复合主键的组成字段不可更新
    data: { organization: "other" },
  });
  // @ts-expect-error 批量更新同样禁止修改复合主键
  await db.membership.updateMany({ where: { organization: "acme" }, data: { email: "b" } });
  // @ts-expect-error 批量更新必须提供 where
  await db.user.updateMany({ data: { name: "x" } });
  // @ts-expect-error 批量更新返回必须提供 where
  await db.user.updateManyAndReturn({ data: { name: "x" } });
  // @ts-expect-error 批量恢复必须提供 where
  await db.account.restoreMany();
  // @ts-expect-error 批量删除必须提供 where
  await db.user.deleteMany();
  // @ts-expect-error 批量物理删除必须提供 where
  await db.user.forceDeleteMany();

  // $clear 是显式清空表的唯一入口，模型名受检查
  await db.$clear("user", { force: true });
  await db.$clear("account");
  // @ts-expect-error 未知模型
  await db.$clear("nope");
  // @ts-expect-error @auto 主键不可写
  await db.user.create({ data: { id: 1, email: "a" } });
  // @ts-expect-error 缺少必填字段
  await db.user.create({ data: { name: "no email" } });
  // @ts-expect-error 枚举值受检查
  await db.user.create({ data: { email: "a", role: "owner" } });
  // @ts-expect-error 外键与关系字段互斥
  await db.post.create({ data: { title: "t", authorId: 1, author: { connect: { id: 1 } } } });
  await db.account.create({
    // @ts-expect-error JSON 结构受检查
    data: { email: "a", settings: { theme: "blue", notifications: true, tags: [] } },
  });
}
