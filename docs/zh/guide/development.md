---
description: 开发环境、构建与回归命令、数据库选择和文档规范。
---

# 开发与验证

要求 Node.js 22.15+。脚本、测试、示例与扩展打包使用 Bun；服务端数据库测试需要专用数据库服务。

## 测试范围

| 范围           | 验证内容                                 |
| -------------- | ---------------------------------------- |
| 模型与类型     | 解析、约束、客户端生成、类型推断         |
| 查询与写入     | SQL 编译、过滤、投影、关联加载、嵌套写入 |
| 事务与生命周期 | 提交、回滚、超时、资源释放、客户端关闭   |
| 适配器         | 连接 URL、标量转换、主键回读、错误映射   |
| 迁移           | 结构反射、差异、历史、风险检查、失败清理 |
| 工具           | CLI 与编辑器语言功能                     |

## 安装与构建

```bash
bun install
bun run build
```

`build` 编译 ORM，重新生成示例与测试客户端，检查全仓与扩展类型，构建文档并打包 VS Code 扩展。生成的客户端均为 git 忽略的产物；不带数据库参数的 `bun run example` 只刷新示例客户端。针对性检查：

```bash
bunx --no-install tsc -p tsconfig.types.json
bunx --no-install vitepress build docs
```

## 基准与 API 表面校验

两个微基准统一按 `ns/op = (ms × 1e6) / 样本数` 输出（1 位小数）。第一个参数指定轮数；跨机器比较时跑多次取中位数。

```bash
bun test/bench/bench.ts            # 解码热路径，默认 40 轮
bun test/bench/bench.ts 5          # 跑 5 轮
bun test/bench/bench-datetime.ts   # 100 万个 datetime 值，默认 1 轮
bun test/bench/bench-datetime.ts 3 # 跑 3 轮
```

`bench.ts` 还包含 `bigintsAsText`（含/不含 bigint）与 `encodeJson` 的 JSON 校验微基准。参考阈值：SQLite 整行解码 < 500 ns/行、`bigintsAsText` < 80 ns/行、ISO `storedInstant` < 45 ns/值——是测量目标而非断言，未达标时记录真实数字并说明原因。

[客户端 API](../reference/client-api.md) 的入口符号表由测试与实际导出对拍（`@internal` helper 除外）。修改任何 `export` 后运行：

```bash
TEST_DATABASES=sqlite bun test test/unit/runtime.test.ts
```

## 发布

```bash
bun run release          # 直接发 package.json 当前版本
bun run release minor    # patch | minor | major：递增、提交后再打标签
```

要求工作区干净；传了版本级别时先以 `chore: release v<version>` 提交，再打标签并推送 `main` 与标签。标签触发 CI 构建、测试、发布、GitHub Release 与文档部署，工作流使用单一 Bun 版本。

## 回归流程

```bash
# 启动 compose 服务，等待健康检查通过后运行测试。
bun run test

# 透传测试路径与 Bun test 参数。
bun run test test/unit/schema.test.ts --timeout 10000

# 不依赖外部数据库服务。
TEST_DATABASES=sqlite bun test

# 要求列出的服务均可用；指定目标不可达时失败。
TEST_DATABASES=sqlite,mysql,mariadb,postgres bun test

# 执行指定的 SQLite 回归用例。
TEST_DATABASES=sqlite bun test ./test/integration/sqlite-regressions.test.ts
```

`bun test` 发现 `test/` 与 `extensions/test/` 下的测试；`bun run test` 额外启动 `examples/compose.yaml`，需要 Docker。未设置 `TEST_DATABASES` 时包含 SQLite 并探测已配置的服务端数据库，显式列表只选择列出的目标；仅运行 SQLite 不能验证服务端特有行为。

| 数据库     | 连接环境变量                                               | 默认测试端口 |
| ---------- | ---------------------------------------------------------- | ------------ |
| PostgreSQL | `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD`、`PGDATABASE`   | 5433         |
| MySQL      | `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD` | 3307         |
| MariaDB    | 复用 MySQL 变量，端口使用 `MARIADB_PORT`                   | 3308         |

集成测试会创建并清理隔离的数据库或 schema；请使用具备相应权限的专用开发服务和账号。

## 文档维护规范

1. 先说明契约与前置条件，再给示例；区分支持行为、数据库差异和限制；声明、运行时行为和命令参数集中在所属章节，用链接引用。
2. 中英文路径与行为保持一致；用 `bunx --no-install vitepress build docs` 验证（导航变更还需类型检查），汇报时说明验证命令、数据库范围与未验证部分。

## 下一步

- [文档导航](./documentation.md)：各主题的位置
- [完整示例](./examples.md)：示例模型与执行方式
