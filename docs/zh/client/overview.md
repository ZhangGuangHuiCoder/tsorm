---
description: 创建和关闭客户端，配置选项，读取数据库能力，处理错误。
---

# 客户端概览

生成的 `createClient` 是异步函数。一个客户端绑定一个适配器，模型通过首字母小写的属性访问，例如 `User` 对应 `db.user`。

本章节的示例均基于 `examples/schema.orm` 中定义的模型，见[完整示例](../guide/examples.md)。

## 创建客户端

```ts
import { createClient } from './generated/client.ts';
import { sqlite } from '@ofis/tsorm/adapters/sqlite';

const db = await createClient({
  adapter: sqlite({ filename: './app.sqlite' }),
  timezone: '+08:00',
});

try {
  // 使用 db 访问数据库
} finally {
  await db.$close();
}
```

### 选项

| 选项       | 类型      | 默认值   | 说明                                                       |
| ---------- | --------- | -------- | ---------------------------------------------------------- |
| `adapter`  | `Adapter` | 必填     | 数据库适配器，见[数据库适配器](../databases/adapters.md) |
| `timezone` | `string`  | `+08:00` | 固定偏移时区，见[日期与时区](./datetime.md)                |
| `logger`   | `Logger`  | 无       | 事件回调，见[事件日志](./logging.md)                       |
| `virtuals` | `object`  | 无       | 虚拟字段定义，见[虚拟字段](./virtual-fields.md)            |
| `omit`     | `object`  | 无       | 默认从结果中排除的字段，按模型（首字母小写）配置           |

`omit` 适合密码哈希这类默认不应返回的字段。它作用于所有返回记录的方法和嵌套关系，返回类型同步去掉这些字段；查询中用 `select` 或 `omit: { 字段: false }` 可以取回。过滤、排序和唯一查找不受影响：

```ts
const db = await createClient({
  adapter: sqlite({ filename: './app.sqlite' }),
  omit: { user: { passwordHash: true } },
});
await db.user.findUnique({ where: { id: 1 } }); // 不含 passwordHash
await db.user.findUnique({ where: { id: 1 }, omit: { passwordHash: false } });
```

## 切换数据库

同一份模型和生成的客户端可以搭配任意适配器，切换时不需要重新生成：

```ts
import { sqlite, mysql, postgres } from '@ofis/tsorm/adapters';

const adapter = sqlite({ filename: './app.sqlite' });
// const adapter = mysql({ connection: { host: 'localhost', user: 'app', database: 'app' } });
// const adapter = postgres({ connection: { connectionString: process.env.DATABASE_URL } });
```

更换适配器不会迁移已有的表和数据。

## 关闭客户端

`$close()` 等待已开始的请求完成，再释放连接。关闭后的调用报 `CLIENT_CLOSED`；在事务内调用报 `TRANSACTION_SCOPE`。

## 读取数据库能力

`$capabilities` 是只读对象，描述当前适配器的能力：

```ts
console.log(db.$capabilities);
// { returning, windowFunctions, transactionalDDL, versionedMigrations, isolationLevels }
```

各数据库的取值见[能力对比](../databases/overview.md#客户端能力)。

## 错误处理

ORM 抛出的错误是 `OrmError`，通过 `code` 判断原因：

```ts
import { OrmError } from '@ofis/tsorm';

try {
  await db.user.create({ data: { email: 'alice@example.com' } });
} catch (error) {
  if (error instanceof OrmError && error.code === 'UNIQUE_CONSTRAINT') {
    // 处理重复邮箱
  } else {
    throw error;
  }
}
```

完整列表见[错误码](../reference/errors.md)。

::: warning 敏感信息
错误消息不包含 SQL 参数，但 `cause` 中保留的原始驱动错误可能包含输入值。写入应用日志前请自行过滤。
:::

## 执行方式

- 一次 API 调用不一定对应一条 SQL。关系预加载和关系计数按批执行，每批最多 200 个父键，不会逐条查询父记录。
- 根查询和关联查询的 `select`、`omit` 会裁剪数据库列，同时保留关系键、主键和虚拟字段依赖。
- 只有实际加载的列才会解码和校验。
