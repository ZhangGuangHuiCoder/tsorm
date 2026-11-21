---
description: 用 migrate、deploy、resolve、diff 和 push 管理数据库结构。
---

# 版本化迁移

支持 SQLite、MySQL / MariaDB 和 PostgreSQL；迁移是纯 SQL 文件。开发阶段会检测手改过的数据库，迁移失败会阻止后续部署。所有标志见 [CLI 选项](../reference/cli/options.md)。

## 快速开始

无需配置，默认使用当前目录的 `schema.orm` 和 SQLite 数据库 `dev.db`：

```bash
tsorm migrate          # 开发：生成并应用迁移
tsorm deploy           # 上线：应用待执行的迁移
```

## 默认值

默认使用 `schema.orm`、`file:./dev.db` 和 schema 文件旁的 `migrations/` 目录。用 `DATABASE_URL` 和 `--schema` 覆盖，见[选项与行为](../reference/cli/options.md)。

## migrate

```bash
tsorm migrate
```

按顺序执行：数据库不存在则创建；检查[漂移](#漂移与重置)、失败或被修改的迁移，需要重置时询问确认；应用待执行的迁移；再将模型与历史比对，应用新的 `migrations/<timestamp>_<name>.sql`（无变更时输出 `Already in sync`）。`--create-only` 只写入新文件而不应用，但仍处理漂移/重置并应用既有待执行迁移；风险仍会评估和输出，只是不阻止生成或询问确认。只想生成 SQL、不修改目标业务数据库时请用 `diff`。

::: danger 仅用于开发数据库
`migrate` 可能清空目标数据库。生产环境请改用 `deploy`。
:::

### 需要确认的变更

| 类型     | 示例                                                               | 处理                                 |
| -------- | ------------------------------------------------------------------ | ------------------------------------ |
| 数据丢失 | 删除非空表或有值的列、修改有值列的类型、在有数据的表上新增唯一约束 | 终端中确认；非交互环境需要 `--force` |
| 无法执行 | 在非空表中新增无默认值的必填列、把含 `NULL` 的列改为必填           | 报 `UNEXECUTABLE_MIGRATION`          |

需要手工改写 SQL 的场景（重命名列、回填数据）先生成文件（重命名字段会生成删除加新增，需手工改成 rename 才能保留数据）：

```bash
tsorm migrate --name rename_column --create-only
# 编辑 migrations/<时间戳>_rename_column.sql
tsorm migrate
```

## deploy

```bash
tsorm deploy --check   # 只检查，不执行
tsorm deploy           # 应用待执行的迁移
```

按时间戳顺序应用待执行迁移，不询问确认。数据库不存在则创建；没有[基线](#接入已有数据库)时抛出 `DATABASE_NOT_EMPTY`，存在失败迁移时抛出 `FAILED_MIGRATIONS`（先用 `resolve` 处理），已应用文件被改动时仅输出警告。`--check` 是只读检查：最新返回 0，否则返回 1——适合用作 CI 部署前检查。

## resolve

迁移失败会阻止后续部署。先检查数据库、修复其真实状态；`resolve` 只更新历史，不执行迁移 SQL：

| 实际状态                         | 后续操作                                                     |
| -------------------------------- | ------------------------------------------------------------ |
| 失败已回滚，或部分变更已手动撤销 | `tsorm resolve --rolled-back <名称>`，修正 SQL 后再 `deploy` |
| 迁移的全部变更已手动补完         | `tsorm resolve --applied <名称>`                             |
| 已有结构与初始迁移一致           | 使用 `--applied` 登记[基线](#接入已有数据库)                 |

`--rolled-back` 不会撤销 DDL；`--applied` 不会校验结构是否与 SQL 一致。

| 数据库          | 失败边界                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| SQLite          | 执行器将每个迁移包在事务内，提交前检查外键；脚本应把事务控制交给执行器。 |
| PostgreSQL      | 整个脚本作为一次多语句查询发送；脚本未自行引入事务边界时使用隐式事务。   |
| MySQL / MariaDB | DDL 隐式提交，失败前的变更可能保留，需检查后手动补完或撤销。             |

工具不会还原任何数据库快照；部署前请自行备份，并审查手写的 SQL。

## diff

`diff` 不会修改目标业务数据库，但通常会使用[影子库](#影子库)。默认输出「迁移历史 → 模型」的 SQL，即下一次 `migrate` 会生成的内容：

```bash
tsorm diff                          # 迁移历史 → 模型
tsorm diff --from database          # 数据库 → 模型
tsorm diff --from empty > init.sql  # 完整建表 SQL
tsorm diff --check                  # 只输出摘要，有差异时返回 2
```

`--from empty --to schema` 可离线生成 DDL；其他源组合可能使用影子库——来源选项见 [CLI 选项](../reference/cli/options.md)。`tsorm diff --check` 可在 CI 中发现漏提交的迁移。

## push

```bash
tsorm push
```

不生成迁移文件，直接把数据库同步到与模型一致，适合本地原型。`--force` 接受数据丢失风险，`--reset` 先清空数据。持久业务数据请先登记[基线](#接入已有数据库)再用 `migrate` / `deploy`。

## 漂移与重置

漂移指开发库与迁移历史不一致，例如手工创建了表。`migrate` 会列出差异并询问确认后再重置：

```text
Drift detected: Your database schema is not in sync with your migration history.

[+] Added tables
  - manual
```

主动重置：`tsorm migrate --reset` 会清空全部表和数据，重新应用所有迁移，再照常检查模型变更。

## 忽略的表

一旦 schema 声明了 `ignore` 表（见[忽略表](../schema/overview.md#忽略表)）：漂移检测、`diff` 和 `push` 不会生成删除它们的语句；`--reset` 只删除本 schema 的表和视图（PostgreSQL 逐表 `DROP ... CASCADE`）；`deploy` 判断空库时不计入被忽略的表。

## 接入已有数据库

先确认 `tsorm diff --from database --check` 返回 0，再登记基线：

```bash
mkdir -p migrations
tsorm diff --from empty > migrations/00000000000000_init.sql
tsorm resolve --applied 00000000000000_init
tsorm deploy
```

`resolve --applied` 只登记，不执行该迁移的 SQL；登记前请审查基线文件，检查与登记使用同一数据库配置。

## 迁移文件

```text
schema.orm
migrations/
├── 20261103020000_init.sql
├── 20261103030000_update.sql
└── migration_lock.toml
```

文件名为 `<时间戳>_<名称>.sql`：时间戳是 UTC 生成时间 `YYYYMMDDHHMMSS`（14 位），按升序执行；名称中除字母、数字、下划线外的字符都会变成 `_`。迁移名即去掉 `.sql` 的文件名（`resolve` 使用该名称）。尚未应用的文件可手工编辑；不合命名规则的文件抛出 `INVALID_MIGRATION_FILE`。时间戳有问题时不会自动调整，工具抛出 `MIGRATION_TIMESTAMP_CONFLICT`：

| 情况                               | 原因                                                 | 处理                         |
| ---------------------------------- | ---------------------------------------------------- | ---------------------------- |
| 两个文件的时间戳相同               | 多人在同一秒生成，或手动命名重复                     | 修改其中一个文件的时间戳     |
| 新迁移的时间戳不大于最新的已有文件 | 同一秒内连续生成、系统时钟偏差、手动写了未来的时间戳 | 稍后重试，或检查时钟和文件名 |

`migration_lock.toml` 记录数据库类型；切换类型会抛出 `PROVIDER_MISMATCH`。请把整个目录提交到版本控制。迁移记录保存在数据库的 `_tsorm_migrations` 表中（有[表前缀](../schema/overview.md#表前缀)时为 `<前缀>_tsorm_migrations`）：

| 列                          | 说明                                           |
| --------------------------- | ---------------------------------------------- |
| `migration_name`            | 迁移名称，即不含 `.sql` 的文件名               |
| `checksum`                  | 迁移文件的 SHA-256，用于发现被修改的迁移       |
| `started_at`、`finished_at` | 开始和完成时间，失败时 `finished_at` 为 `NULL` |
| `rolled_back_at`            | 被 `resolve --rolled-back` 标记的时间          |
| `logs`                      | 失败时的错误信息                               |

## 影子库

影子数据源每次使用前都会被清空，必须专用于迁移：MySQL / MariaDB 要求不同的数据库名，PostgreSQL 要求不同的数据库名或 schema——即使主机不同也拒绝相同的命名空间，因此改写凭据、默认端口或 URL 方案不算隔离。`migrate` 和大多数 `diff` 来源组合需要它来重放迁移；在 MySQL 和 PostgreSQL 上 `push` 也需要。

| 数据库     | 默认行为                                                | 权限要求              |
| ---------- | ------------------------------------------------------- | --------------------- |
| SQLite     | 使用内存数据库                                          | 无                    |
| PostgreSQL | 在同一服务器上创建 `tsorm_shadow_db_<随机值>`，用完删除 | `CREATEDB` 或超级用户 |
| MySQL      | 同上                                                    | 建库和删库权限        |

没有建库权限时，用 `SHADOW_DATABASE_URL` 指向一个专用空库；它每次使用前都会被清空，切勿指向真实数据。

## 设计说明

- **目标 schema**：模型的 DDL 实际在影子库中执行并读回，比较结果由数据库自身归一化。
- **SQLite 事务**：每个迁移在一个事务内执行，脚本里不能再用 `BEGIN`/`COMMIT`；重建表时保留 `AUTOINCREMENT` 高水位。

## 程序 API

见[在代码中调用](../reference/cli/programmatic.md)了解函数形式、选项和部署检查。

## 下一步

- [CLI](../reference/cli/overview.md#命令)：全部迁移命令与选项
- [命令示例](../reference/cli/commands.md)：每个命令的常见调用
- [能力对比](./overview.md)：影响迁移的数据库差异
