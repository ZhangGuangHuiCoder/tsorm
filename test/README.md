# 测试约定

## 层级与位置

- `unit/`：不打开数据库连接、不启动子进程。
- `integration/`：至少一个真实数据库（含 SQLite 内存库或临时文件）；用 `eachDatabase` 覆盖目标矩阵。
- `system/`：通过进程边界调用 CLI。
- `types/`：编译期类型夹具，由 `tsc -p tsconfig.types.json` 检查；`unit/types.test.ts` 检查悬停文本。
- `bench/`：手动微基准，不参与 `bun test`；直接用 `bun test/bench/bench.ts` 运行。
- `extensions/test/`：VS Code 扩展的语言逻辑，随 `bun test` 运行。

新增用例按实际触及的最高层级归目录；单一领域的回归放进该领域目录，跨模块回归进 `regression`。

## 运行

- `bun test`：运行 unit/integration/system；SQLite 总会执行，其余数据库可连通时自动加入。
- `TEST_DATABASES=sqlite,postgres bun test ...`：显式指定目标；列出的库不可连接会失败而不是跳过。
- `bun run test`：先启动 `examples/compose.yaml` 的数据库，再跑全量测试，失败时打印容器日志。
- `fixtures/client.ts` 由 `bun run build` 从 `fixtures/schema.orm` 生成，不要手工编辑。

## 写用例

- 集成用例用 `eachDatabase` 或显式 `sandbox` 覆盖声明范围内的全部目标；方言差异用 `ctx.target` 分支并注明原因。
- 断言十进制字符串时区分列值与聚合值：聚合的整数和需要在解码时按标度补零。
- 边界与错误用例优先补进现有的 `*-boundaries.test.ts` 或对应领域文件，不为一个场景新建文件。
- 回归用例只固定已确认的缺陷，不把未定义的实现细节写成规范。
