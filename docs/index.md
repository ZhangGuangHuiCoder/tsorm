---
layout: home
hero:
  name: TSORM
  text: A type-safe TypeScript ORM
  tagline: A model-definition DSL and one typed client for SQLite, MySQL / MariaDB, and PostgreSQL.
  actions:
    - theme: brand
      text: Getting Started
      link: /guide/getting-started
    - theme: alt
      text: Learn About the Project
      link: /guide/introduction
features:
  - title: Schema Definition
    details: Describe data and relations with models; foreign keys and client types are generated automatically.
    link: /guide/schema
  - title: Typed Queries
    details: Projections, relation filters, per-parent pagination, aggregations, and snapshot-consistent totals.
    link: /client/queries
  - title: Transactions & Relation Writes
    details: Nested writes run in one transaction; root calls join the current transaction automatically.
    link: /client/transactions
  - title: Built-in Capabilities
    details: Soft delete, typed JSON, fixed-offset timezones, and virtual fields out of the box.
    link: /client/soft-delete
  - title: Three Databases
    details: SQLite on node:sqlite, MySQL / MariaDB on mariadb, PostgreSQL on pg.
    link: /databases/overview
  - title: Clear Differences
    details: Per-database differences are documented, and invalid usage fails early with explicit error codes.
    link: /databases/overview
---
