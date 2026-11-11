---
description: tsorm 命令行工具的调用方式和全部命令。
---

# CLI

安装 `@ofis/tsorm` 后提供 `tsorm` 命令：

```bash
tsorm <command> [options]
```

- 安装在项目中时，在 `package.json` 的 `scripts` 里直接写 `tsorm`，例如 `"db:migrate": "tsorm migrate"`。
- 全局安装（`npm install -g @ofis/tsorm`）后，可在任意终端直接运行。
- 临时运行而不安装时，使用完整包名：`npx @ofis/tsorm <command>`。

多数命令可使用默认值；`resolve` 必须且只能指定 `--applied` 或 `--rolled-back` 之一。路径相对于当前目录。失败时，错误输出到标准错误，退出码为 1。

## 命令

全部命令按用途分为三组。

### 迁移命令

生成、应用和修复版本化迁移：

| 命令      | 说明                           | 选项                                            |
| --------- | ------------------------------ | ----------------------------------------------- |
| `migrate` | 根据模型生成并应用迁移（开发） | `--name`、`--create-only`、`--reset`、`--force` |
| `deploy`  | 应用待执行的迁移（上线）       | `--check`                                       |
| `resolve` | 记录恢复结果或登记基线         | `--applied <名称>` 或 `--rolled-back <名称>`    |

迁移相关命令的说明见[版本化迁移](../../databases/migrations.md)。

### 同步命令

对比结构（`diff` 默认以迁移历史为来源），或直接同步而不登记迁移（`push`）：

| 命令   | 说明                   | 选项                        |
| ------ | ---------------------- | --------------------------- |
| `diff` | 输出两份结构之间的 SQL | `--from`、`--to`、`--check` |
| `push` | 不经迁移，直接同步结构 | `--reset`、`--force`        |

### 模型工具命令

校验模型文件并生成客户端：

| 命令       | 说明                   | 选项                                       |
| ---------- | ---------------------- | ------------------------------------------ |
| `validate` | 校验模型文件           | 无                                         |
| `generate` | 生成 TypeScript 客户端 | `--out <文件>`，默认 `generated/client.ts` |

## 下一步

- [选项与行为](./options.md)：每个选项、环境变量、退出码与确认交互
- [命令示例](./commands.md)：各命令的常用调用方式
- [在代码中调用](./programmatic.md)：每个命令对应的函数
