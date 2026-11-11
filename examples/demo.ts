import { sql, type Logger } from "@ofis/tsorm";
import { mysql } from "@ofis/tsorm/adapters/mysql";
import { postgres } from "@ofis/tsorm/adapters/postgres";
import { sqlite } from "@ofis/tsorm/adapters/sqlite";
import { createClient } from "./client.ts";

// query 记录 SQL；transaction 记录事务；client 记录连接生命周期。
const logger: Logger = (event) => {
  if (event.type === "query") {
    console.log("[query]", event.status, `${event.durationMs.toFixed(2)}ms`, event.sql);
  } else if (event.type === "transaction") {
    console.log("[transaction]", event.action, event.status);
  } else if (event.type === "client") {
    console.log("[client]", event.action, event.status);
  }
};

/** 连接 compose.yaml 的本地实例；SQLite 使用独立内存库。 */
function adapter(database: string) {
  if (database === "mysql") {
    return mysql({
      initialize: true,
      connection: "mysql://root:test_password@127.0.0.1:3307/test_database?allowPublicKeyRetrieval=true",
    });
  }
  if (database === "pgsql") {
    return postgres({
      initialize: true,
      connection: "postgresql://postgres:test_password@127.0.0.1:5433/test_database",
    });
  }
  if (database === "sqlite") {
    return sqlite({ initialize: true, connection: "file::memory:" });
  }
  throw new Error("Use bun run example <sqlite|mysql|pgsql>");
}

/** 在具有 int 主键的模型间复用虚拟字段。 */
const shared = {
  ref: {
    needs: { id: true },
    compute: (row: Readonly<{ id: number }>) => {
      return "#" + row.id;
    },
  },
} as const;

type BaseClient = Awaited<ReturnType<typeof createClient>>;

function extend(base: BaseClient) {
  return base.$extend({
    virtuals: {
      account: {
        ...shared,
        displayName: {
          needs: { email: true },
          compute: (row) => {
            return row.email.split("@")[0];
          },
        },
      },
      user: shared,
      post: shared,
    },
  });
}

type Db = ReturnType<typeof extend>;
type User = Awaited<ReturnType<typeof createUser>>;

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

async function createUser(db: Db, stamp: string) {
  // 一次创建一对一、一对多和多对多关系，并返回嵌套结果。
  const user = await db.user.create({
    data: {
      email: `demo-${stamp}@example.com`,
      name: "Alice",
      profile: { create: { bio: "ORM example" } },
      posts: {
        create: [{ title: "Published", published: true, tags: { create: { name: `tag-${stamp}` } } }, { title: "Draft" }],
      },
    },
    include: { profile: true, posts: { include: { tags: true } } },
  });
  console.log("nested create", user);
  return user;
}

async function queries(db: Db, user: User): Promise<void> {
  const where = { authorId: user.id };
  console.log("unique", await db.user.findUnique({ where: { email: user.email } }));
  console.log("shared virtual field", await db.user.findUnique({ where: { id: user.id }, select: { ref: true } }));
  console.log("aggregates", await db.post.aggregate({ where, _count: true, _sum: { views: true }, _avg: { views: true } }));
  console.log("groups", await db.post.groupBy({ by: ["published"], where, _count: true, _sum: { views: true }, orderBy: { published: "asc" } }));
  console.log("relation counts", await db.user.findUnique({ where: { id: user.id }, select: { email: true, _count: { select: { posts: true } } } }));
  console.log("omit and distinct", await db.post.findMany({ where, distinct: "authorId", omit: { authorId: true } }));
  console.log("cursor page", await db.post.findMany({ where, cursor: { id: user.posts[0].id }, skip: 1, take: 1, orderBy: { id: "asc" }, select: { title: true } }));
  console.log(
    "relation filter and pagination",
    await db.user.findMany({
      where: { id: user.id, posts: { some: { published: true } } },
      select: {
        email: true,
        name: true,
        posts: { where: { published: true }, orderBy: { id: "desc" }, take: 2, select: { title: true, tags: { select: { name: true } } } },
      },
    }),
  );
  // 叠加 omit 不会修改原客户端，前面的查询仍能读到 name。
  const redacted = db.$extend({ omit: { user: { name: true } } });
  console.log("omitted user (name hidden)", await redacted.user.findUnique({ where: { id: user.id } }));
}

