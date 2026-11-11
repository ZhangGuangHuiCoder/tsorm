# 测试分类

测试用三个正交维度描述：

| 维度 | 取值                                                                                                                                                                      | 作用                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 层级 | `unit` / `integration` / `system` / `types`                                                                                                                               | 表示用例需要跨越哪条资源边界，决定运行方式 |
| 领域 | `schema`、`datetime`、`scalars`、`runtime`、`connection`、`client`、`query`、`write`、`transaction`、`migration`、`json-raw`、`morph`、`soft-delete`、`cli`、`regression` | 表示被验证的模块职责，决定目录             |
| 意图 | 契约、边界、错误、回归、不变量、类型                                                                                                                                      | 表示用例想证明什么，不单独建目录           |

目录只编码**层级 + 领域**；意图记录在本文的文件清单中，并通过用例名和文件头注释体现。

## 判定顺序

按资源边界从外到内判定，取用例实际触及的最高层级：

1. 通过进程边界调用 CLI → `system`。
2. 打开真实数据库连接（包括 SQLite 内存库或临时文件）→ `integration`。
3. 只做编译期类型检查，不产生运行时断言 → `types`。
4. 其余 → `unit`。

因此 `unit` 不打开数据库、不启动子进程；它可以使用 fixture、TypeScript 编译器和被替换的驱动模块。
SQLite 是真实存储引擎，所以只跑 SQLite 的用例仍属于 `integration`，不能因为“不需要外部服务”放进 `unit`。

领域按被测职责划分。跨多个模块、无法归入单一领域的回归套件放进 `regression`；只涉及单一领域的回归用例
放进该领域目录，并在意图列标为“回归”。

## 目录

```text
test/
  unit/
    datetime-boundaries.test.ts # 日期时间纯函数
    decimal-boundaries.test.ts  # 十进制与 bigint 编解码
    runtime.test.ts             # SQL 片段、标识符、提供者选择
    migration-lifecycle.test.ts # 迁移提供者生命周期（桩驱动）
    schema.test.ts # 模型解析、客户端生成、DDL 与 datetime 边界
    types.test.ts  # 编译期类型、悬停文本与错误信息
  integration/
    connection.test.ts         # URL 解析、适配器前置校验（SQLite）
    client.test.ts             # 客户端能力、事件、生命周期
    datetime-boundaries.test.ts # 日期时间往返与边界
    datetime-format.test.ts    # 日期时间格式化输出
    decimal-boundaries.test.ts # 十进制聚合与边界
    query-basics.test.ts       # 查询：投影、游标
    filters.test.ts            # 查询：过滤
    aggregations.test.ts       # 查询：聚合
    batching.test.ts           # 查询：语句分批
    crud.test.ts               # 写入：CRUD
    relation-writes.test.ts    # 写入：关系写入
    write-guards.test.ts       # 写入：全表护栏
    nested-writes.test.ts      # 写入：嵌套写入
    transactions.test.ts       # 事务语义
    migrations.test.ts         # 版本化迁移与同步
    json.test.ts               # 类型化 JSON
    raw-sql.test.ts            # 原生 SQL
    morph.test.ts              # 多态关系
    soft-delete.test.ts        # 软删除语义
    sqlite-regressions.test.ts # 回归（仅 SQLite）
    cross-database-regressions.test.ts # 回归（全数据库矩阵）
  system/
    cli.test.ts                # CLI 命令与退出码
    review-regressions.test.ts # 含进程边界的审查回归
  types/           # 编译期类型夹具（不是测试文件）
  helpers/         # 数据库目标探测、沙箱、客户端上下文
  fixtures/        # 共享模型与生成的测试客户端
```

## 运行层级

| 层级 | 命令                          | 说明                                                        |
| ---- | ----------------------------- | ----------------------------------------------------------- |
| 单元 | `bun test ./test/unit`        | 无数据库连接、无子进程                                      |
| 集成 | `bun test ./test/integration` | 至少一个真实数据库；`eachDatabase` 目标见下文               |
| 系统 | `bun test ./test/system`      | 子进程直接调用 CLI 源码，不依赖构建产物                     |
| 类型 | `tsc -p tsconfig.types.json`  | `test/types` 中的编译期夹具，另由 `unit/types` 检查显示文本 |

