---
description: 开发环境、构建与回归命令、数据库选择和文档维护规范。
---

# 开发与验证

包要求 Node.js 22.15+。仓库脚本、测试、示例执行与扩展打包使用 Bun；服务端数据库测试还需要专用数据库服务。

## 测试范围

测试通过 ORM 接口覆盖本项目维护的行为：

| 范围           | 验证内容                                 |
| -------------- | ---------------------------------------- |
| 模型与类型     | 解析、约束、客户端生成、类型推断         |
| 查询与写入     | SQL 编译、过滤、投影、关联加载、嵌套写入 |
| 事务与生命周期 | 提交、回滚、超时、资源释放、客户端关闭   |
| 适配器         | 连接 URL、标量转换、主键回读、错误映射   |
| 迁移           | 结构反射、差异、历史、风险检查、失败清理 |
| 工具           | CLI 与编辑器语言功能                     |

驱动是外部依赖。连接探测和隔离数据库清理属于测试设施；驱动替身用于注入故障，验证 ORM 自身的行为。

## 安装与构建

```bash
bun install
bun run build
```

`build` 编译 ORM，检查全仓与扩展的类型，构建文档并打包 VS Code 扩展。修改模型或客户端生成逻辑后，执行不带数据库参数的 `bun run example`，重新生成示例与测试客户端。

针对性检查可单独运行：

```bash
bunx --no-install tsc -p tsconfig.types.json
bunx --no-install vitepress build docs
```

## 发布

```bash
bun run release minor   # patch | minor | major | x.y.z
```

脚本要求 `main` 分支工作区干净，递增包版本，执行完整构建（包含扩展版本同步），然后提交、打 `v<version>` 标签并推送提交与标签。标签触发 CI 构建、测试、包发布、GitHub Release 创建和文档部署。当前工作流使用 Bun，没有 Node.js 多版本测试矩阵。

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

`bun test` 发现 `test/` 下的 unit、integration、system 测试以及 `extensions/test/`。`bun run test` 额外启动 `examples/compose.yaml`，因此需要 Docker。测试不能替代构建与客户端生成步骤。

未设置 `TEST_DATABASES` 时，辅助函数包含 SQLite 并探测已配置的服务端数据库；显式列表只选择列出的目标。仅运行 SQLite 不能验证服务端数据库特有行为。

| 数据库     | 连接环境变量                                               | 默认测试端口 |
| ---------- | ---------------------------------------------------------- | ------------ |
| PostgreSQL | `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD`、`PGDATABASE`   | 5433         |
| MySQL      | `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD` | 3307         |
| MariaDB    | 复用 MySQL 变量，端口使用 `MARIADB_PORT`                   | 3308         |

集成测试创建并清理隔离数据库或 schema；请使用具备相应权限的专用开发服务和账号。

## 文档维护规范

1. 先说明契约与前置条件，再提供示例。
2. 区分支持行为、数据库差异和限制。
3. 声明、运行时行为和命令参数分别集中在所属章节，通过链接引用，避免重复维护。
4. 中英文路径与行为说明保持一致。
5. 使用 `bunx --no-install vitepress build docs` 验证文档；导航配置变更还需类型检查。
6. 汇报时说明验证命令、数据库范围与未验证部分。

## 下一步

- [文档导航](./documentation.md)：各主题的位置
- [完整示例](./examples.md)：示例模型与执行方式
