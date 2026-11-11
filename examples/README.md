# 完整示例

一份模型（`schema.orm`）、一份生成的客户端（`client.ts`）和一份演示脚本（`demo.ts`），在 SQLite、MySQL 和 PostgreSQL 上运行同一段代码。

从仓库根目录运行：

```sh
bun install
bun run build
bun run example sqlite

docker compose -f examples/compose.yaml up -d --wait
bun run example mysql
bun run example pgsql
```

每次运行都会先重新生成客户端；不带数据库参数的 `bun run example` 只做生成。

示例使用包名导入，运行前需要构建；测试仍直接使用源码，不依赖构建。连接串内置在 `demo.ts` 中，无需环境变量，SQLite 使用独立内存库。

MySQL 和 PostgreSQL 需要空数据库。示例结束或中途失败时，都会尝试按本次运行的唯一标记清理记录，并在清理失败时关闭连接；不会删除表结构或重置数据库。再次运行服务端数据库示例前，需要自行准备空库，不能仅靠清理记录重复初始化。

## 阅读顺序

`demo.ts` 底部是执行入口，按以下分组调用演示函数：

| 函数                     | 内容                                     |
| ------------------------ | ---------------------------------------- |
| `createUser` / `queries` | 嵌套创建、查询、分页、聚合与客户端扩展   |
| `writes`                 | 单条与批量写入、原子更新和 upsert        |
| `transactions`           | 事务提交、主动回滚与真实错误透传         |
| `relations`              | 自关联、多态、多对多写入与 SetNull       |
| `scalars` / `rawSql`     | 复合唯一键、数字及二进制类型、参数化 SQL |
| `softDelete`             | 类型化 JSON、列表总数、软删除与恢复      |
| `cleanup`                | 在事务中清理本次数据，包含已软删除的记录 |

详细功能说明见 [完整示例文档](../docs/zh/guide/examples.md)。
