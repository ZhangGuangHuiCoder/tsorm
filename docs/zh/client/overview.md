---
description: 创建、配置与关闭客户端，读取能力，处理错误。
---

# 客户端概览

`createClient` 是同步函数：它不建立连接，因此无需 `await`。一个客户端绑定一个适配器，模型是首字母小写的属性（`User` → `db.user`）。示例默认使用[示例模型](../guide/examples.md)，另有模型前提时在对应页面说明。

## 创建客户端

```ts
import { createClient } from "./generated/client.ts";

const db = createClient({
  connection: "file:./app.sqlite",
});

try {
  // 使用 db 访问数据库
} finally {
  await db.$close();
}
```

### 选项

| 选项          | 类型     | 默认值 | 说明                                                                                |
| ------------- | -------- | ------ | ----------------------------------------------------------------------------------- |
| `connection`  | `string` | 必填   | 连接 URL，适配器按协议自动选择，见[数据库适配器](../databases/adapters/overview.md) |
| `logger`      | `Logger` | 无     | 事件回调，见[事件日志](./logging.md)                                                |
| `maxAffected` | `number` | 无     | 批量写的行数上限，见[写入安全](#写入安全)                                           |

适配器在首次数据库操作时才连接，连接失败会在那时报告；未使用的客户端调用 `$close()` 直接返回。虚拟字段与全局 omit 用 `$extend` 添加，见[扩展](./extensions.md)。

## 切换数据库

同一份模型和生成的客户端可以搭配任意适配器，切换时不需要重新生成：

```ts
import { createClient } from "./generated/client.ts";

const db = createClient({ connection: "file:./app.sqlite" });
// const db = createClient({ connection: "mysql://app:password@localhost:3306/app" });
// const db = createClient({ connection: "postgresql://app:password@localhost:5432/app" });
```

更换适配器不会迁移已有表或数据。

## 关闭客户端

`$close()` 等待已开始的请求完成，再释放连接。关闭后的调用报 `CLIENT_CLOSED`；在事务内调用报 `TRANSACTION_SCOPE`。通过 `$extend` 创建的客户端共享关闭状态。

## 读取数据库能力

`$capabilities` 描述当前适配器，`createClient` 返回后即可读取：

```ts
console.log(db.$capabilities);
// { returning, isolationLevels }
```

各数据库的取值见[能力对比](../databases/overview.md#客户端能力)。

## 错误处理

客户端校验错误和已映射的数据库错误使用 `OrmError`，通过 `code` 判断原因：

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
错误消息不包含 SQL 参数；`cause` 保留原始驱动错误，可能含输入值，写入应用日志前请过滤。
:::

## 写入安全

顶层批量更新、删除和恢复方法要求非空 `where`，为空时报 `VALIDATION`。嵌套写入受父关系范围约束，见[关系写入](./relation-writes.md)。清空表使用 [`$clear`](./delete.md#清空整表)。`maxAffected`（正的安全整数，默认不设限）限制这些批量操作的行数，超过时抛出 `MASS_WRITE_BLOCKED`，不执行该写入——计数与写入是两条独立语句，因此它挡得住写错的过滤条件，挡不住并发写入；`$clear` 不受此限制，因为调用本身即是确认。

## 执行方式

- 一次 API 调用不一定对应一条 SQL；关系加载和计数按批执行，每批最多 200 个父键，从不逐父查询。`select`、`omit` 会裁剪数据库列，同时保留关系键、主键和虚拟字段依赖，只有实际加载的列才被解码和校验。

## 下一步

- [查询](./queries.md)：过滤、投影、关系加载与分页
- [创建](./create.md)、[更新](./update.md)与[删除](./delete.md)：写操作
- [事务](./transactions.md)：把多个操作合并为一个事务
