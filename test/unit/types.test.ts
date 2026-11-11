// 类型的可读性：编辑器悬停和编译错误应显示简短、具名、按模型字段顺序排列的类型，
// 而不是内部拼装用的辅助类型；并用虚拟 Program 复核 key-only 更新类型的拒绝边界。
import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type * as TS from "typescript";
import { generateClient, parseSchema } from "../../src/schema/index.js";

const ts = createRequire(import.meta.url)("typescript") as typeof TS;
const casesFile = fileURLToPath(new URL("../types/display-cases.ts", import.meta.url));
/** 只存在于内存中的错误样例文件，放在 test/types 下以便使用相同的相对导入路径。 */
const errorsFile = fileURLToPath(new URL("../types/__error-cases__.ts", import.meta.url));

const options: TS.CompilerOptions = {
  strict: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
};

/** 能编译额外内存文件的 Program，供错误信息样例使用。 */
function program(extra: Record<string, string> = {}): TS.Program {
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, ...rest) => {
    return name in extra ? ts.createSourceFile(name, extra[name], version) : getSourceFile(name, version, ...rest);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => {
    return name in extra || fileExists(name);
  };
  return ts.createProgram([casesFile, ...Object.keys(extra)], options, host);
}

/** 取出样例文件中每个函数内变量的显示文本，与编辑器悬停看到的一致。键为 `函数名.变量名`。 */
function displayedTypes(): Map<string, string> {
  const p = program();
  const checker = p.getTypeChecker();
  const types = new Map<string, string>();
  const visit = (node: TS.Node, scope: string) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      scope = node.name.text;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text !== "db") {
      const type = checker.getTypeAtLocation(node.name);
      // InTypeAlias 展开最外层别名一层，与悬停在类型名上看到的定义一致。
      const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias;
      types.set(`${scope}.${node.name.text}`, checker.typeToString(type, undefined, flags));
    }
    ts.forEachChild(node, (child) => {
      return visit(child, scope);
    });
  };
  visit(p.getSourceFile(casesFile)!, "");
  return types;
}

/** 编译一段代码，返回每条错误（含嵌套的详细说明）拼接后的文本。 */
function errorsOf(code: string): string[] {
  const source = `import { createClient } from '../fixtures/client.ts';\nimport { sqlite } from '../../src/adapters/sqlite/index.ts';\nconst db = await createClient({ adapter: sqlite() });\n${code}\nexport {};\n`;
  const p = program({ [errorsFile]: source });
  return ts.getPreEmitDiagnostics(p, p.getSourceFile(errorsFile)).map((d) => {
    return ts.flattenDiagnosticMessageText(d.messageText, "\n");
  });
}

// 拼装结果类型时用到的内部辅助类型，不应出现在结果的悬停文本里。
const NOISE = [/Omit</, /Values</, /Projection</, /Omitted</, /Selected</, /GroupByResult</, /AggregateResult</, /WithOmit</, /WithVirtuals</, /& \{\}/, /\breadonly\b/];

