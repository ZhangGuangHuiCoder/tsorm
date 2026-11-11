---
description: 每个 tsorm 命令都有对应的函数，可在程序中执行同样的操作，含对照表、选项与示例。
---

# 在代码中调用

每个命令都有对应的函数，可以在程序里执行同样的操作，例如在应用启动时迁移、在测试准备阶段重置数据库，或在部署脚本中检查偏差。迁移命令来自 `@ofis/tsorm/migrations`，模型校验和生成分别使用 `@ofis/tsorm/schema` 的 `parseSchema` 和 `generateClient`。

## 函数对照

| 命令             | 函数                                                | 返回值                                                            |
| ---------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `migrate`        | `migrate({ name, createOnly, reset })`              | `{ migration?, applied, reset }`                                  |
| `deploy`         | `deploy({})`                                        | `{ applied }`                                                     |
| `deploy --check` | `status({})`                                        | `{ exitCode, local, applied, pending, failed, missing, message }` |
| `resolve`        | `resolve({ applied })` 或 `resolve({ rolledBack })` | 无                                                                |
| `diff`           | `diff({ from, to })`                                | `{ diff, sql, summary }`；`diff.empty` 对应 `--check`             |
| `push`           | `push({ reset })`                                   | `{ changed }`                                                     |
| `validate`       | `parseSchema(source)`                               | 解析后的结构；无效时抛出 `SchemaError`                            |
| `generate`       | `generateClient(schema, runtimeImport)`             | 客户端源码字符串                                                  |

## 公共选项

迁移函数必须传入选项对象；没有必填命令选项时可传 `{}` 使用默认值。上表列出 `await` 后的结果。公共选项如下：

| 选项                | 默认值          | 对应的 CLI 设置                                              |
| ------------------- | --------------- | ------------------------------------------------------------ |
| `url`               | `file:./dev.db` | `DATABASE_URL`                                               |
| `shadowDatabaseUrl` | 无              | `SHADOW_DATABASE_URL`                                        |
| `schema`            | `schema.orm`    | `--schema`                                                   |
| `cwd`               | `process.cwd()` | 当前目录，相对路径以它为基准                                 |
| `force`             | `false`         | `--force`                                                    |
| `prompt`            | 无              | 终端确认；传入带 `confirm(message): Promise<boolean>` 的对象 |
| `log`               | 不输出          | 进度输出                                                     |

## 与 CLI 的区别

- **不读取环境变量。** 需要自行传入 `url: process.env.DATABASE_URL`，否则使用 `file:./dev.db`。
- **不打印任何内容**，除非传入 `log`，例如 `log: console.log`。
- **确认方式。** 没有 `prompt` 时，需要确认的步骤抛出 `NON_INTERACTIVE`；设置 `force: true` 表示接受。`confirm` 返回 `false` 时抛出 `ABORTED`。
- **错误以异常抛出，而不是退出码。** 迁移函数抛出带 `code` 的 `MigrationError`，例如 `NON_INTERACTIVE`、`DATABASE_NOT_FOUND`。`status` 和 `diff` 通过返回值报告结果，读取 `exitCode` 或 `diff.empty` 即可。

## 例子

### 启动时迁移

```ts
import { deploy } from "@ofis/tsorm/migrations";

await deploy({ url: process.env.DATABASE_URL, log: console.log });
```

### 在部署脚本中检查

```ts
import { diff, status } from "@ofis/tsorm/migrations";

const url = process.env.DATABASE_URL;
const state = await status({ url });
if (state.exitCode !== 0) {
  throw new Error(state.message);
}

const drift = await diff({ url, from: "migrations", to: "database" });
if (!drift.diff.empty) {
  throw new Error(drift.summary);
}
```

### 重置测试数据库

```ts
import { push } from "@ofis/tsorm/migrations";

await push({ url: "file:./test.db", reset: true, force: true });
```

### 生成客户端

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateClient, parseSchema } from "@ofis/tsorm/schema";

const schema = parseSchema(readFileSync("schema.orm", "utf8"));
mkdirSync("generated", { recursive: true });
writeFileSync("generated/client.ts", generateClient(schema));
```

`runtimeImport` 默认为 `'@ofis/tsorm'`，生成文件通过包的 `exports` 解析运行时，与输出位置无关。`generateClient` 只返回源码，目标目录需事先创建。

### 集成自定义确认界面

```ts
import { migrate, MigrationError } from "@ofis/tsorm/migrations";

try {
  await migrate({
    url: process.env.DATABASE_URL,
    name: "add_profile",
    prompt: { confirm: async (message) => askUser(message) },
  });
} catch (error) {
  if (error instanceof MigrationError && error.code === "ABORTED") {
    console.log("已取消");
  } else {
    throw error;
  }
}
```

`askUser` 表示应用提供的确认函数；返回 `true` 时继续执行。

## 下一步

- [客户端 API](../client-api.md)：生成的客户端的完整 API
- [错误码](../errors.md)：这些函数可能抛出的 `MigrationError` 错误码
