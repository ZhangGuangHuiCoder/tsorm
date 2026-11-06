---
description: 用 migrate、deploy、resolve、diff 和 push 管理数据库结构。
---

# 版本化迁移

迁移工具支持 SQLite、MySQL / MariaDB 和 PostgreSQL。迁移是普通的 SQL 文件，开发时自动检测数据库是否被手动改动，失败的迁移会阻止后续部署。

| 命令      | 用途                                   | 使用场景           |
| --------- | -------------------------------------- | ------------------ |
| `migrate` | 根据模型生成并应用迁移                 | 开发时，修改模型后 |
| `deploy`  | 应用待执行的迁移                       | 上线、CI           |
| `resolve` | 处理失败的迁移                         | 生产迁移失败后     |
| `diff`    | 输出两份结构之间的 SQL                 | 审查、建立基线     |
| `push`    | 不经迁移，直接同步结构                 | 原型阶段           |

## 快速开始

不需要任何配置，默认使用当前目录的 `schema.orm` 和 SQLite 数据库 `dev.db`：

```bash
tsorm migrate          # 开发：生成并应用迁移
tsorm deploy           # 上线：应用待执行的迁移
```

## 默认值

| 项目         | 默认值                         | 修改方式                       |
| ------------ | ------------------------------ | ------------------------------ |
| 数据库       | `file:./dev.db`（SQLite）      | 环境变量 `DATABASE_URL`        |
| 模型文件     | `schema.orm`                   | `--schema <文件>`              |
| 迁移目录     | 模型文件旁的 `migrations/`     | 随模型文件位置变化             |
| 迁移名称     | 第一次为 `init`，之后为 `update` | `--name <名称>`              |
| 影子库       | 自动创建临时库                 | 环境变量 `SHADOW_DATABASE_URL` |

数据库类型由 URL 判断：

| 数据库     | `DATABASE_URL` 示例                                     |
| ---------- | ------------------------------------------------------- |
| SQLite     | `file:./dev.db`，路径相对于当前目录                     |
| PostgreSQL | `postgresql://user:password@host:5432/db?schema=public`，`schema` 默认 `public` |
| MySQL      | `mysql://user:password@host:3306/db`，查询参数作为 `mariadb` 连接选项 |

## migrate

修改 `schema.orm` 后运行：

```bash
tsorm migrate
```

它会依次完成：