async function writes(db: Db, user: User) {
  const draft = await db.post.create({
    data: { title: "Connected", body: "Text column without a length limit", author: { connect: { id: user.id } } },
  });
  await db.post.update({ where: { id: draft.id }, data: { published: { set: true }, views: { increment: 1 } } });
  console.log("upsert existing user", await db.user.upsert({ where: { email: user.email }, create: { email: user.email }, update: { name: { set: "Upserted" } }, select: { email: true, name: true } }));
  await db.user.update({
    where: { id: user.id },
    data: { profile: { update: { bio: "Updated profile" } }, posts: { update: { where: { id: draft.id }, data: { views: { multiply: 2 } } } } },
  });
  console.log("required post", await db.post.findUniqueOrThrow({ where: { id: draft.id }, select: { title: true, views: true, body: true } }));
  console.log("text contains", await db.post.count({ where: { authorId: user.id, body: { contains: "length limit" } } }));
  console.log("skip duplicate email", await db.user.createMany({ data: [{ email: user.email }], skipDuplicates: true }));
  console.log(
    "bulk returning",
    await db.post.createManyAndReturn({
      data: [
        { title: "Batch A", authorId: user.id },
        { title: "Batch B", authorId: user.id },
      ],
      select: { id: true, title: true },
    }),
  );
  console.log("updateManyAndReturn", await db.post.updateManyAndReturn({ where: { authorId: user.id, published: false }, data: { published: true } }));
  return draft;
}

async function transactions(db: Db, userId: number): Promise<void> {
  await db.$transaction(
    async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { name: "Updated" } });
      console.log("count in transaction", await tx.post.count({ where: { authorId: userId } }));
    },
    { isolationLevel: "serializable" },
  );
  const rollback = new Error("rollback example");
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { name: "Rolled back" } });
      throw rollback;
    });
  } catch (error) {
    // 只接收主动触发的回滚，不把真实的数据库错误当成演示成功。
    if (error !== rollback) {
      throw error;
    }
    console.log("expected rollback", rollback.message);
  }
  console.log("after rollback", await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }));
}

async function relations(db: Db, stamp: string, userId: number): Promise<void> {
  const tree = await db.category.create({
    data: {
      name: `cat-${stamp}-root`,
      children: { create: [{ name: `cat-${stamp}-a`, children: { create: { name: `cat-${stamp}-a1` } } }, { name: `cat-${stamp}-b` }] },
    },
    include: { children: { include: { children: true } } },
  });
  console.log("category tree", tree);
  await db.category.delete({ where: { id: tree.id } });
  const childIds = tree.children.map((child) => {
    return child.id;
  });
  console.log("SetNull after parent delete", await db.category.findMany({ where: { id: { in: childIds } } }));

  // 显式 morph：从两种拥有方写入同一个 Attachment 模型。
  const post = await db.post.create({
    data: { title: "Morph post", author: { connect: { id: userId } }, attachments: { create: { name: `att-post-${stamp}.png` } } },
    include: { attachments: true },
  });
  console.log("post with morph attachments", post);
  await db.user.update({ where: { id: userId }, data: { attachments: { create: { name: `att-user-${stamp}.png` } } } });
  console.log(
    "morph filter + count",
    await db.post.findMany({
      where: { authorId: userId, attachments: { some: { name: `att-post-${stamp}.png` } } },
      select: { title: true, _count: { select: { attachments: true } } },
    }),
  );
  // 隐式 morph：holderType 和 holderId 由模型生成。
  await db.post.update({ where: { id: post.id }, data: { notes: { create: { body: `note-${stamp}` } } } });
  console.log("implicit morph notes", await db.note.findMany({ where: { holderType: "Post", holderId: post.id } }));

  const tagA = `tag-coc-${stamp}-a`;
  const tagB = `tag-coc-${stamp}-b`;
  console.log(
    "connectOrCreate tags",
    await db.post.update({
      where: { id: post.id },
      data: {
        tags: {
          connectOrCreate: [
            { where: { name: tagA }, create: { name: tagA } },
            { where: { name: tagB }, create: { name: tagB } },
          ],
        },
      },
      include: { tags: true },
    }),
  );
  console.log("set tags", await db.post.update({ where: { id: post.id }, data: { tags: { set: [{ name: tagA }] } }, include: { tags: true } }));
  await db.post.update({ where: { id: post.id }, data: { tags: { disconnect: { name: tagA } } } });

  // 自关联多对多：分别从 following 和 followers 方向读取。
  const peer = await db.user.create({ data: { email: `peer-${stamp}@example.com`, name: "Peer" } });
  await db.user.update({ where: { id: userId }, data: { following: { connect: { id: peer.id } } } });
  console.log("self m2m forward", await db.user.findUnique({ where: { id: userId }, select: { id: true, following: { select: { email: true } } } }));
  console.log("self m2m inverse", await db.user.findUnique({ where: { id: peer.id }, select: { id: true, followers: { select: { email: true } } } }));
}

async function scalars(db: Db, stamp: string): Promise<void> {
  await db.slot.create({ data: { owner: `slot-${stamp}`, slot: 1 } });
  console.log("slot composite unique lookup", await db.slot.findUnique({ where: { owner: `slot-${stamp}`, slot: 1 } }));
  const product = await db.product.create({
    data: { sku: `SKU-${stamp}`, price: "12.34", stock: 1_000n, payload: new Uint8Array([1, 2, 3]) },
  });
  console.log("product uuid + decimal + bigint + bytes", product);
  console.log("bigint increment", await db.product.update({ where: { id: product.id }, data: { stock: { increment: 5n } } }));
}

