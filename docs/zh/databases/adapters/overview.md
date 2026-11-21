---
description: 三个数据库适配器共用同一套模型语法和客户端 API；按需查看 SQLite、MySQL / MariaDB 和 PostgreSQL 的页面。
---

# 适配器

三个适配器共用一套模型语法和一套客户端 API，切换数据库无需重新生成；差别在底层驱动、连接模型和少量类型规则。每个适配器固定驱动选项和会话设置并把驱动错误映射到同一套错误码，物理类型对应关系见[类型映射](../overview.md#类型映射)。`createClient` 根据连接 URL 协议选择适配器，驱动加载和连接建立发生在首次数据库操作，创建客户端既不加载驱动也不访问数据库。

## 适配器对比

| 适配器                        | 连接模型                   |
| ----------------------------- | -------------------------- |
| [SQLite](./sqlite.md)         | 单个同步连接，请求排队执行 |
| [MySQL / MariaDB](./mysql.md) | 连接池，每个根请求一个连接 |
| [PostgreSQL](./postgres.md)   | 连接池，每个根请求一个连接 |

根请求的嵌套查询树或写入图共用该连接；同连接本身不保证共享快照，见[事务](../../client/transactions.md)。版本、驱动与能力见[能力对比](../overview.md)。

## 初始化与升级

适配器不负责建表。原型阶段用 [`tsorm push`](../migrations.md#push)，建表与结构升级请使用[版本化迁移](../migrations.md)。

## 如何选择

- [SQLite](./sqlite.md)：单文件或内存数据库，单连接事务，适合测试、本地开发和单节点部署。
- [MySQL / MariaDB](./mysql.md)：MySQL 8.0.16+ 或 MariaDB 10.6+（InnoDB）。DDL 隐式提交，迁移失败需要人工检查清理。
- [PostgreSQL](./postgres.md)：PostgreSQL 14+，`schema` 查询参数、原生 `BOOLEAN` 和 `IDENTITY` 类型。

## 下一步

- [SQLite](./sqlite.md)、[MySQL / MariaDB](./mysql.md)、[PostgreSQL](./postgres.md)：各自的连接选项、类型细节、初始化、写入、事务和错误映射
- [能力对比](../overview.md)：各数据库支持范围的并排对照
- [版本化迁移](../migrations.md)：对比 schema 结构并按顺序执行迁移
