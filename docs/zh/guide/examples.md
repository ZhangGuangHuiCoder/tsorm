---
description: 运行仓库内 SQLite、MySQL 和 PostgreSQL 的完整示例项目。
---

# 完整示例

源码仓库在 `examples/` 中提供一个完整示例：同一份模型和同一段代码，分别在 SQLite、MySQL 和 PostgreSQL 上运行。

| 文件                     | 内容                                   |
| ------------------------ | -------------------------------------- |
| `schema.orm`             | 模型                                   |
| `client.ts`              | 生成的客户端                           |
| `demo.ts`                | 演示脚本，根据命令行参数选择数据库     |
| `compose.yaml`           | 本地 MySQL、MariaDB（端口 3308）和 PostgreSQL 测试实例，均为最低版本 |

## 准备

该示例需要在源码仓库的本地克隆中运行。在仓库根目录执行：

```bash
bun install --frozen-lockfile
bun run build
bun run generate
```

## 运行

::: code-group

```bash [SQLite]
bun run example sqlite
```

```bash [MySQL]
docker compose -f examples/compose.yaml up -d --wait mysql
MYSQL_ALLOW_PUBLIC_KEY_RETRIEVAL=1 bun run example mysql
```

```bash [PostgreSQL]
docker compose -f examples/compose.yaml up -d --wait postgres
bun run example pgsql
```

:::

## 配置

| 环境变量                                                                | 适用范围   | 说明                                                  |
| ----------------------------------------------------------------------- | ---------- | ----------------------------------------------------- |
| `ORM_INITIALIZE`                                                        | 全部       | 默认初始化空库；已有匹配的表结构时设为 `0`            |
| `ORM_TIMEZONE`                                                          | 全部       | 客户端时区，默认 `+08:00`                             |
| `SQLITE_FILE`                                                           | SQLite     | 数据库文件，默认使用内存数据库                        |
| `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE` | MySQL      | 连接参数，默认指向 `compose.yaml` 中的本地测试实例    |
| `MYSQL_RSA_PUBLIC_KEY`                                                  | MySQL      | 可信的服务端 RSA 公钥                                 |
| `MYSQL_ALLOW_PUBLIC_KEY_RETRIEVAL`                                      | MySQL      | 设为 `1` 时允许自动获取公钥，仅用于本地测试           |
| `DATABASE_URL`                                                          | PostgreSQL | 连接字符串，优先于下面的连接参数                      |
| `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD`、`PGDATABASE`                | PostgreSQL | 连接参数，默认指向 `compose.yaml` 中的本地测试实例    |
| `PGSCHEMA`                                                              | PostgreSQL | 目标 schema，默认 `public`                            |

示例只清理本次运行创建的记录，不会删除整个数据库。

## 覆盖内容

示例覆盖：

- CRUD、关系查询和嵌套创建
- 批量写入和 `skipDuplicates`
- 事务提交与回滚
- 事件日志
- 类型化 JSON、软删除与恢复、虚拟字段和列表总数

- `createManyAndReturn` 与 `updateManyAndReturn`
