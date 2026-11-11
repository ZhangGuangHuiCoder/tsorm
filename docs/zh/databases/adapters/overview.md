---
description: 三个数据库适配器共用同一套模型语法和客户端 API；按需查看 SQLite、MySQL / MariaDB 和 PostgreSQL 的页面。
---

# 适配器

三个适配器共用一套模型语法和一套客户端 API，切换数据库无需重新生成。不同之处在于底层驱动、连接模型和少量类型规则。每个适配器都会固定驱动选项和会话设置，以保证结果被正确解码，并把驱动错误映射到同一套错误码。物理类型对应关系见[类型映射](../overview.md#类型映射)。

## 适配器对比

| 适配器                        | 连接模型                   |
| ----------------------------- | -------------------------- |
| [SQLite](./sqlite.md)         | 单个同步连接，请求排队执行 |
| [MySQL / MariaDB](./mysql.md) | 连接池，每个根请求一个连接 |
| [PostgreSQL](./postgres.md)   | 连接池，每个根请求一个连接 |

根请求的嵌套查询树或写入图共用该连接。同连接本身不保证共享快照，见[事务](../../client/transactions.md)。版本、驱动与能力统一见[能力对比](../overview.md)。

## 初始化与升级

`initialize: true` 为新数据库创建全部表和索引，它不是迁移手段：

| 适配器                        | `initialize: true` 的前置条件                                 | 失败时的行为                       |
| ----------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| [SQLite](./sqlite.md)         | 没有业务表或视图，否则报 `DATABASE_NOT_EMPTY`                 | 整体回滚 DDL 并关闭连接            |
| [MySQL / MariaDB](./mysql.md) | 所选数据库为空，否则报 `DATABASE_NOT_EMPTY`                   | DDL 隐式提交，可能留下部分表       |
| [PostgreSQL](./postgres.md)   | 目标 schema 中没有表、视图和序列，否则报 `DATABASE_NOT_EMPTY` | 整体回滚 DDL，并释放 advisory lock |

已有数据库的结构升级请使用[版本化迁移](../migrations.md)。同一个数据库只由一个进程初始化。

## 如何选择

- [SQLite](./sqlite.md)：单文件或内存数据库，无需独立服务，采用单连接事务模型。适合测试、本地开发和单节点部署。
- [MySQL / MariaDB](./mysql.md)：MySQL 8.0.16+ 或 MariaDB 10.6+，表必须使用 InnoDB。DDL 隐式提交，迁移失败后需要人工检查和清理。
- [PostgreSQL](./postgres.md)：PostgreSQL 14+，可以用 `dbSchema` 把表放进专用 schema，并使用原生 `BOOLEAN` 和 `IDENTITY` 类型。

## 下一步

- [SQLite](./sqlite.md)、[MySQL / MariaDB](./mysql.md)、[PostgreSQL](./postgres.md)：各自的连接选项、类型细节、初始化、写入、事务和错误映射
- [能力对比](../overview.md)：各数据库支持范围的并排对照
- [版本化迁移](../migrations.md)：对比 schema 结构并按顺序执行迁移
