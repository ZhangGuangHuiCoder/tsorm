---
description: 创建和关闭客户端，配置选项，读取数据库能力，处理错误。
---

# 客户端概览

生成的 `createClient` 是异步函数。一个客户端绑定一个适配器，模型通过首字母小写的属性访问，例如 `User` 对应 `db.user`。

示例默认使用[示例模型](../guide/examples.md)，另有模型前提时在对应页面说明。代码片段展示独立操作，不是按顺序执行的完整程序。

## 创建客户端

```ts
import { createClient } from "./generated/client.ts";
import { sqlite } from "@ofis/tsorm/adapters/sqlite";

const db = await createClient({
  adapter: sqlite({ connection: "file:./app.sqlite" }),
  timezone: "+08:00",
});

try {
  // 使用 db 访问数据库
} finally {
  await db.$close();
}
```

### 选项

| 选项             | 类型               | 默认值   | 说明                                                              |
| ---------------- | ------------------ | -------- | ----------------------------------------------------------------- |
| `adapter`        | `Adapter`          | 必填     | 数据库适配器，见[数据库适配器](../databases/adapters/overview.md) |
| `timezone`       | `string`           | `+08:00` | 固定偏移时区，见[日期与时区](./datetime.md)                       |
| `datetimeFormat` | `'local' \| 'utc'` | `local`  | 模型日期返回格式：本地时间或 ISO UTC                              |
| `logger`         | `Logger`           | 无       | 事件回调，见[事件日志](./logging.md)                              |
| `maxAffected`    | `number`           | 无       | 批量写的行数上限，见[写入安全](#写入安全)                         |

虚拟字段与全局 omit 不在此配置：用 `$extend` 扩展客户端添加，见[扩展](./extensions.md)。

## 切换数据库

同一份模型和生成的客户端可以搭配任意适配器，切换时不需要重新生成：

```ts
import { sqlite } from "@ofis/tsorm/adapters/sqlite";
import { mysql } from "@ofis/tsorm/adapters/mysql";
import { postgres } from "@ofis/tsorm/adapters/postgres";

const adapter = sqlite({ connection: "file:./app.sqlite" });
// const adapter = mysql({ connection: 'mysql://app:password@localhost:3306/app' });
// const adapter = postgres({ connection: 'postgresql://app:password@localhost:5432/app' });
```

更换适配器不会迁移已有表或数据。应为目标数据库建立对应的结构和迁移历史，数据搬迁需另行处理。

## 关闭客户端

`$close()` 等待已开始的请求完成，再释放连接。关闭后的调用报 `CLIENT_CLOSED`；在事务内调用报 `TRANSACTION_SCOPE`。

多个客户端通过 `$extend` 共享关闭状态。并发调用 `$close()` 均等待同一次资源释放，并接收相同的关闭错误。

## 读取数据库能力

`$capabilities` 是只读对象，描述当前适配器的能力：

```ts
console.log(db.$capabilities);
// { returning, windowFunctions, transactionalDDL, versionedMigrations, isolationLevels }
```

各数据库的取值见[能力对比](../databases/overview.md#客户端能力)。

## 错误处理

客户端校验错误和已映射的数据库错误使用 `OrmError`，通过 `code` 判断原因；其他异常可能原样透传：

```ts
import { OrmError } from "@ofis/tsorm";

try {
  await db.user.create({ data: { email: "alice@example.com" } });
} catch (error) {
  if (error instanceof OrmError && error.code === "UNIQUE_CONSTRAINT") {
    // 处理重复邮箱
  } else {
    throw error;
  }
}
```

完整列表见[错误码](../reference/errors.md)。

::: warning 敏感信息
错误消息隐藏 SQL 参数；`cause` 保留原始驱动错误，可能含输入值。写入应用日志前请自行过滤。
:::

## 写入安全

顶层批量更新、删除和恢复方法要求非空 `where`，缺失或为空时报 `VALIDATION`。`createMany` 没有 `where`，嵌套写入则受父关系范围约束，见[关系写入](./relation-writes.md)。显式清空表使用 [`$clear`](./delete.md#清空整表)。

`maxAffected` 必须是正的安全整数，限制顶层批量更新、删除和恢复的行数，默认不设限。命中行数超过上限时抛出 `MASS_WRITE_BLOCKED`，不执行该次写入。计数与写入是两条独立语句，因此它能挡住写错的过滤条件，挡不住并发写入。`$clear` 不受此限制，因为调用本身即是确认。

## 执行方式

- 一次 API 调用不一定对应一条 SQL。关系预加载和关系计数按批执行，每批最多 200 个父键，按父键批量查询。
- 根查询和关联查询的 `select`、`omit` 会裁剪数据库列，同时保留关系键、主键和虚拟字段依赖。
- 只有实际加载的列才会解码和校验。

## 下一步

- [查询](./queries.md)：过滤、投影、关系加载与分页
- [创建](./create.md)、[更新](./update.md)与[删除](./delete.md)：写操作
- [事务](./transactions.md)：把多个操作合并为一个事务
