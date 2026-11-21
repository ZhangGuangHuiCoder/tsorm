---
description: datetime 字段的日期语义：进出都是 Date 对象，以及各数据库的存储方式。
---

# 日期与时区

`datetime` 与 `timestamp` 字段表示的是一个**时间点**。ORM 读写都用 `Date` 对象，因此没有时区选项，也不需要选择输出格式。

```ts
const db = createClient({ connection: "file:./app.sqlite" });

const user = await db.user.create({
  data: { email: "time@example.com", createdAt: new Date() },
});
user.createdAt; // Date
```

## 输入

写入只接受 `Date`：

```ts
await db.user.create({ data: { email: "time@example.com", createdAt: new Date("2026-11-02T15:30:00.000Z") } });
```

`datetime` 过滤条件和 `set` 更新同样只接受 `Date`，不支持字符串、毫秒数字等其它类型。原生 SQL 参数没有模型字段类型信息，绑定时间点时应传入 `Date`：

```ts
const since = new Date("2026-01-01T00:00:00.000Z");
const rows = await db.$queryRaw<{ id: unknown; email: string }[]>`
  SELECT "id", "email" FROM "User" WHERE "createdAt" >= ${since}
`;
```

## 存储

字段类型选 `datetime` 或 `timestamp`，DDL、迁移与运行时共用同一份定义：

```ts
model Event {
  id: int @id @auto
  occurredAt: timestamp
  createdAt: datetime = now()
}
```

| 配置        | SQLite    | MySQL / MariaDB | PostgreSQL                    |
| ----------- | --------- | --------------- | ----------------------------- |
| `datetime`  | `TEXT`    | `DATETIME(3)`   | `TIMESTAMP(3) WITH TIME ZONE` |
| `timestamp` | `INTEGER` | `BIGINT`        | `BIGINT`                      |

每个数据库用自己的方式存时间点，换算由适配器完成，客户端只看到 `Date`：

| 数据库          | 存储的值                         | 列类型                        |
| --------------- | -------------------------------- | ----------------------------- |
| PostgreSQL      | 绝对时刻                         | `TIMESTAMP(3) WITH TIME ZONE` |
| MySQL / MariaDB | 驱动按连接时区转换的 `Date`      | `DATETIME(3)`                 |
| SQLite          | UTC 的 ISO 文本（`toISOString`） | `TEXT`                        |

MySQL 的 `DATETIME` 不带时区，序列化与反序列化都按连接 `timezone`（默认本机时区）处理，而数据库默认值按服务器时区生成——要让两者一致，请把连接 `timezone` 设为服务器时区。SQLite 存 UTC 的 ISO 文本（`now()` 同口径）；PostgreSQL 直接存时刻本身。

显式声明的 datetime 外键使用目标键的存储配置，隐式外键继承它。

### now()

写入时 ORM 在客户端生成 `now()` 并显式绑定为参数，不依赖数据库的默认时间。

::: warning 数据库生成的时间
以下时间来自数据库，而不是 ORM：

- 直接调用 `NOW()` 或 `CURRENT_TIMESTAMP`
- 原生 `INSERT` 省略字段时的数据库默认值
- 迁移回填使用的数据库默认值

它们与 ORM 一致的前提是时区口径与连接一致：PostgreSQL 与 SQLite 天然一致；MySQL 需要把连接 `timezone` 设为服务器时区。
:::

## 下一步

- [模型与字段](../schema/overview.md#字段类型)：`datetime` 与 `timestamp` 字段类型
- [类型映射](../databases/overview.md#类型映射)：各数据库的物理列类型
- [客户端概览](./overview.md#选项)：客户端选项
