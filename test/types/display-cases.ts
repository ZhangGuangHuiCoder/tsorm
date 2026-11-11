// 编辑器悬停时显示的类型样例，由 test/unit/types.test.ts 读取并检查显示文本。
// 每个函数里以 const 声明的变量都会被取出显示文本；新增场景时在对应函数里加一个变量即可。
import { createClient, type Models, type PostCreate, type UserCreate, type UserUpdate } from "../fixtures/client.ts";
import { sqlite } from "../../src/adapters/sqlite/index.ts";
import type { OrderBy, Where } from "../../src/index.ts";

/** 查询和写入的结果：应显示为按模型字段顺序排列的扁平对象。 */
export async function results() {
  const db = await createClient({ adapter: sqlite() });
  const created = await db.user.create({
    data: { email: "a", profile: { create: { bio: "x" } }, posts: { create: [{ title: "t" }] } },
    include: { profile: true, posts: { include: { tags: true } } },
  });
  const plain = await db.user.findUniqueOrThrow({ where: { id: 1 } });
  const selected = await db.user.findMany({
    select: { email: true, posts: { select: { title: true } }, _count: true },
  });
  const omitted = await db.post.findFirst({ omit: { content: true } });
  const agg = await db.post.aggregate({
    _count: true,
    _sum: { views: true },
    _avg: { views: true },
  });
  const groups = await db.post.groupBy({
    by: ["authorId"],
    _count: { _all: true },
    _max: { views: true },
  });
  const page = await db.post.findManyAndCount({ select: { title: true } });
  return { created, plain, selected, omitted, agg, groups, page };
}

/** 方法签名和客户端：应显示简短的具名类型，而不是展开的内部定义。 */
export async function signatures() {
  const db = await createClient({ adapter: sqlite() });
  const findMany = db.user.findMany;
  const create = db.post.create;
  const aggregate = db.post.aggregate;
  const updateMany = db.user.updateMany;
  const client = db;
  return { findMany, create, aggregate, updateMany, client };
}

/** 输入类型：过滤、排序和生成的写入类型应由具名的小类型组成。 */
export function inputs(where: Where<Models, "User">, accountWhere: Where<Models, "Account">, order: OrderBy<Models, "User">, userCreate: UserCreate, postCreate: PostCreate, userUpdate: UserUpdate) {
  const whereInput = where;
  const accountWhereInput = accountWhere;
  const orderInput = order;
  const userCreateInput = userCreate;
  const postCreateInput = postCreate;
  const userUpdateInput = userUpdate;
  return {
    whereInput,
    accountWhereInput,
    orderInput,
    userCreateInput,
    postCreateInput,
    userUpdateInput,
  };
}
