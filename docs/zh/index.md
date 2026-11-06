---
layout: home
hero:
  name: TSORM
  text: 类型安全的 TypeScript ORM
  tagline: 一套模型定义 DSL，一个类型安全客户端，覆盖 SQLite、MySQL / MariaDB 与 PostgreSQL。
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/guide/getting-started
    - theme: alt
      text: 了解项目
      link: /zh/guide/introduction
features:
  - title: 模型定义
    details: 用 model 描述数据与关系，外键和客户端类型自动生成。
    link: /zh/guide/schema
  - title: 类型化查询
    details: 支持投影、关系过滤、逐父记录分页、聚合和快照一致的总数。
    link: /zh/client/queries
  - title: 事务与关系写入
    details: 嵌套写入在一个事务内完成，根客户端调用自动加入当前事务。
    link: /zh/client/transactions
  - title: 内置能力
    details: 开箱提供软删除、类型化 JSON、固定偏移时区和虚拟字段。
    link: /zh/client/soft-delete
  - title: 三种数据库
    details: SQLite 基于 node:sqlite，MySQL / MariaDB 基于 mariadb，PostgreSQL 基于 pg。
    link: /zh/databases/overview
  - title: 清晰的差异
    details: 逐库说明实现差异，非法用法在执行前给出明确的错误码。
    link: /zh/databases/overview
---
