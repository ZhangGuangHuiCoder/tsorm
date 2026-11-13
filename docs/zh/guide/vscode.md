---
description: 为 .orm 文件提供语法高亮、格式化、补全和诊断的 VS Code 扩展。
---

# VS Code 扩展

扩展为 `.orm` 模型文件提供编辑支持。它自带解析器，不需要在项目中安装 ORM 或数据库驱动。

## 功能

- 语法高亮
- 文档格式化，保留注释、字符串、行尾注释和字段之间的单个空行
- 基于 ORM 解析器的实时诊断，不同语句里的错误可以一次报出多个
- 悬停说明，关键字带示例，模型显示字段列表，JSON 类型别名与字段显示声明原文
- 跳转到当前文件内的模型定义、JSON 类型别名、`@via(x)` 指向的持有方字段，以及 `@relation(field: x)`、`@@index(...)` 等处引用的字段
- 模型、JSON 类型别名、字段类型、属性、默认函数、关系字段、`@via`、`@relation` 选项和类型化 JSON 的补全，每项附写法示例
- 大纲与面包屑：模型及其字段、JSON 类型别名；工作区符号搜索跨 `.orm` 文件查找模型与别名
- 模型、JSON 类型别名与字段的查找引用和重命名，覆盖工作区内 `@via`、`@relation(field: ...)`、`morph(...)` 绑定和模型级属性里的引用
- 诊断上的快速修复：不格式化整个文件也能补全缺失的关系声明

字段属性按当前字段的类型和形态过滤，标量字段不会提示 `@relation` 或 `@via`。

### 关系补全

格式化时，关系字段会与目标模型中的持有方配对，声明侧成为反向侧并补上 `@via(...)`：

| 声明字段            | 目标模型中的持有方 | 补充内容                                            |
| ------------------- | ------------------ | --------------------------------------------------- |
| `posts: Post[]`     | `author: User`     | `posts` 补 `@via(author)`                           |
| `profile?: Profile` | `user: User`       | `profile` 补 `@via(user)`，同时 `user` 补 `@unique` |

单条反向字段必须可空，持有方外键必须唯一，因此可空的单条字段配成一对一，数组字段配成一对多。

数组关系在目标模型完全没有回指关系时，整段一对多关系会被补出来：目标模型得到以声明方模型小驼峰命名的持有方字段，声明侧补 `@via(...)`，例如 `entries: AccountEntry[] @via(account)` 搭配目标模型中的 `account: Account`。

模型用 `@via(name)` 声明反向关系、而目标模型还没有 `name` 字段时，持有方会创建在目标模型中，例如 `account: A`。

模型已声明解析器将要生成的关系列时，关系字段会补 `@relation(field: ...)`。

同样的补全也作为解析器诊断上的快速修复提供，不必格式化文件即可应用。

## 安装

在 VS Code 扩展面板中搜索 **TSORM** 并安装，或在命令行运行：

```bash
code --install-extension ofis.tsorm
```

要求 VS Code 1.85 及以上。扩展 ID 为 `ofis.tsorm`。

## 保存时格式化

在 `settings.json` 中添加：

```json
{
  "[tsorm]": {
    "editor.defaultFormatter": "ofis.tsorm",
    "editor.formatOnSave": true
  }
}
```

格式化先尝试补全关系，再解析结果；若仍有诊断导致格式化失败，需要先修复这些错误。

只想让格式化调整排版时，关闭关系补全：

```json
{
  "tsorm.format.completeRelations": false
}
```

## 开发

```bash
bun run build
bun test ./extensions/test
```

扩展版本与根目录 `package.json` 的 `version` 一致，`bun run build` 时自动同步到扩展清单。

调试时，把 `extensions` 作为 Extension Development Path 启动 VS Code。

## 下一步

- [模型与字段](../schema/overview.md)：扩展高亮与补全的语法
- [开发与验证](./development.md)：扩展如何构建与测试
