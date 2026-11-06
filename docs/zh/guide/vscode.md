---
description: 为 .orm 文件提供语法高亮、格式化、补全和诊断的 VS Code 扩展。
---

# VS Code 扩展

扩展为 `.orm` 模型文件提供编辑支持。它自带解析器，不需要在项目中安装 ORM 或数据库驱动。

## 功能

- 语法高亮
- 文档格式化，保留注释、字符串、行尾注释和字段之间的单个空行
- 格式化时补全关系声明：关系字段按基数与持有方配对，数组侧补成 1:n 反向（`posts: Post[] @via(author)`），单个可空侧补成 1:1 反向（`profile?: Profile @via(user)`，并在持有方补 `@unique`）；数组关系在目标模型完全没有回指关系时，整段 1:n 关系补出来（`entries: AccountEntry[] @via(account)`，并在目标模型里补出 `account: Account`，持有方字段名沿用声明方模型名的小驼峰）；模型用 `@via(name)` 声明反向关系、而目标模型还没有 `name` 字段时，把持有方补到目标模型里（`account: A`）；模型里已声明解析器将要生成的外键列时，给关系字段补 `@relation(field: ...)`
- 模型、字段类型、属性、默认函数、关系字段、`@via`、`@relation` 选项和类型化 JSON 的补全，每项附写法示例；字段属性按当前字段的类型和形态过滤（标量字段不会提示 `@relation`、`@via`）
- 基于 ORM 解析器的实时诊断
- 悬停说明，关键字带示例
- 跳转到当前文件内的模型定义、`@via(x)` 指向的持有方字段，以及 `@relation(field: x)`、`@@index(...)` 等处引用的字段

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

模型存在语法错误时，需要先修复诊断才能格式化。

## 开发

```bash
bun run build
bun test ./test/vscode
```

扩展版本与根目录 `package.json` 的 `version` 一致，`bun run build` 时自动同步到扩展清单。

调试时，把 `extensions` 作为 Extension Development Path 启动 VS Code。