`bun test` 运行 `unit`、`integration`、`system` 三层。VS Code 扩展的语言逻辑测试独立放在 `extensions/test`（`bun test` 也会一并发现并运行），只测补全、悬停与格式化，不属于 ORM 库本身。

`bun run test` 会先启动 Docker 数据库并等待健康检查，再执行 `bun test`，额外参数原样透传。测试直接使用源码，无需运行 `bun run build`。

### 数据库范围

- 标为“全矩阵”的集成用例通过 `eachDatabase` 运行：SQLite 总会执行；PostgreSQL / MySQL / MariaDB
  在可连通时自动加入。
- 用 `TEST_DATABASES=sqlite,postgres` 显式指定；列出的数据库不可连接会直接失败，不会静默跳过。
- 标为“SQLite”的用例只验证嵌入式存储或适配器前置行为，是集成层中有意收窄的覆盖范围。
- 每个目标数据库使用独立沙箱（SQLite 临时文件、PostgreSQL schema、MySQL 数据库），用例结束即销毁。

## 文件清单

| 文件                                             | 层级        | 领域           | 数据库范围 | 意图             |
| ------------------------------------------------ | ----------- | -------------- | ---------- | ---------------- |
| `unit/schema.test.ts`                            | unit        | 模型与类型系统 | —          | 契约、边界、错误 |
| `unit/datetime-boundaries.test.ts`               | unit        | 日期时间       | —          | 边界、错误       |
| `unit/decimal-boundaries.test.ts`                | unit        | 十进制与标量   | —          | 边界、错误       |
| `unit/runtime.test.ts`                           | unit        | 运行时基础     | —          | 契约、错误       |
| `unit/migration-lifecycle.test.ts`               | unit        | 迁移           | —          | 契约、错误       |
| `unit/types.test.ts`                             | unit        | 类型           | —          | 类型             |
| `integration/connection.test.ts`                 | integration | 连接           | SQLite     | 契约、错误       |
| `integration/datetime-boundaries.test.ts`        | integration | 日期时间       | 全矩阵     | 边界、错误       |
| `integration/datetime-format.test.ts`            | integration | 日期时间       | SQLite     | 契约             |
| `integration/decimal-boundaries.test.ts`         | integration | 十进制与标量   | 全矩阵     | 边界             |
| `integration/client.test.ts`                     | integration | 客户端         | 全矩阵     | 契约、边界       |
| `integration/query-basics.test.ts`               | integration | 查询           | 全矩阵     | 契约             |
| `integration/filters.test.ts`                    | integration | 查询           | 全矩阵     | 契约、边界       |
| `integration/aggregations.test.ts`               | integration | 查询           | 全矩阵     | 契约             |
| `integration/batching.test.ts`                   | integration | 查询           | 全矩阵     | 不变量           |
| `integration/crud.test.ts`                       | integration | 写入           | 全矩阵     | 契约、错误       |
| `integration/relation-writes.test.ts`            | integration | 写入           | 全矩阵     | 契约、错误       |
| `integration/write-guards.test.ts`               | integration | 写入           | 全矩阵     | 契约、错误       |
| `integration/nested-writes.test.ts`              | integration | 写入           | 全矩阵     | 契约、错误       |
| `integration/transactions.test.ts`               | integration | 事务           | 全矩阵     | 契约、错误       |
| `integration/migrations.test.ts`                 | integration | 迁移           | 全矩阵     | 契约、错误       |
| `integration/json.test.ts`                       | integration | 类型化 JSON    | 全矩阵     | 契约、错误       |
| `integration/raw-sql.test.ts`                    | integration | 原生 SQL       | 全矩阵     | 契约、错误       |
| `integration/morph.test.ts`                      | integration | 多态关系       | 全矩阵     | 契约、错误       |
| `integration/soft-delete.test.ts`                | integration | 软删除         | 全矩阵     | 契约、错误       |
| `integration/sqlite-regressions.test.ts`         | integration | 回归           | SQLite     | 回归             |
| `integration/cross-database-regressions.test.ts` | integration | 回归           | 全矩阵     | 回归             |
| `system/cli.test.ts`                             | system      | CLI            | —          | 契约、错误       |
| `system/review-regressions.test.ts`              | system      | 回归           | SQLite     | 回归             |

## 意图

