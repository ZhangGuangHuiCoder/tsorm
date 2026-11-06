---
description: date 字段的本地日期时间语义、客户端时区和数据迁移注意事项。
---

# 日期与时区

`date` 字段存储不带时区的本地日期时间。ORM 按客户端配置的固定偏移转换输入，读取时原样返回字符串，不做 UTC 往返转换。

## 配置时区

```ts
const db = await createClient({
  adapter,
  timezone: '+08:00',
});
```

`timezone` 默认为 `+08:00`，格式为 `±HH:mm`，取值范围是 `-14:00` 到 `+14:00`。全年使用同一个固定偏移，与主机时区无关。

## 读写格式

查询返回 `DateTime` 字符串，格式固定为 `YYYY-MM-DD HH:mm:ss.SSS`。

写入接受 `DateTimeInput`：

| 输入                                  | 处理方式                                 |
| ------------------------------------- | ---------------------------------------- |
| 本地时间字符串                        | 校验并规范化格式，不换算时区             |
| JavaScript `Date`                     | 按客户端时区转换为本地时间字符串         |
| 带 `Z` 或偏移量的字符串               | 拒绝，需要先显式构造 `Date`              |

```ts
await db.post.create({
  data: {
    title: 'Local time',
    authorId: 1,
    createdAt: '2026-11-02 15:30:00',
  },
});
```

例如，`new Date('2026-11-02T07:30:00Z')` 在 `+08:00` 的客户端中保存为 `2026-11-02 15:30:00.000`，查询也返回该值。

时间过滤、`set` 更新和原生 SQL 的 `Date` 参数都遵循相同的编码规则。ORM 会校验日期是否合法（包括闰年）和毫秒精度；MySQL 额外要求年份在 1000 到 9999 之间。

## now()

ORM 写入时按客户端时区生成 `now()`，并显式绑定为参数，不依赖数据库的默认时间。

::: warning 数据库生成的时间
以下来源的时间由数据库会话或主机时区决定，不受 `timezone` 控制：

- 直接调用 `NOW()` 或 `CURRENT_TIMESTAMP`
- 原生 `INSERT` 省略字段时的数据库默认值
- 迁移回填使用的数据库默认值

需要相同的业务时间时，请显式传入 `Date` 参数或已格式化的字符串。适配器的连接会话固定使用 UTC。
:::

## 存储

| 数据库          | 物理类型                         |
| --------------- | -------------------------------- |
| MySQL / MariaDB | `DATETIME(3)`                    |
| PostgreSQL      | `TIMESTAMP(3) WITHOUT TIME ZONE` |
| SQLite          | `TEXT`                           |

为了避免驱动提前解释无时区的值：

- PostgreSQL 为每次执行配置 `timestamp` 的文本解码。
- MySQL 适配器固定启用 `dateStrings`，`connection` 中的同名设置会被覆盖。如果收到 `Date` 输出，适配器会拒绝解码，而不是猜测转换。

## 修改时区与迁移旧数据

- 修改客户端时区不会修改或重算已有记录。
- 旧版本的 UTC / ISO 字符串或 PostgreSQL `TIMESTAMPTZ` 数据不能直接沿用，需要按原始语义迁移。
- 重新生成客户端后，日期字段的返回类型从 `Date` 变为 `string`，需要调整原有的 `toISOString`、`getTime` 等调用。
