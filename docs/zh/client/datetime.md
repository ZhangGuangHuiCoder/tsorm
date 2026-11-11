---
description: datetime 字段的本地日期时间语义、客户端时区和数据迁移注意事项。
---

# 日期与时区

`datetime` 字段默认存储本地日期时间。ORM 按客户端配置的固定偏移转换输入，读取格式由 `datetimeFormat` 配置。

## 配置时区

```ts
const db = await createClient({
  adapter,
  timezone: "+08:00",
  datetimeFormat: "utc",
});
```

`timezone` 默认为 `+08:00`，格式为 `±HH:mm`，取值范围是 `-14:00` 到 `+14:00`。全年使用同一个固定偏移，与主机时区无关。

## 读写格式

`datetime` 与 `timestamp` 查询均返回 `DateTime` 字符串：

| datetimeFormat  | 返回格式            | 示例（timezone 为 +08:00） |
| --------------- | ------------------- | -------------------------- |
| `local`（默认） | MySQL DATETIME 风格 | `2026-11-02 15:30:00.000`  |
| `utc`           | ISO 8601 UTC        | `2026-11-02T07:30:00.000Z` |

格式配置作用于模型查询、写入回读、关联与日期聚合结果。使用 `datetime` 存储时，UTC 结果按 `timezone` 从已存本地时间换算；`timestamp` 存储本身已表示时间点。原生 SQL 的结果格式由 SQL 表达式和适配器解析规则决定。

写入接受 `DateTimeInput = string | Date | number`。使用 `datetime` 存储时：

| 输入                  | 处理方式                                     |
| --------------------- | -------------------------------------------- |
| Unix 毫秒整数         | 必须是安全整数，按客户端时区转换为本地时间   |
| 本地时间字符串        | 校验并规范化格式，不换算时区                 |
| JavaScript `Date`     | 按客户端时区转换为本地时间字符串             |
| ISO UTC 字符串（`Z`） | `utc` 模式可直接回传，按客户端时区转换后保存 |
| 带偏移量的字符串      | 先构造 JavaScript `Date`                     |

```ts
await db.user.create({
  data: {
    email: "time@example.com",
    createdAt: "2026-11-02 15:30:00",
  },
});
```

例如，`new Date('2026-11-02T07:30:00Z')` 在 `+08:00` 的客户端中保存为 `2026-11-02 15:30:00.000`，`local` 模式返回该值，`utc` 模式返回 `2026-11-02T07:30:00.000Z`。

时间过滤、`set` 更新和原生 SQL 的 `Date` 参数都遵循相同的编码规则。ORM 会校验日期是否合法（包括闰年）和毫秒精度；MySQL 的 `DATETIME` 存储额外要求年份在 1000 到 9999 之间，该限制不适用于整数 `timestamp` 存储。

## 入库存储

使用 `datetime` 或 `timestamp` 字段类型选择存储方式，建表、迁移和运行时共用该定义：

```ts
model Event {
  id: int @id @auto
  occurredAt: timestamp
  createdAt: datetime = now()
}
```

| 配置        | SQLite    | MySQL / MariaDB | PostgreSQL                       |
| ----------- | --------- | --------------- | -------------------------------- |
| `datetime`  | `TEXT`    | `DATETIME(3)`   | `TIMESTAMP(3) WITHOUT TIME ZONE` |
| `timestamp` | `INTEGER` | `BIGINT`        | `BIGINT`                         |

时间戳使用 Unix 毫秒整数，表示 UTC 时间点。日期字符串按客户端 `timezone` 换算；JavaScript `Date` 和毫秒整数表示明确的时间点。返回格式由 `datetimeFormat` 独立控制。

为避免驱动提前解释无时区的值：

- PostgreSQL 为每次执行配置 `timestamp` 的文本解码。
- MySQL 适配器固定启用 `dateStrings`，`connection` 中的同名设置会被覆盖。如果收到 `Date` 输出，适配器会拒绝解码，而不是猜测转换。

已有数据切换存储类型时，先生成迁移 SQL，再按原时区语义转换历史数据。显式日期外键使用与目标主键一致的存储配置，隐式外键自动继承。

### now()

ORM 写入时按客户端时区生成 `now()`，并显式绑定为参数，不依赖数据库的默认时间。

::: warning 数据库生成的时间
以下来源的时间由数据库会话或主机时区决定，不受 `timezone` 控制：

- 直接调用 `NOW()` 或 `CURRENT_TIMESTAMP`
- 原生 `INSERT` 省略字段时的数据库默认值
- 迁移回填使用的数据库默认值

需要相同的业务时间时，请显式传入 `Date` 参数或已格式化的字符串。MySQL 与 PostgreSQL 适配器的连接会话固定使用 UTC；SQLite 没有服务端会话时区。
:::

## 修改时区与迁移旧数据

- 修改 `timezone` 不会重写已存数据，但会影响输入转换和结果解码：本地时间存储的 UTC 输出，以及时间戳存储的本地输出。
- 旧版本的 UTC / ISO 字符串或 PostgreSQL `TIMESTAMPTZ` 数据需按原始时间语义迁移。
- 日期结果是字符串而非 `Date` 对象；从使用 `Date` 的代码迁移时，按所选格式调整 `toISOString()`、`getTime()` 等调用。

## 下一步

- [模型与字段](../schema/overview.md#字段类型)：`datetime` 与 `timestamp` 字段类型
- [类型映射](../databases/overview.md#类型映射)：各数据库的物理列类型
- [客户端概览](./overview.md#选项)：`timezone` 与 `datetimeFormat` 选项
