---
description: TSORM 的定位、工作方式、支持范围、安装与版本策略。
---

# 简介

TSORM（`@ofis/tsorm`）是一个 TypeScript ORM：在 `schema.orm` 中定义模型，生成类型安全的客户端，通过适配器连接数据库。

## 工作方式

1. **定义并生成**：在 `schema.orm` 中描述字段、关系和约束（模型始终以该文件为准），再运行 `tsorm generate` 输出与数据库无关的客户端。
2. **选择数据库**：创建客户端时传入 `file:`、`mysql://`（或 `mariadb://`）或 `postgresql://` 连接 URL，切换无需重新生成。
3. **管理结构**：正式项目用版本化迁移，原型阶段用 `push`。

## 支持范围

| 项目       | 最低版本                                        | 推荐版本 |
| ---------- | ----------------------------------------------- | -------- |
| Node.js    | 22.15                                           | 26 LTS   |
| SQLite     | 使用 Node.js 内置的 `node:sqlite`，无需额外驱动 | —        |
| MySQL      | 8.0.16，使用 `mariadb` 客户端                   | 8.4 LTS  |
| MariaDB    | 10.6，使用 `mariadb` 客户端                     | 11.4 LTS |
| PostgreSQL | 14，使用 `pg` 客户端                            | 16       |

要求 Node.js 22.15+；数据库最低版本由适配器校验。测试范围见[开发与验证](./development.md)；各数据库功能差异见[能力对比](../databases/overview.md)。

## 安装

```bash
npm install @ofis/tsorm
```

先生成客户端，再从 `./generated/client.ts` 导入 `createClient(options)`；适配器按 `connection` URL 的 scheme 自动选择。根入口 `@ofis/tsorm`（`internalCreateClient`）与 `@ofis/tsorm/adapters/*` 入口仅供高级场景使用，不存在聚合的 adapters 入口。模型与迁移 API 分别从 `@ofis/tsorm/schema`、`@ofis/tsorm/migrations` 导入。CLI 通过 package script 或 `npx tsorm` 运行。

## 版本策略

::: info 0.x 阶段
项目处于 `0.x` 阶段，次版本升级（如 `0.14` 到 `0.15`）可能包含破坏性变更。请锁定依赖版本，升级前确认变更内容。
:::

## 下一步

- 用[快速开始](./getting-started.md)运行第一个查询，完整 DSL 语法见[模型定义](../schema/overview.md)。
