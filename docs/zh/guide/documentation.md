---
description: 按任务查找文档，了解各类内容的维护位置。
---

# 文档导航

首次接入请从[快速开始](./getting-started.md)开始，之后按当前任务阅读。

| 任务           | 阅读内容                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 定义数据       | [模型与字段](../schema/overview.md)、[模型属性](../schema/attributes.md)、[关系](../schema/relations/overview.md)               |
| 查询与统计     | [查询](../client/queries.md)、[聚合与分组](../client/aggregations.md)                                                           |
| 写入数据       | [新增](../client/create.md)、[更新](../client/update.md)、[删除](../client/delete.md)、[关系写入](../client/relation-writes.md) |
| 协调多步操作   | [事务](../client/transactions.md)、[原生 SQL](../client/raw-sql.md)                                                             |
| 连接与部署     | [数据库能力](../databases/overview.md)、[适配器](../databases/adapters/overview.md)、[版本化迁移](../databases/migrations.md)   |
| 查询接口与错误 | [客户端 API](../reference/client-api.md)、[CLI](../reference/cli/overview.md)、[错误码](../reference/errors.md)                 |
| 维护仓库       | [开发与验证](./development.md)、[完整示例](./examples.md)、[VS Code 扩展](./vscode.md)                                          |

## 分类标准

- **入门与开发**：环境配置、完整示例与贡献流程。
- **模型定义**：`schema.orm` 中的声明，包括字段、约束、关系、类型化 JSON 与软删除。
- **客户端**：查询、写入、事务语义与运行时配置。
- **数据库**：物理类型映射、适配器配置与迁移工作流。
- **API 参考**：接口速查与逐项命令参数；迁移工作流通过链接引用参数说明。

## 能力分布

专题按声明或配置它的模块归类：

| 专题                                      | 声明或配置入口                                         |
| ----------------------------------------- | ------------------------------------------------------ |
| [类型化 JSON](../schema/json.md)          | `json<T>`                                              |
| [软删除](../schema/soft-delete.md)        | `@@softDelete`                                         |
| [日期与时区](../client/datetime.md)       | `datetime` / `timestamp`、`timezone`、`datetimeFormat` |
| [扩展与字段排除](../client/extensions.md) | `$extend({ virtuals, omit })`                          |
| [虚拟字段](../client/virtual-fields.md)   | `$extend({ virtuals })`                                |
| [事件日志](../client/logging.md)          | `logger`                                               |

## 下一步

- [快速开始](./getting-started.md)：运行第一个查询
- [项目概述](./introduction.md)：项目定位与支持版本
