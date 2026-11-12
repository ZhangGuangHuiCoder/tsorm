---
description: 用 migrate、deploy、resolve、diff 和 push 管理数据库结构。
---

# 版本化迁移

迁移工具支持 SQLite、MySQL / MariaDB 和 PostgreSQL。迁移是普通的 SQL 文件，开发时自动检测数据库是否被手动改动，失败的迁移会阻止后续部署。

本页说明开发、部署、失败恢复和基线工作流；逐项参数集中见 [CLI 选项](../reference/cli/options.md)。

## 快速开始

不需要任何配置，默认使用当前目录的 `schema.orm` 和 SQLite 数据库 `dev.db`：

```bash
tsorm migrate          # 开发：生成并应用迁移
tsorm deploy           # 上线：应用待执行的迁移
```

## 默认值

CLI 默认使用 `schema.orm`、`file:./dev.db` 和模型文件旁的 `migrations/`。通过 `DATABASE_URL` 选择数据库，通过 `--schema` 选择模型文件。默认值与连接环境变量集中见[选项与行为](../reference/cli/options.md)。

## migrate

修改 `schema.orm` 后运行：

```bash
tsorm migrate
```

它会依次完成：

1. 数据库不存在时创建它。
2. 检查开发库是否被手动改动（[漂移](#漂移与重置)），或存在失败、被修改的迁移。有问题时请求确认后重置开发库。
3. 应用待执行迁移。
4. 对比迁移历史与模型，生成 `migrations/<时间戳>_<名称>.sql` 并应用。

模型没有变化时，`migrate` 输出 `Already in sync`，不生成文件；`--create-only` 例外，可以生成空迁移。

`--create-only` 跳过本次新生成迁移的应用、不可执行变更检查和风险确认，**不跳过**此前的漂移/重置处理和已有待执行迁移的应用。只需生成 SQL 且不改动目标库时使用 `diff`。

::: danger 只用于开发库
`migrate` 可能清空数据库。生产环境请使用 `deploy`。
:::

### 需要确认的变更

| 类型     | 示例                                                               | 处理                                 |
| -------- | ------------------------------------------------------------------ | ------------------------------------ |
| 数据丢失 | 删除非空表或有值的列、修改有值列的类型、在有数据的表上新增唯一约束 | 终端中确认；非交互环境需要 `--force` |
| 无法执行 | 在非空表中新增无默认值的必填列、把含 `NULL` 的列改为必填           | 报 `UNEXECUTABLE_MIGRATION`          |

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

`--check` 执行只读检查。数据库已是最新时返回 0，否则返回 1：数据库不存在、有待执行或失败的迁移、数据库中的迁移在本地缺失。适合作为 CI 中的部署前检查。

## resolve

失败的迁移会阻止后续部署。先检查数据库并修复实际状态，再用 `resolve` 更新历史记录；它不会执行迁移文件中的 SQL。

| 实际状态                         | 后续操作                                                     |
| -------------------------------- | ------------------------------------------------------------ |
| 失败已回滚，或部分变更已手动撤销 | `tsorm resolve --rolled-back <名称>`，修正 SQL 后再 `deploy` |
| 迁移的全部变更已手动补完         | `tsorm resolve --applied <名称>`                             |
| 已有结构与初始迁移一致           | 使用 `--applied` 登记[基线](#接入已有数据库)                 |

`--rolled-back` 不撤销 DDL，`--applied` 也不验证结构是否与 SQL 一致。

| 数据库          | 失败边界                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| SQLite          | 执行器将每个迁移包在事务内，提交前检查外键；脚本应把事务控制交给执行器。 |
| PostgreSQL      | 整个脚本作为一次多语句查询发送；脚本未自行引入事务边界时使用隐式事务。   |
| MySQL / MariaDB | DDL 隐式提交，失败前的变更可能保留，需检查后手动补完或撤销。             |

工具不会还原数据库快照。部署前应备份并审查手写 SQL。

## diff

`diff` 不修改目标业务库，但通常会使用[影子库](#影子库)，默认输出“迁移历史 → 模型”的 SQL，也就是下一次 `migrate` 会生成的内容：

```bash
tsorm diff                          # 迁移历史 → 模型
tsorm diff --from database          # 数据库 → 模型
tsorm diff --from empty > init.sql  # 完整建表 SQL
tsorm diff --check                  # 只输出摘要，有差异时返回 2
```

`--from empty --to schema` 离线生成 DDL，不连接数据库，也不使用影子库。其他来源组合可能创建、清空并写入影子库。来源选项见 [CLI 选项](../reference/cli/options.md)。

`tsorm diff --check` 可以在 CI 中检查是否忘了生成迁移。

## push

`push` 不生成迁移文件，直接让数据库与模型一致，适合原型开发：

```bash
tsorm push
```

`--force` 接受数据丢失风险，`--reset` 在同步前清空数据。需要保留业务数据时，先建立基线，再使用 `migrate` / `deploy`。

## 漂移与重置

漂移指开发库与迁移历史不一致，例如手动建了表。`migrate` 会列出差异，并请求确认后重置：

```text
Drift detected: Your database schema is not in sync with your migration history.

[+] Added tables
  - manual
```

主动重置用 `tsorm migrate --reset`：删除全部表和数据，重新应用所有迁移，然后照常检查模型变更。

## 忽略的表

模型文件中用 `ignore` 声明忽略的表（见[忽略表](../schema/overview.md#忽略表)）后：

- `migrate` 的漂移检测、`diff` 和 `push` 都看不到这些表，不会生成删除它们的语句。
- `migrate --reset` 和 `push --reset` 只删除模型管理的表和视图，被忽略的表及其数据保持原样。PostgreSQL 下不再删除整个 schema，而是逐表 `DROP ... CASCADE`。
- `deploy` 判断数据库是否为空时不计被忽略的表；模型文件不存在时按未声明 `ignore` 处理。

被忽略的表若有外键引用模型管理的表，重置时 PostgreSQL 会随 `CASCADE` 删除这些外键，MySQL 和 SQLite 会留下悬空引用。

## 接入已有数据库

先执行 `tsorm diff --from database --check`，确认退出码为 0；存在差异时先处理，再为已有数据库登记基线：

```bash
mkdir -p migrations
tsorm diff --from empty > migrations/00000000000000_init.sql
tsorm resolve --applied 00000000000000_init
tsorm deploy
```

`resolve --applied` 登记本地迁移而不执行其 SQL。登记前审查基线文件，检查与登记必须使用同一数据库配置。

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
- 待应用迁移文件可以手动编辑。
- 迁移目录中不符合命名规则的 `.sql` 文件会报 `INVALID_MIGRATION_FILE`。

时间戳出现以下问题时，工具报 `MIGRATION_TIMESTAMP_CONFLICT`，需要手动处理：

| 情况                               | 原因                                                 | 处理                         |
| ---------------------------------- | ---------------------------------------------------- | ---------------------------- |
| 两个文件的时间戳相同               | 多人在同一秒生成，或手动命名重复                     | 修改其中一个文件的时间戳     |
| 新迁移的时间戳不大于最新的已有文件 | 同一秒内连续生成、系统时钟偏差、手动写了未来的时间戳 | 稍后重试，或检查时钟和文件名 |

- `migration_lock.toml` 记录数据库类型，换成其他类型的数据库时报 `PROVIDER_MISMATCH`。
- 整个目录都应提交到版本管理。

迁移记录保存在数据库的 `_tsorm_migrations` 表中（声明了[表前缀](../schema/overview.md#表前缀)时为 `<前缀>_tsorm_migrations`）：

| 列                          | 说明                                           |
| --------------------------- | ---------------------------------------------- |
| `migration_name`            | 迁移名称，即不含 `.sql` 的文件名               |
| `checksum`                  | 迁移文件的 SHA-256，用于发现被修改的迁移       |
| `started_at`、`finished_at` | 开始和完成时间，失败时 `finished_at` 为 `NULL` |
| `rolled_back_at`            | 被 `resolve --rolled-back` 标记的时间          |
| `logs`                      | 失败时的错误信息                               |

## 影子库

影子库会在每次使用时清空，必须使用专用数据库。MySQL / MariaDB 要求影子库名称与目标库不同；PostgreSQL 要求数据库名称或 schema 不同。同名命名空间即使使用不同主机地址也会被保守拒绝，以防止主机别名绕过保护。凭据、默认端口及 URL 协议别名不构成隔离。

`migrate` 和大多数 `diff` 来源组合需要一个临时数据库来重放迁移、计算目标结构，在 MySQL 和 PostgreSQL 上 `push` 也需要。

| 数据库     | 默认行为                                                | 权限要求              |
| ---------- | ------------------------------------------------------- | --------------------- |
| SQLite     | 使用内存数据库                                          | 无                    |
| PostgreSQL | 在同一服务器上创建 `tsorm_shadow_db_<随机值>`，用完删除 | `CREATEDB` 或超级用户 |
| MySQL      | 同上                                                    | 建库和删库权限        |

没有建库权限时，设置 `SHADOW_DATABASE_URL` 指向一个专用的空库。每次使用前都会清空它，不要指向有用的数据。

## 设计说明

- **目标结构**：在影子库中执行模型 DDL 后读取结构，以数据库规范化结果作为比较依据。MySQL 和 PostgreSQL 需要建库权限，或配置专用 `SHADOW_DATABASE_URL`。
- **SQLite 事务**：每个迁移在事务内执行，事务边界由迁移执行器管理。重建表时保留 `AUTOINCREMENT` 的历史高水位。

## 程序 API

函数对照、公共选项和部署检查示例集中见[在代码中调用](../reference/cli/programmatic.md)。

## 下一步

- [CLI](../reference/cli/overview.md#命令)：全部迁移命令及其参数
- [命令示例](../reference/cli/commands.md)：各命令的常用调用方式
- [能力对比](./overview.md)：影响迁移的数据库差异
