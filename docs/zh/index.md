---
layout: home
hero:
  name: TSORM
  text: 类型安全的 TypeScript ORM
  tagline: 一套模型定义 DSL，一套 API，覆盖 SQLite、MySQL / MariaDB 与 PostgreSQL。
  image:
    src: /logo.svg
    alt: TSORM
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/guide/getting-started
    - theme: alt
      text: 文档导航
      link: /zh/guide/documentation
features:
  - icon: |-
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z"/><path d="M3 7.5 12 12l9-4.5"/><path d="M12 12v9"/></svg>
    title: 模型定义
    details: 在 schema.orm 中描述模型、字段与关系，外键、索引和类型安全客户端自动生成。
    link: /zh/schema/overview
    linkText: 了解更多
  - icon: |-
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m7.5 10 2.5 2.5-2.5 2.5"/><path d="M13 15h3.5"/></svg>
    title: 一套 API
    details: 用一套类型安全 API 在 SQLite、MySQL / MariaDB 与 PostgreSQL 上查询、聚合和写入，嵌套写入自动在事务中完成。
    link: /zh/client/overview
    linkText: 了解更多
  - icon: |-
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6L5.7 9.8l4.6-1.7L12 3.5Z"/><path d="M18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></svg>
    title: 内置能力
    details: 软删除、类型化 JSON、虚拟字段与事件日志，随声明或配置它们的模块一起说明，见文档导航的能力分布。
    link: /zh/guide/documentation
    linkText: 了解更多
---
