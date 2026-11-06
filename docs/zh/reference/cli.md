---
description: tsorm 命令行工具的全部命令、选项、环境变量和退出码。
---

# CLI

安装 `@ofis/tsorm` 后提供 `tsorm` 命令：

```bash
tsorm <command> [options]
```

- 安装在项目中时，在 `package.json` 的 `scripts` 里直接写 `tsorm`，例如 `"db:migrate": "tsorm migrate"`。
- 全局安装（`npm install -g @ofis/tsorm`）后，可在任意终端直接运行。
- 临时运行而不安装时，使用完整包名：`npx @ofis/tsorm <command>`。

所有命令都有默认值，大多数情况下不需要任何参数。路径相对于当前目录。失败时，错误输出到标准错误，退出码为 1。

## 命令

| 命令       | 说明                                 | 选项                                         |
| ---------- | ------------------------------------ | -------------------------------------------- |
| `migrate`  | 根据模型生成并应用迁移（开发）       | `--name`、`-n`、`--create-only`、`--reset`、`--force` |
| `deploy`   | 应用待执行的迁移（上线）             | `--check`                                    |
| `resolve`  | 处理失败的迁移                       | `--applied <名称>` 或 `--rolled-back <名称>` |
| `diff`     | 输出两份结构之间的 SQL               | `--from`、`--to`、`--check`                  |
| `push`     | 不经迁移，直接同步结构               | `--reset`、`--force`                         |
| `validate` | 校验模型文件                         | 无                                           |
| `generate` | 生成 TypeScript 客户端               | `--out <文件>`，默认 `generated/client.ts`   |

迁移相关命令的说明见[版本化迁移](../databases/migrations.md)。

## 公共选项

| 选项              | 默认值       | 说明                                         |
| ----------------- | ------------ | -------------------------------------------- |
| `--schema <文件>` | `schema.orm` | 模型文件，迁移目录固定在它旁边的 `migrations/` |
| `--force`         | 关闭         | 跳过确认，接受数据丢失                       |
| `--help`、`-h`    |              | 显示帮助                                     |

未知的选项会直接报错。

## 环境变量

| 变量                  | 默认值          | 说明                                              |
| --------------------- | --------------- | ------------------------------------------------- |
| `DATABASE_URL`        | `file:./dev.db` | 数据库连接；`file:`、`postgresql://` 或 `mysql://` |
| `SHADOW_DATABASE_URL` | 无              | 专用影子库，没有建库权限时使用                    |
| `CI`                  | 无              | 设置后不再询问，需要确认的步骤必须加 `--force`    |

## 退出码

| 退出码 | 含义                                                  |
| ------ | ----------------------------------------------------- |
| `0`    | 成功                                                  |
| `1`    | 出错；`deploy --check` 发现数据库不是最新时也返回 1   |
| `2`    | `diff --check` 发现差异                               |

## 交互

重置数据库和数据丢失的确认只在交互终端中询问。非交互环境（标准输入或输出不是终端，或设置了 `CI`）中，需要确认的步骤会报 `NON_INTERACTIVE`，加 `--force` 可以跳过确认。

## 在代码中调用

每个命令都有对应的函数，可以在程序里执行同样的操作，例如在应用启动时迁移、在测试准备阶段重置数据库，或在部署脚本中检查偏差。迁移命令来自 `@ofis/tsorm/migrations`，`validate` 和 `generate` 来自 `@ofis/tsorm/schema`。

| 命令             | 函数                                     | 返回值                                                    |
| ---------------- | ---------------------------------------- | --------------------------------------------------------- |
| `migrate`        | `migrate({ name, createOnly, reset })`   | `{ migration?, applied, reset }`                          |
| `deploy`         | `deploy()`                               | `{ applied }`                                             |
| `deploy --check` | `status()`                               | `{ exitCode, local, applied, pending, failed, missing, message }` |
| `resolve`        | `resolve({ applied })` 或 `resolve({ rolledBack })` | 无                                             |
| `diff`           | `diff({ from, to })`                     | `{ diff, sql, summary }`；`diff.empty` 对应 `--check`     |
| `push`           | `push({ reset })`                        | `{ changed }`                                             |
| `validate`       | `parseSchema(source)`                    | 解析后的结构；无效时抛出 `SchemaError`                    |
| `generate`       | `generateClient(schema, runtimeImport)`  | 客户端源码字符串                                          |

所有迁移函数还接受以下公共选项：

| 选项                | 默认值          | 对应的 CLI 设置                    |
| ------------------- | --------------- | ---------------------------------- |
| `url`               | `file:./dev.db` | `DATABASE_URL`                     |
| `shadowDatabaseUrl` | 无              | `SHADOW_DATABASE_URL`              |
| `schema`            | `schema.orm`    | `--schema`                         |
| `cwd`               | `process.cwd()` | 当前目录，相对路径以它为基准       |
| `force`             | `false`         | `--force`                          |
| `prompt`            | 无              | 终端确认；传入带 `confirm(message): Promise<boolean>` 的对象 |
| `log`               | 不输出          | 进度输出                           |

与 CLI 的区别：

- **不读取环境变量。** 需要自行传入 `url: process.env.DATABASE_URL`，否则使用 `file:./dev.db`。
- **不打印任何内容**，除非传入 `log`，例如 `log: console.log`。
- **不会询问。** 没有 `prompt` 时，需要确认的步骤抛出 `NON_INTERACTIVE`；设置 `force: true` 表示接受。`confirm` 返回 `false` 时抛出 `ABORTED`。
- **错误以异常抛出，而不是退出码。** 迁移函数抛出带 `code` 的 `MigrationError`，例如 `NON_INTERACTIVE`、`DATABASE_NOT_FOUND`。`status` 和 `diff` 通过返回值报告结果，读取 `exitCode` 或 `diff.empty` 即可。

### 启动时迁移

```ts
import { deploy } from '@ofis/tsorm/migrations';

await deploy({ url: process.env.DATABASE_URL, log: console.log });
```

### 在部署脚本中检查

```ts
import { diff, status } from '@ofis/tsorm/migrations';

const url = process.env.DATABASE_URL;
const state = await status({ url });
if (state.exitCode !== 0) throw new Error(state.message);

const drift = await diff({ url, from: 'migrations', to: 'database' });
if (!drift.diff.empty) throw new Error(drift.summary);
```

### 重置测试数据库

```ts
import { push } from '@ofis/tsorm/migrations';

await push({ url: 'file:./test.db', reset: true, force: true });
```

### 生成客户端

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { generateClient, parseSchema } from '@ofis/tsorm/schema';

const schema = parseSchema(readFileSync('schema.orm', 'utf8'));
writeFileSync('generated/client.ts', generateClient(schema, '@ofis/tsorm'));
```

`runtimeImport` 是生成文件导入 `createClient` 和类型的模块，在应用中使用 `'@ofis/tsorm'`。`generateClient` 只返回源码，目标目录需要事先创建。

### 在自己的界面中确认

```ts
import { migrate, MigrationError } from '@ofis/tsorm/migrations';

try {
  await migrate({
    url: process.env.DATABASE_URL,
    name: 'add_profile',
    prompt: { confirm: async (message) => askUser(message) },
  });
} catch (error) {
  if (error instanceof MigrationError && error.code === 'ABORTED') console.log('已取消');
  else throw error;
}
```

`askUser` 代表你自己的确认对话框，返回 `true` 表示继续。
