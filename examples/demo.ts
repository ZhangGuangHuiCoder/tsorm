import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, type Logger } from "@ofis/tsorm";
import { push } from "@ofis/tsorm/migrations";
import { createClient } from "./client.ts";

// query 记录状态与耗时；transaction 与 client 记录动作。
const logger: Logger = (event) => {
  if (event.type === "query") {
    console.log("[query]", event.status, `${event.durationMs.toFixed(1)}ms`);
  } else {
    console.log(`[${event.type}]`, event.action, event.status);
  }
};

/** 连接 compose.yaml 的本地实例；SQLite 使用临时文件，建表与客户端共用同一个库。 */
function target(database: string): string {
  if (database === "sqlite") {
    return "file:" + join(mkdtempSync(join(tmpdir(), "tsorm-demo-")), "demo.sqlite");
  }
  const urls: Record<string, string> = {
    mysql: "mysql://root:test_password@127.0.0.1:3307/test_database?allowPublicKeyRetrieval=true",
    pgsql: "postgresql://postgres:test_password@127.0.0.1:5433/test_database",
  };
  const url = urls[database];
  if (!url) {
    throw new Error("Use bun run example <sqlite|mysql|pgsql>");
  }
  return url;
}

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

const database = process.argv[2] ?? "";
const stamp = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const url = target(database);
// 建表由迁移 API 完成；reset 清空本模型的表，因此示例可重复运行。
await push({ url, schema: fileURLToPath(new URL("./schema.orm", import.meta.url)), reset: true, force: true, log: console.log });
const db = createClient({ connection: url, logger });

try {
  section("嵌套创建与关系查询");
  // 一次创建一对一和一对多关系，并返回嵌套结果。
  const user = await db.user.create({
    data: {
      email: `demo-${stamp}@example.com`,
      name: "Alice",
      role: "admin",
      profile: { create: { bio: "ORM example" } },
      posts: { create: [{ title: "Published", published: true }, { title: "Draft" }] },
    },
    include: { profile: true, posts: true },
  });
  console.log("nested create", user);
  console.log(
    "relation filter",
    await db.user.findMany({
      where: { posts: { some: { published: true } } },
      select: { email: true, posts: { where: { published: true }, select: { title: true } } },
    }),
  );

  section("写入与更新");
  const draft = await db.post.create({
    data: { title: "Connected", body: "Text column without a length limit", author: { connect: { id: user.id } } },
  });
  console.log("update", await db.post.update({ where: { id: draft.id }, data: { published: { set: true }, views: { increment: 1 } } }));
  console.log("upsert", await db.user.upsert({ where: { email: user.email }, create: { email: user.email }, update: { name: { set: "Upserted" } }, select: { email: true, name: true } }));

  section("事务提交与回滚");
  await db.$transaction(
    async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { name: "Updated" } });
      console.log("count in transaction", await tx.post.count({ where: { authorId: user.id } }));
    },
    { isolationLevel: "serializable" },
  );
  const rollback = new Error("rollback example");
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { name: "Rolled back" } });
      throw rollback;
    });
  } catch (error) {
    // 只接受主动触发的回滚，不把真实的数据库错误当成演示成功。
    if (error !== rollback) {
      throw error;
    }
    console.log("expected rollback", rollback.message);
  }
  console.log("after rollback", await db.user.findUnique({ where: { id: user.id }, select: { name: true } }));

  section("关系写入与引用动作");
  const tag = `tag-${stamp}`;
  console.log(
    "connectOrCreate",
    await db.post.update({
      where: { id: draft.id },
      data: { tags: { connectOrCreate: [{ where: { name: tag }, create: { name: tag } }] } },
      include: { tags: true },
    }),
  );
  // 删除父节点后，子节点按 SetNull 升到根级。
  const tree = await db.category.create({
    data: { name: `cat-${stamp}-root`, children: { create: { name: `cat-${stamp}-child` } } },
    include: { children: true },
  });
  await db.category.delete({ where: { id: tree.id } });
  console.log("SetNull after parent delete", await db.category.findMany({ where: { id: { in: tree.children.map((child) => child.id) } } }));

  section("复合唯一键与标量");
  await db.slot.create({ data: { owner: `slot-${stamp}`, slot: 1 } });
  console.log("composite unique lookup", await db.slot.findUnique({ where: { owner: `slot-${stamp}`, slot: 1 } }));
  console.log("product", await db.product.create({ data: { sku: `SKU-${stamp}`, price: "12.34", stock: 1_000n, payload: new Uint8Array([1, 2, 3]) } }));

  section("参数化 SQL");
  console.log("raw binding", await db.$queryRaw<{ demo_value: unknown }[]>`SELECT ${user.id} AS demo_value`);
  // 标识符使用固定的方言 SQL，插值只绑定值。
  const statement = database === "mysql" ? sql`UPDATE \`Post\` SET \`views\` = \`views\` + 1 WHERE \`authorId\` = ${user.id}` : sql`UPDATE "Post" SET "views" = "views" + 1 WHERE "authorId" = ${user.id}`;
  console.log("executeRaw affected", await db.$executeRaw(statement));

  section("JSON、软删除与恢复");
  const account = await db.account.create({
    data: { email: `account-${stamp}@example.com`, preferences: { theme: "dark", notifications: true, languages: ["zh", "en"] }, entries: { create: { title: "First entry" } } },
  });
  await db.accountEntry.deleteMany({ where: { accountId: account.id } });
  console.log("hidden entries", await db.account.findUnique({ where: { id: account.id }, include: { entries: true } }));
  await db.account.delete({ where: { id: account.id } });
  console.log("deleted account", await db.account.findMany({ where: { id: account.id }, deleted: "only" }));
  console.log("restored account", await db.account.restore({ where: { id: account.id } }));

  section("删除与外键级联");
  await db.post.delete({ where: { id: draft.id } });
  await db.user.delete({ where: { id: user.id } });
  console.log("posts after Cascade", await db.post.count({ where: { authorId: user.id } }));
  console.log("profile after Cascade", await db.profile.findFirst({ where: { userId: user.id } }));
} finally {
  // 清理失败也必须释放连接；所有派生客户端共享这份连接生命周期。
  await db.$close();
}
