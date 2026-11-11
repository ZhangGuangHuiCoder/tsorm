---
description: 运行仓库内 SQLite、MySQL 和 PostgreSQL 的完整示例项目。
---

# 完整示例

源码仓库在 `examples/` 中提供一个完整示例：同一份模型和同一段代码，分别在 SQLite、MySQL 和 PostgreSQL 上运行。

| 文件           | 内容                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `schema.orm`   | 模型                                                                 |
| `client.ts`    | 生成的客户端                                                         |
| `demo.ts`      | 演示脚本，根据命令行参数选择数据库                                   |
| `compose.yaml` | 本地 MySQL、MariaDB（端口 3308）和 PostgreSQL 测试实例，均为最低版本 |

## 准备

该示例需要在源码仓库的本地克隆中运行。在仓库根目录执行：

```bash
bun install
bun run build
```

每次运行都会先重新生成客户端：不带数据库参数的 `bun run example` 只做生成，用于刷新 `examples/client.ts` 与 `test/fixtures/client.ts`。

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

示例不需要任何环境变量：连接串内置在 `demo.ts` 中，默认指向 `compose.yaml` 的本地实例（SQLite 使用内存库），客户端时区固定为 `+08:00`。

示例在空库中建表。无论演示成功还是中途失败，都会尝试在事务中清理本次创建的记录（包括软删除记录）；清理失败也会关闭连接。示例不会删除表结构或重置数据库，重新运行 MySQL 或 PostgreSQL 前需要自行准备空库。

## 阅读顺序

`demo.ts` 底部保留执行入口，各组演示按查询、写入、事务、关系、标量、原生 SQL、软删除的顺序调用具名函数，最后演示删除与外键级联。`cleanup` 统一负责收尾，输出中用分组标题区分各阶段。

## 覆盖内容

示例覆盖：

- CRUD、关系查询和嵌套创建
- 批量写入和 `skipDuplicates`
- 事务提交与回滚
- 事件日志：`query`、`transaction`、`client` 三类事件
- 类型化 JSON、软删除与恢复、虚拟字段和列表总数
- `createManyAndReturn` 与 `updateManyAndReturn`
- 参照动作（`Cascade`、`SetNull`）与自关联（`Category` 树 + `User.following` 多对多）
- 多态关联，显式形态 `Attachment.owner` 与短形式 `Note.holder` 均演示
- 复合唯一键（`@@unique`）、模型级索引（`@@index`）与名称映射（`@map`、`@@map`）
- 非自增主键（`string(36) = uuid()`）与示例涉及的标量类型（`int`、`bigint`、`decimal`、`bytes`、`boolean`、`datetime`、`string(n)`、`text`、字面量联合）
- `@updatedAt` 时间列与字面量联合默认值
- 关系写入：`connect`、`connectOrCreate`、`set`、`disconnect`
- `$executeRaw` 与 `sql` 片段，使用对应方言的静态标识符并绑定数据值
- `$extend` 链式：基础客户端配 virtuals，再叠一层 `omit`

## 下一步

- [快速开始](./getting-started.md)：同一流程的最小项目
- [文档地图](./documentation.md)：各功能的文档位置
