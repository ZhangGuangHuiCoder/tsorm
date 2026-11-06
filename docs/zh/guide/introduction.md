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
| Node.js    | 24.10                                           | 24 LTS   |
| SQLite     | 使用 Node.js 内置的 `node:sqlite`，无需额外驱动 | —        |
| MySQL      | 8.0，使用 `mariadb` 客户端                   | 8.4 LTS  |
| MariaDB    | 10.6，使用 `mariadb` 客户端                     | 11.4 LTS |
| PostgreSQL | 14，使用 `pg` 客户端                            | 16       |

测试在最低版本上运行。

各数据库的功能差异见[能力对比](../databases/overview.md)。

## 安装

```bash
npm install @ofis/tsorm
```

安装后 `@ofis/tsorm`、`@ofis/tsorm/adapters`、`@ofis/tsorm/migrations` 等导入路径均可解析，并提供 `tsorm` 命令。

## 版本策略

::: info 0.x 阶段
项目当前处于 `0.x` 阶段，次版本升级（如 `0.14` 到 `0.15`）可能包含破坏性变更。建议锁定依赖版本，升级前确认变更内容。
:::

## 下一步

- 跟随[快速开始](./getting-started.md)运行第一个查询。
- 阅读[模型定义](./schema.md)了解完整的 DSL 语法。