| 意图   | 含义                                       | 例子                                                |
| ------ | ------------------------------------------ | --------------------------------------------------- |
| 契约   | 固定公开 API 的正常行为                    | 创建返回实际写入的行、游标分页、事务提交            |
| 边界   | 最小值、最大值、空集、NULL、溢出、精度上限 | `0001`/`9999` 年、`decimal` 标度、`bigint` 安全范围 |
| 错误   | 非法输入必须被拒绝，并带稳定的错误码       | 错误的时区偏移、非法的日历值、不可连接的数据库      |
| 回归   | 固定已确认的缺陷，防止复发                 | 嵌套事务错误被吞掉、迁移校验和兼容换行              |
| 不变量 | 与输入规模相关的结构性保证                 | 关系加载不出现 N+1、语句数按批预算增长              |
| 类型   | 编译期类型或编辑器显示文本                 | 更新类型拒绝只读字段、悬停文本不含内部辅助类型      |

边界与错误用例优先补进已有的 `*-boundaries.test.ts` 或对应领域的文件，避免一个场景一个文件。

## 边界覆盖清单

| 边界                                                               | 位置                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 时区 `-14:00`/`+14:00`、分钟上限、格式错误                         | `unit/datetime-boundaries.test.ts`                                          |
| 年份 `0001`/`9999`、`0000`、闰年 `2000`/`2100`、月/日/时/分/秒上限 | `unit/datetime-boundaries.test.ts`                                          |
| 小数秒 1/2/3 位补齐与 4 位拒绝                                     | `unit/datetime-boundaries.test.ts`                                          |
| `Date`、毫秒时间戳、纪元前、不安全整数、超出 `Date` 范围           | `unit/datetime-boundaries.test.ts`                                          |
| UTC 输出在 `0001`/`9999` 附近溢出                                  | `unit/datetime-boundaries.test.ts`                                          |
| UTC 模式 `Z`、大小写、偏移量、非法日历日                           | `unit/datetime-boundaries.test.ts`                                          |
| `datetime` / `timestamp` 映射、`date` 与 `Date` 拼写错误           | `unit/schema.test.ts`                                                       |
| `now()`、`@updatedAt`、`@@softDelete` 的适用类型与禁止组合         | `unit/schema.test.ts`                                                       |
| 外键列隐式继承 `dateStorage` 与显式不匹配                          | `unit/schema.test.ts`                                                       |
| 三种方言的 `datetime`/`timestamp` 列类型与 `now()` 默认值          | `unit/schema.test.ts`                                                       |
| 生成客户端的 `DateTime`/`DateTimeInput` 与 `dateFields`            | `unit/schema.test.ts`                                                       |
| 数据库端的 `0001`/`9999`、闰日、非法日期、MySQL 年份 1000–9999     | `integration/datetime-boundaries.test.ts`                                   |
| timestamp 纪元、纪元前、最小/最大可表示时间、非法数字输入          | `integration/datetime-boundaries.test.ts`                                   |
| 可空 `datetime`/`timestamp` 的省略、显式 NULL 与必填 NULL          | `integration/datetime-boundaries.test.ts`                                   |
| 十进制整数和补零、负零、scale 0/2/3、全 NULL、空集                 | `unit/decimal-boundaries.test.ts`、`integration/decimal-boundaries.test.ts` |
| 十进制精度上限、超长小数、数字输入、`decimal(10,0)`                | `unit/decimal-boundaries.test.ts`                                           |
| 十进制分组合计、最小值/最大值的标度、bigint 求和越界               | `integration/decimal-boundaries.test.ts`                                    |

## 约定

- 新增用例先按“判定顺序”确定层级，再按被测职责选择领域；不要按文件原先所在目录继承层级。
- 集成用例必须通过 `eachDatabase` 或显式 `sandbox` 覆盖声明范围内的全部目标数据库；数据库差异用
  `ctx.target` 分支表达，并在注释里说明原因（例如 MySQL 的年份范围）。
- 断言数据库返回的十进制字符串时，区分**列值**（驱动通常已按声明标度返回）与**聚合值**
  （整数和需要在解码时补零）。
- 回归用例只固定已确认的缺陷，不把未定义的实现细节写成规范。
- 只有确实需要独立生命周期或独立目标数据库的场景才新建文件。