describe("type display", () => {
  const types = displayedTypes();
  const get = (key: string) => {
    const text = types.get(key);
    if (text === undefined) {
      throw new Error(`no case ${key}`);
    }
    return text;
  };

  // 每个结果类型都显示为扁平对象，不含内部辅助类型
  test.each(
    [...types.keys()].filter((k) => {
      return k.startsWith("results.");
    }),
  )("%s hovers as a plain object type", (key) => {
    for (const pattern of NOISE) {
      expect(get(key)).not.toMatch(pattern);
    }
  });

  // 字段按模型声明顺序排列，关系字段排在标量字段之后
  test("fields keep schema order", () => {
    expect(get("results.plain")).toBe('{ id: number; email: string; name: string | null; role: "admin" | "member"; age: number | null; createdAt: string; updatedAt: string; }');
    expect(get("results.omitted")).toStartWith("{ id: number; title: string; published: boolean; views: number;");
  });

  // 嵌套 include 的关系同样被展开，字段类型保持正确
  test("nested relations are expanded with their field types", () => {
    const created = get("results.created");
    expect(created).toContain("profile: { id: number; bio: string; userId: number; } | null");
    expect(created).toContain("tags: { id: number; name: string; }[]");
  });

  // select 与聚合的结果只包含选中的字段
  test("select and aggregates show exactly the chosen fields", () => {
    expect(get("results.selected")).toStartWith("{ email: string; posts: { title: string; }[]; _count: {");
    expect(get("results.agg")).toBe("{ _count: number; _sum: { views: number | null; }; _avg: { views: number | null; }; }");
    expect(get("results.groups")).toBe("{ authorId: number; _count: { _all: number; }; _max: { views: number | null; }; }[]");
  });

  // 方法签名显示具名的参数和返回类型
  test("method hovers show named argument and result types", () => {
    expect(get("signatures.findMany")).toEndWith('(args?: FindArgs<Models, "User", P, I, O> | undefined) => Promise<Result<Models, "User", P, I, O>[]>');
    expect(get("signatures.create")).toEndWith('(args: CreateArgs<Models, "Post", P, I, O>) => Promise<Result<Models, "Post", P, I, O>>');
    expect(get("signatures.aggregate")).toEndWith("Promise<AggregateResult<PostRow, A, never>>");
    expect(get("signatures.updateMany")).toBe('(args: { where: Where<Models, "User">; data: UserScalarUpdate; }) => Promise<{ count: number; }>');
  });

  // 没有虚拟字段和全局 omit 时，客户端类型直接引用 Models；
  // $extend 的签名有意引用 WithVirtuals/WithOmit，断言前先摘除该成员。
  test("the client refers to Models directly without empty wrappers", () => {
    const client = get("signatures.client");
    expect(client).toContain('user: ModelClient<Models, "User">');
    expect(client).toContain("$transaction<T>(fn: (tx: TxClient<Models>) => Promise<T>");
    expect(client.replace(/\$extend[\s\S]*\$capabilities/, "$capabilities")).not.toMatch(/WithOmit|WithVirtuals/);
  });

  // where 中的字段使用具名过滤类型，关系过滤同样具名，且没有空的 & {}
  test("Where and OrderBy are built from named filters", () => {
    const where = get("inputs.whereInput");
    expect(where).toStartWith("{ id?: number | ComparableFilter<number> | undefined; email?: string | StringFilter<string> | undefined;");
    expect(where).toContain('posts?: ListRelationFilter<Where<Models, "Post">> | undefined');
    expect(where).toContain('profile?: RelationFilter<Where<Models, "Profile">> | undefined');
    expect(where).not.toContain("& {}");
    expect(get("inputs.accountWhereInput")).toContain("settings?: JsonFilter | undefined");
    expect(get("inputs.orderInput")).toStartWith("{ id?: SortOrder | undefined; email?: SortOrder | undefined;");
  });

  // 生成的写入类型由具名的嵌套输入组成
  test("generated write inputs refer to named nested inputs", () => {
    expect(get("inputs.userCreateInput")).toContain("posts?: UserCreatePostsInput | undefined");
    expect(get("inputs.postCreateInput")).toContain("author: PostCreateAuthorInput");
    expect(get("inputs.userUpdateInput")).toContain("posts?: UserUpdatePostsInput | undefined");
    for (const key of ["inputs.userCreateInput", "inputs.postCreateInput", "inputs.userUpdateInput"]) {
      expect(get(key)).not.toMatch(/AtLeastOne<|OneOf<|DistributiveOmit</);
    }
  });
});

describe("compiler error messages", () => {
  // 缺少必填外键时，错误指向外键字段（最常见的修法）
  test("a missing required relation names the foreign key", () => {
    const [message] = errorsOf("await db.post.create({ data: { title: 't' } });");
    expect(message).toMatch(/Property '"?authorId"?' is missing/);
  });

  // 同时传外键和关系字段时，错误说明二者只能选一个
  test("passing both the foreign key and the relation names the rule", () => {
    const [message] = errorsOf("await db.post.create({ data: { title: 't', authorId: 1, author: { connect: { id: 1 } } } });");
    expect(message).toContain("Use either authorId or author, not both");
  });

  // select 与 include / omit 混用时，错误说明不能组合
  test.each([
    ["include", "await db.user.findMany({ select: { email: true }, include: { posts: true } });"],
    ["omit", "await db.user.findMany({ select: { email: true }, omit: { name: true } });"],
  ])("select with %s names the rule", (_, code) => {
    const [message] = errorsOf(code);
    expect(message).toContain("select cannot be combined with include or omit");
    expect(message).not.toContain("type 'undefined'");
  });

  // 未知字段仍给出拼写建议
  test("unknown fields still get a spelling suggestion", () => {
    const [message] = errorsOf("await db.user.create({ data: { email: 'a', nam: 'x' } });");
    expect(message).toContain("Did you mean to write 'name'?");
  });
});

test("key-only update types reject immutable and unknown properties but permit relation updates", () => {
  const clientPath = fileURLToPath(new URL("../types/__self-review-client.ts", import.meta.url));
  const casePath = fileURLToPath(new URL("../types/__self-review-case.ts", import.meta.url));
  const generated = generateClient(parseSchema("model Pair { a: string b: string @@id(a, b) } model Owner { id: int @id @auto items: Item[] @via(owner) } model Item { id: int @id @auto owner: Owner }"), "../../src/index.js");
  const source = `import type { PairScalarUpdate, OwnerUpdate, OwnerScalarCreate } from './__self-review-client.js';
const immutable: PairScalarUpdate = { a: 'changed' };
const unknown: PairScalarUpdate = { unexpected: true };
const callable: PairScalarUpdate = () => {};
const empty: PairScalarUpdate = {};
const relation: OwnerUpdate = { items: { create: {} } };
const invalidBulk: OwnerScalarCreate = { id: 123 };
export { immutable, unknown, callable, empty, relation, invalidBulk };`;
  const virtual: Record<string, string> = { [clientPath]: generated, [casePath]: source };
  const p = program(virtual);
  const errors = ts.getPreEmitDiagnostics(p).filter((d) => {
    return d.file?.fileName === casePath;
  });
  expect(
    errors.map((d) => {
      return d.file!.getLineAndCharacterOfPosition(d.start!).line + 1;
    }),
  ).toEqual([2, 3, 4, 7]);
});