async function rawSql(db: Db, database: string, userId: number): Promise<void> {
  console.log("raw binding", await db.$queryRaw<{ demo_value: unknown }[]>`SELECT ${userId} AS demo_value`);
  // 标识符使用固定的方言 SQL，插值只绑定值，不把普通字符串伪装成模板。
  const statement = database === "mysql" ? sql`UPDATE \`Post\` SET \`views\` = \`views\` + 1 WHERE \`authorId\` = ${userId}` : sql`UPDATE "Post" SET "views" = "views" + 1 WHERE "authorId" = ${userId}`;
  console.log("executeRaw affected", await db.$executeRaw(statement));
}

async function softDelete(db: Db, stamp: string): Promise<void> {
  const account = await db.$transaction(
    async () => {
      const row = await db.account.create({
        data: { email: `account-${stamp}@example.com`, preferences: { theme: "dark", notifications: true, languages: ["zh", "en"] }, entries: { create: { title: "First entry" } } },
      });
      // 使用外层客户端也会自动加入当前事务。
      await db.accountEntry.create({ data: { title: "Automatic transaction context", accountId: row.id } });
      return row;
    },
    { isolationLevel: "serializable" },
  );
  console.log(
    "snapshot page",
    await db.account.findManyAndCount({
      where: { id: account.id },
      take: 10,
      select: { ref: true, displayName: true, preferences: true, _count: { select: { entries: true } } },
    }),
  );
  await db.accountEntry.deleteMany({ where: { accountId: account.id } });
  console.log("hidden entries", await db.account.findUnique({ where: { id: account.id }, include: { entries: true } }));
  await db.accountEntry.restoreMany({ where: { accountId: account.id } });
  await db.account.delete({ where: { id: account.id } });
  console.log("deleted account", await db.account.findMany({ where: { id: account.id }, deleted: "only" }));
  console.log("restored account", await db.account.restore({ where: { id: account.id } }));
}

/** 无论在哪一步失败，都按本次运行的唯一标记清理；不触碰其他记录或表结构。 */
async function cleanup(base: BaseClient, stamp: string): Promise<void> {
  await base.$transaction(async (tx) => {
    // 多态关系没有物理外键，必须显式删除；普通子表和中间表由外键级联清理。
    await tx.note.deleteMany({ where: { body: `note-${stamp}` } });
    await tx.attachment.deleteMany({ where: { name: { in: [`att-post-${stamp}.png`, `att-user-${stamp}.png`] } } });
    await tx.user.deleteMany({ where: { email: { in: [`demo-${stamp}@example.com`, `peer-${stamp}@example.com`] } } });
    await tx.tag.deleteMany({ where: { name: { in: [`tag-${stamp}`, `tag-coc-${stamp}-a`, `tag-coc-${stamp}-b`] } } });
    await tx.category.deleteMany({ where: { name: { in: [`cat-${stamp}-root`, `cat-${stamp}-a`, `cat-${stamp}-a1`, `cat-${stamp}-b`] } } });
    await tx.slot.deleteMany({ where: { owner: `slot-${stamp}` } });
    await tx.product.deleteMany({ where: { sku: `SKU-${stamp}` } });
    // 中途失败时账户可能仍被软删除，因此查询必须包含已删除记录。
    const account = await tx.account.findUnique({ where: { email: `account-${stamp}@example.com` }, deleted: "include" });
    if (account) {
      await tx.accountEntry.forceDeleteMany({ where: { accountId: account.id } });
      await tx.account.forceDelete({ where: { id: account.id } });
    }
  });
}

const database = process.argv[2] ?? "";
// 保持 SKU 等短字符串在模型长度限制内，同时降低并行运行的标记碰撞风险。
const stamp = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const base = await createClient({ adapter: adapter(database), logger });
try {
  const db = extend(base);
  section("创建、查询与客户端扩展");
  const user = await createUser(db, stamp);
  await queries(db, user);
  section("单条与批量写入");
  const draft = await writes(db, user);
  section("事务提交与回滚");
  await transactions(db, user.id);
  section("自关联、多态与关系写入");
  await relations(db, stamp, user.id);
  section("复合唯一键与标量");
  await scalars(db, stamp);
  section("参数化 SQL");
  await rawSql(db, database, user.id);
  section("JSON、软删除与恢复");
  await softDelete(db, stamp);
  section("删除与外键级联");
  await db.post.delete({ where: { id: draft.id } });
  await db.post.deleteMany({ where: { authorId: user.id, title: { startsWith: "Batch " } } });
  await db.user.delete({ where: { id: user.id } });
  console.log("posts after Cascade", await db.post.count({ where: { authorId: user.id } }));
  console.log("profile after Cascade", await db.profile.findFirst({ where: { userId: user.id } }));
} finally {
  try {
    section("清理本次数据");
    await cleanup(base, stamp);
    console.log("cleanup complete");
  } finally {
    // 清理失败也必须释放连接；所有派生客户端共享这份连接生命周期。
    await base.$close();
  }
}