1. 数据库不存在时创建它。
2. 检查开发库是否被手动改动（[漂移](#漂移与重置)），或存在失败、被修改的迁移。有问题时请求确认后重置开发库。
3. 应用尚未执行的迁移。
4. 对比迁移历史与模型，生成 `migrations/<时间戳>_<名称>.sql` 并应用。

模型没有变化时输出 `Already in sync`，不生成文件。

| 参数            | 说明                                                 |
| --------------- | ---------------------------------------------------- |
| `--name <名称>` | 迁移名称                                             |
| `--create-only` | 只生成文件、不执行，用于手动修改 SQL                 |
| `--reset`       | 先清空数据库，再重新应用全部迁移                     |
| `--force`       | 跳过所有确认，接受数据丢失                           |

::: danger 只用于开发库
`migrate` 可能清空数据库。生产环境请使用 `deploy`。
:::

### 需要确认的变更

| 类型     | 示例                                                         | 处理                                     |
| -------- | ------------------------------------------------------------ | ---------------------------------------- |
| 数据丢失 | 删除非空表或有值的列、修改有值列的类型、在有数据的表上新增唯一约束 | 终端中确认；非交互环境需要 `--force` |
| 无法执行 | 在非空表中新增无默认值的必填列、把含 `NULL` 的列改为必填     | 报 `UNEXECUTABLE_MIGRATION`              |

无法执行的变更，以及重命名列、回填数据等无法自动推断的变更，都通过手动修改 SQL 完成：

```bash
tsorm migrate --name rename_column --create-only
# 编辑 migrations/<时间戳>_rename_column.sql
tsorm migrate
```

重命名字段会生成删除旧列、新增新列的 SQL；需要保留数据时，按上面的步骤改成重命名语句。

## deploy

```bash
tsorm deploy --check   # 只检查，不执行
tsorm deploy           # 应用待执行的迁移
```

`deploy` 按时间戳顺序应用待执行的迁移，无需确认，适合在发布流程中运行。

- 数据库不存在时自动创建。
- 数据库已有表但没有迁移历史时，报 `DATABASE_NOT_EMPTY`，需要先[建立基线](#接入已有数据库)。
- 存在失败的迁移时，报 `FAILED_MIGRATIONS`，需要先用 `resolve` 处理。
- 已应用的迁移文件被修改时，只输出警告。

`--check` 不做任何修改。数据库已是最新时返回 0，否则返回 1：数据库不存在、有待执行或失败的迁移、数据库中的迁移在本地缺失。适合作为 CI 中的部署前检查。

## resolve

迁移失败后，后续部署会被阻止。`resolve` 只修改迁移记录，不执行 SQL：

| 情况                       | 命令                                     |
| -------------------------- | ---------------------------------------- |
| 迁移没有生效，修正 SQL 后重试 | `tsorm resolve --rolled-back <名称>`，再 `deploy` |
| 剩余步骤已手动补完         | `tsorm resolve --applied <名称>`         |

| 数据库     | 迁移失败时                                                        |
| ---------- | ----------------------------------------------------------------- |
| SQLite     | 整个迁移在事务内执行，提交前检查外键，失败时全部回滚               |
| PostgreSQL | 整个脚本作为一次多语句查询执行，失败时全部回滚                     |
| MySQL      | DDL 无法回滚，失败前已执行的语句会保留，需要手动检查后再 `resolve` |

## diff

`diff` 不修改数据库，默认输出“迁移历史 → 模型”的 SQL，也就是下一次 `migrate` 会生成的内容：

```bash
tsorm diff                          # 迁移历史 → 模型
tsorm diff --from database          # 数据库 → 模型
tsorm diff --from empty > init.sql  # 完整建表 SQL
tsorm diff --check                  # 只输出摘要，有差异时返回 2
```

| 参数      | 可选值                              | 默认值       |
| --------- | ----------------------------------- | ------------ |
| `--from`  | `migrations`、`database`、`empty`   | `migrations` |
| `--to`    | `schema`、`database`                | `schema`     |
| `--check` | 无                                  | 关闭         |

`tsorm diff --check` 可以在 CI 中检查是否忘了生成迁移。

## push

`push` 不生成迁移文件，直接让数据库与模型一致，适合原型开发：

```bash
tsorm push
```

| 参数      | 说明                                 |
| --------- | ------------------------------------ |
| `--force` | 接受数据丢失                         |
| `--reset` | 先清空数据库，用于处理无法执行的变更 |

项目需要上线时，改用 `migrate` 和 `deploy`。

## 漂移与重置

漂移指开发库与迁移历史不一致，例如手动建了表。`migrate` 会列出差异，并请求确认后重置：

```text
Drift detected: Your database schema is not in sync with your migration history.

[+] Added tables
  - manual
```

主动重置用 `tsorm migrate --reset`：删除全部表和数据，重新应用所有迁移，然后照常检查模型变更。

::: danger AI 代理保护
CLI 检测到由 AI 编程代理（Claude Code、Gemini CLI、Qwen Code、Cursor、Aider、Replit）运行 `migrate --reset`、`push --reset` 或 `push --force` 时会拒绝执行。代理必须先征得用户明确同意，再把同意的原文写入 `TSORM_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` 后重试。
:::

## 接入已有数据库

已有数据库首次接入迁移时，先建立基线：

```bash
mkdir -p migrations
tsorm diff --from empty > migrations/00000000000000_init.sql
tsorm resolve --applied 00000000000000_init
tsorm deploy
```

`resolve --applied` 只记录、不执行。请先确认模型与现有结构一致：`tsorm diff --from database --check` 应该返回 0。

## 迁移文件

```text
schema.orm
migrations/
├── 20261103020000_init.sql
├── 20261103030000_update.sql
└── migration_lock.toml
```

- 文件名为 `<时间戳>_<名称>.sql`，时间戳是生成时的 UTC 时间，格式 `YYYYMMDDHHMMSS`（14 位），按从小到大执行。名称中字母、数字和下划线以外的字符会替换为 `_`。
- 迁移的名称就是去掉 `.sql` 的文件名，`resolve` 使用这个名称。
- 尚未应用的迁移文件可以手动编辑。
- 迁移目录中不符合命名规则的 `.sql` 文件会报 `INVALID_MIGRATION_FILE`。

时间戳出现以下问题时，工具不会自动调整，而是报 `MIGRATION_TIMESTAMP_CONFLICT`，需要手动处理：

| 情况 | 原因 | 处理 |
| --- | --- | --- |
| 两个文件的时间戳相同 | 多人在同一秒生成，或手动命名重复 | 修改其中一个文件的时间戳 |
| 新迁移的时间戳不大于最新的已有文件 | 同一秒内连续生成、系统时钟偏差、手动写了未来的时间戳 | 稍后重试，或检查时钟和文件名 |
- `migration_lock.toml` 记录数据库类型，换成其他类型的数据库时报 `PROVIDER_MISMATCH`。
- 整个目录都应提交到版本管理。

迁移记录保存在数据库的 `_tsorm_migrations` 表中：

| 列                    | 说明                                         |
| --------------------- | -------------------------------------------- |
| `migration_name`      | 迁移名称，即不含 `.sql` 的文件名             |
| `checksum`            | 迁移文件的 SHA-256，用于发现被修改的迁移     |
| `started_at`、`finished_at` | 开始和完成时间，失败时 `finished_at` 为 `NULL` |
| `rolled_back_at`      | 被 `resolve --rolled-back` 标记的时间        |
| `logs`                | 失败时的错误信息                             |

## 影子库

`migrate` 和 `diff` 需要一个临时数据库来重放迁移、计算目标结构，在 MySQL 和 PostgreSQL 上 `push` 也需要。

| 数据库     | 默认行为                                              | 权限要求              |
| ---------- | ----------------------------------------------------- | --------------------- |
| SQLite     | 使用内存数据库                                        | 无                    |
| PostgreSQL | 在同一服务器上创建 `tsorm_shadow_db_<随机值>`，用完删除 | `CREATEDB` 或超级用户 |
| MySQL      | 同上                                                  | 建库和删库权限        |

没有建库权限时，设置 `SHADOW_DATABASE_URL` 指向一个专用的空库。每次使用前都会清空它，不要指向有用的数据。

## 设计说明

- **目标结构**：把模型的 DDL 实际执行到影子库再读取结构，比较结果由数据库自己规范化，稳定可靠。代价是 MySQL 和 PostgreSQL 上需要建库权限或 `SHADOW_DATABASE_URL`。
- **SQLite 事务**：每个迁移在事务内执行，迁移脚本中不能自行使用 `BEGIN` 和 `COMMIT`。重建表时保留 `AUTOINCREMENT` 的历史高水位。

## 程序 API

```ts
import { deploy, status } from '@ofis/tsorm/migrations';

const options = { url: process.env.DATABASE_URL };
if ((await status(options)).pending.length) await deploy({ ...options, log: console.log });
```

每个命令都有对应的函数，完整的对照表、选项以及与 CLI 的区别见[在代码中调用](../reference/cli.md#在代码中调用)。
