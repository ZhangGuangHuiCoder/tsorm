---
description: 运行仓库内 SQLite、MySQL 和 PostgreSQL 的完整示例项目。
---

# 完整示例

源码仓库在 `examples/` 中提供完整示例：同一份模型和同一段代码，分别运行在 SQLite、MySQL 和 PostgreSQL 上。

| 文件           | 内容                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `schema.orm`   | 模型                                                                 |
| `client.ts`    | 生成的客户端                                                         |
| `demo.ts`      | 演示脚本，根据命令行参数选择数据库                                   |
| `compose.yaml` | 本地 MySQL、MariaDB（端口 3308）和 PostgreSQL 测试实例，均为最低版本 |

## 准备

在源码仓库克隆的根目录执行：

```bash
bun install
bun run build
```

每次运行都会先重新生成示例客户端；不带数据库参数的 `bun run example` 只做生成（刷新 `examples/client.ts`）。测试客户端 `test/fixtures/client.ts` 只由 `bun run build` 重新生成，两者均为 git 忽略的产物。

## 运行

::: code-group

```bash [SQLite]
bun run example sqlite
```

```bash [MySQL]
docker compose -f examples/compose.yaml up -d --wait mysql
bun run example mysql
```

```bash [PostgreSQL]
docker compose -f examples/compose.yaml up -d --wait postgres
bun run example pgsql
```

:::

## 配置

连接串内置在 `demo.ts`，默认指向 `compose.yaml` 的本地实例（SQLite 用临时文件），`datetime` 列读回为 `Date` 对象。启动时通过迁移 API 和 `reset`（清空该模型的表）建表，每次运行都从干净状态开始，无需手动准备。退出时只关闭连接。

## 阅读顺序

`demo.ts` 底部的入口按顺序执行：嵌套创建与关系查询、写入与更新、事务提交与回滚、关系写入与引用动作、复合唯一键与标量、参数化 SQL、JSON 与软删除恢复、删除与外键级联，输出中用分组标题区分各阶段。

## 覆盖内容

- CRUD、关系查询和嵌套创建；事务提交、主动回滚与错误重抛
- 事件日志（`query`、`transaction`、`client`）；类型化 JSON、软删除与恢复
- 参照动作（`Cascade`、`SetNull`）与复合唯一键（`@@unique`）
- 非自增主键（`string(36) = uuid()`）与示例用到的标量类型（`int`、`bigint`、`decimal`、`bytes`、`boolean`、`datetime`、`string(n)`、`text`、字面量联合）
- 关系写入（`connect`、`connectOrCreate`）；`$queryRaw`、`$executeRaw` 与 `sql` 片段，按对应方言写入

## 下一步

- 同一流程的最小项目见[快速开始](./getting-started.md)，各功能的文档位置见[文档地图](./documentation.md)。
