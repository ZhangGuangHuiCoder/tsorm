# 完整示例

同一份模型与同一段代码，在 SQLite、MySQL 和 PostgreSQL 上运行：模型见 `schema.orm`，生成的客户端见 `client.ts`，演示脚本见 `demo.ts`。

```sh
bun install
bun run build
bun run example sqlite

docker compose -f examples/compose.yaml up -d --wait
bun run example mysql
bun run example pgsql
```

每次运行都会重新生成 `client.ts`（git 忽略）；不带数据库参数时只生成。示例启动时通过迁移 API 的 `push` 建表并 `reset`，可重复运行。

完整说明、阶段划分与覆盖内容见 [完整示例文档](../docs/zh/guide/examples.md)。
