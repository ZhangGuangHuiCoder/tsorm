---
description: OrmError、MigrationError 和 SchemaError 的错误码及含义。
---

# 错误码

ORM 抛出三种错误类型，前两种通过错误码区分原因。

| 错误类型         | 来源                     | 判断方式                 |
| ---------------- | ------------------------ | ------------------------ |
| `OrmError`       | 客户端和适配器           | `error.code`             |
| `MigrationError` | 迁移工具                 | `error.code`             |
| `SchemaError`    | 模型解析                 | `error.line`、`error.column` |

数据库错误的 `cause` 中保留了原始驱动错误，可能包含敏感的输入值。

## 客户端错误

### 输入与查询

| 错误码                   | 说明                                                 |
| ------------------------ | ---------------------------------------------------- |
| `VALIDATION`             | 输入不符合模型或 API 规则                            |
| `NOT_FOUND`              | `OrThrow` 查询、`update`、`delete` 或关系目标找不到记录 |
| `NUMERIC_OVERFLOW`       | 整数超出 JavaScript 安全范围                         |
| `INVALID_DATABASE_VALUE` | 数据库中的值不符合模型声明，例如 JSON 结构不匹配     |
| `UNSUPPORTED_CAPABILITY` | 当前数据库不支持请求的能力                           |

### 约束

| 错误码                   | 说明         |
| ------------------------ | ------------ |
| `UNIQUE_CONSTRAINT`      | 违反唯一约束 |
| `FOREIGN_KEY_CONSTRAINT` | 违反外键约束 |
| `NOT_NULL_CONSTRAINT`    | 违反非空约束 |
| `CHECK_CONSTRAINT`       | 违反检查约束 |

### 关系与软删除

| 错误码                   | 说明                                     |
| ------------------------ | ---------------------------------------- |
| `RELATION_NOT_CONNECTED` | 嵌套操作的目标不属于当前关系             |
| `RELATION_INTEGRITY`     | 单条关系的加载结果不符合基数约束         |
| `SOFT_DELETED_REFERENCE` | 外键或 `connect` 指向已软删除的记录      |
| `SOFT_DELETED_RELATION`  | 必需关系的目标已被软删除，导致预加载缺失 |

### 事务

| 错误码                  | 说明                                                       |
| ----------------------- | ---------------------------------------------------------- |
| `TRANSACTION_ABORTED`   | 事务中已有操作失败，只能回滚                               |
| `TRANSACTION_CLOSED`    | 事务已结束，不能继续使用                                   |
| `TRANSACTION_TIMEOUT`   | 超过 `timeout`                                             |
| `TRANSACTION_MAX_WAIT`  | 超过 `maxWait` 仍未获取到连接                              |
| `TRANSACTION_OPTIONS`   | 嵌套事务试图设置 `maxWait` 或 `timeout`                    |
| `TRANSACTION_SCOPE`     | 操作不能在事务内执行，例如 `$close()`                      |
| `TRANSACTION_ISOLATION` | 隔离级别不足以支持 `findManyAndCount`，或嵌套事务试图改变隔离级别 |
| `TRANSACTION_DEADLOCK`  | 发生死锁，仅 MySQL 和 PostgreSQL                           |
| `LOCK_TIMEOUT`          | 锁等待超时或不可用，仅 MySQL 和 PostgreSQL                 |
| `SERIALIZATION_FAILURE` | 序列化失败，仅 PostgreSQL                                  |
| `QUERY_CANCELLED`       | 语句被服务端取消，例如事务超时后终止正在执行的语句         |

### 连接与初始化

| 错误码               | 说明                                               |
| -------------------- | -------------------------------------------------- |
| `CLIENT_CLOSED`      | 客户端已关闭，或 SQLite 连接已不可用               |
| `UNSUPPORTED_SERVER` | 服务器版本低于最低要求                             |
| `UNSUPPORTED_ENGINE` | MySQL 的受管理表未使用 InnoDB                      |
| `DATABASE_NOT_EMPTY` | `initialize` 的目标不为空                          |
| `SCHEMA_NOT_FOUND`   | PostgreSQL 的目标 schema 不存在                    |
| `DATABASE_ERROR`     | 其他未归类的数据库错误                             |

## 迁移错误

迁移命令抛出 `MigrationError`。CLI 输出 `Error: <错误码>` 后附说明，退出码为 1。

### 连接

| 错误码                          | 说明                                                 |
| ------------------------------- | ---------------------------------------------------- |
| `INVALID_URL`                   | 数据库 URL 格式不正确，或与影子库 URL 相同           |
| `SCHEMA_NOT_FOUND`              | 无法读取模型文件                                     |
| `UNSUPPORTED_SERVER`            | 服务器版本低于最低要求                               |
| `DATABASE_NOT_FOUND`            | `deploy --check`、`resolve` 或 `diff --from database` 的数据库不存在 |
| `DATABASE_UNREACHABLE`          | 无法连接数据库服务器                                 |
| `DATABASE_CREATE_FAILED`        | 创建数据库失败                                       |
| `SHADOW_DATABASE_CREATE_FAILED` | 无法自动创建影子库，需要建库权限或 `SHADOW_DATABASE_URL` |

### 迁移历史

| 错误码                      | 说明                                           |
| --------------------------- | ---------------------------------------------- |
| `PROVIDER_MISMATCH`         | `DATABASE_URL` 的数据库类型与 `migration_lock.toml` 不一致 |
| `INVALID_MIGRATION_FILE`    | 迁移目录中的 `.sql` 文件不符合 `<YYYYMMDDHHMMSS>_<名称>.sql` |
| `MIGRATION_TIMESTAMP_CONFLICT` | 两个迁移的时间戳相同，或新迁移的时间戳不大于最新的已有迁移 |
| `MIGRATION_NAME_TOO_LONG`   | 迁移文件名超过 200 字节                        |
| `MIGRATION_NOT_FOUND`       | `resolve --applied` 指定的迁移文件不存在       |
| `MIGRATION_ALREADY_APPLIED` | 迁移已经记录为已应用                           |
| `MIGRATION_NOT_APPLIED`     | 迁移从未应用，不能标记为回滚                   |
| `MIGRATION_NOT_FAILED`      | 迁移不处于失败状态，不能标记为回滚             |
| `MIGRATION_LOCKED`          | 等待其他迁移进程释放锁超时                     |

### 执行

| 错误码                    | 说明                                                   |
| ------------------------- | ------------------------------------------------------ |
| `DATABASE_NOT_EMPTY`      | 数据库已有表但没有迁移历史，需要先建立基线             |
| `FAILED_MIGRATIONS`       | 存在失败的迁移，新迁移不会被应用                       |
| `MIGRATION_FAILED`        | 迁移执行失败，详情写入历史表的 `logs`                  |
| `SHADOW_MIGRATION_FAILED` | 迁移无法在影子库中正常执行                             |
| `FOREIGN_KEY_CHECK`       | SQLite 脚本执行后存在外键违规，已回滚                  |
| `UNEXECUTABLE_MIGRATION`  | 变更在现有数据上无法执行                               |
| `DATA_LOSS`               | `push` 会丢失数据，需要 `--force`                      |
| `NON_INTERACTIVE`         | 需要确认，但当前环境不是交互终端；可加 `--force`       |
| `ABORTED`                 | 用户拒绝了确认                                         |
| `VALIDATION`              | 参数组合不合法，例如 `resolve` 同时传入两个选项        |
