# 完整示例

一份模型（`schema.orm`）、一份生成的客户端（`client.ts`）和一份演示脚本（`demo.ts`），在 SQLite、MySQL 和 PostgreSQL 上运行同一段代码。

从仓库根目录运行：

```sh
bun install --frozen-lockfile
bun run build
bun run generate
bun run example sqlite

docker compose -f examples/compose.yaml up -d --wait
MYSQL_ALLOW_PUBLIC_KEY_RETRIEVAL=1 bun run example mysql
bun run example pgsql
```

默认初始化空数据库；已有匹配的表结构时设置 `ORM_INITIALIZE=0`。示例只清理本次创建的数据。连接变量见 `demo.ts` 和 `docs/guide/examples.md`。
