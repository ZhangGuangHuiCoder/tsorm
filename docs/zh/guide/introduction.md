---
description: TSORM 的定位、工作方式、支持范围、安装方式与版本策略。
---

# 简介

TSORM（`@ofis/tsorm`）是一个 TypeScript ORM：在 `schema.orm` 文件中定义模型，由生成器输出类型安全的客户端，再通过适配器连接数据库。

## 工作方式

1. **定义模型**：在 `schema.orm` 中描述字段、关系和约束。模型始终以该文件为准。
2. **生成客户端**：`tsorm generate` 输出与数据库无关的 TypeScript 客户端。
3. **选择适配器**：创建客户端时传入 `sqlite()`、`mysql()` 或 `postgres()`，切换数据库无需重新生成。
4. **管理结构**：用版本化迁移管理结构变更；原型阶段也可以用 `push` 或 `initialize`。

## 支持范围

| 项目       | 最低版本                                        | 推荐版本 |
| ---------- | ----------------------------------------------- | -------- |
| Node.js    | 22.15                                           | 26 LTS   |
| SQLite     | 使用 Node.js 内置的 `node:sqlite`，无需额外驱动 | —        |
| MySQL      | 8.0.16，使用 `mariadb` 客户端                   | 8.4 LTS  |
| MariaDB    | 10.6，使用 `mariadb` 客户端                     | 11.4 LTS |
| PostgreSQL | 14，使用 `pg` 客户端                            | 16       |

包要求 Node.js 22.15+。当前发布工作流使用 Bun 构建和测试，没有 Node.js 多版本测试矩阵；数据库最低版本由适配器校验。数据库测试范围的选择见[开发与验证](./development.md)。

各数据库的功能差异见[能力对比](../databases/overview.md)。

## 安装

```bash
npm install @ofis/tsorm
```

客户端 API 从 `@ofis/tsorm` 导入；适配器使用 `@ofis/tsorm/adapters/sqlite`、`/mysql` 或 `/postgres` 等具体入口，不存在聚合的 `@ofis/tsorm/adapters` 入口。模型工具与迁移 API 分别从 `@ofis/tsorm/schema` 和 `@ofis/tsorm/migrations` 导入。本地安装后通过 package script 或 `npx tsorm` 调用 CLI。

## 版本策略

::: info 0.x 阶段
项目当前处于 `0.x` 阶段，次版本升级（如 `0.14` 到 `0.15`）可能包含破坏性变更。建议锁定依赖版本，升级前确认变更内容。
:::

## 下一步

- 跟随[快速开始](./getting-started.md)运行第一个查询。
- 阅读[模型定义](../schema/overview.md)了解完整的 DSL 语法。
