---
description: 声明 JSON 字段的结构，在读写时校验，并区分 SQL NULL 与 JSON null。
---

# 类型化 JSON

`json<T>` 字段在编译期提供类型，并在读写时校验结构。

## 声明

```ts
type Preferences = {
  theme: "light" | "dark"
  notifications: boolean
  languages: string[]
  metadata?: Record<string, string>
}

model Account {
  id: int @id @auto
  preferences?: json<Preferences>
}
```

支持的结构包括对象、可选字段、数组、字面量联合、`null`、`Record<string, T>` 和类型引用。

## 校验

写入和读取都会校验：

- 拒绝未知的对象属性和错误的类型。
- 拒绝非有限数、`Date`、`BigInt` 等非 JSON 数据。
- 拒绝稀疏数组、访问器和自定义序列化，仅读取数据属性。
- 嵌套最多 64 层。

输入错误会报告字段路径（`VALIDATION`）。数据库中已有的值不符合结构时，报 `INVALID_DATABASE_VALUE`。

## 区分 NULL

```ts
import { DbNull, JsonNull } from "@ofis/tsorm";

await db.account.update({
  where: { id: 1 },
  data: { preferences: { set: DbNull } },
});
```

| 写入值             | 含义               | 要求                                                  |
| ------------------ | ------------------ | ----------------------------------------------------- |
| `DbNull` 或 `null` | SQL `NULL`         | 字段可空                                              |
| `JsonNull`         | JSON 字面量 `null` | JSON 类型本身包含 `null`，例如 `json<string \| null>` |

读取时，两者都映射为 JavaScript 的 `null`。

## 存储

| 数据库          | 物理类型 | 说明                                                               |
| --------------- | -------- | ------------------------------------------------------------------ |
| SQLite          | `TEXT`   | 通过 `json_valid` 的 `CHECK` 约束校验                              |
| MySQL / MariaDB | `JSON`   | 适配器固定 `autoJsonMap: false`，`connection` 中的同名设置会被覆盖 |
| PostgreSQL      | `JSONB`  | 使用查询级文本解析，避免混淆 JSON 字符串与原始 JSON 文本           |

## 使用说明

- 写入时整体赋值或使用 `set`。
- 可以按路径过滤，见[查询](../client/queries.md#json-字段)。
- `type` 定义 TypeScript 类型，数据库结构保持一致。已有数据需要在迁移 SQL 中自行校验和回填。

## 下一步

- [查询](../client/queries.md#json-字段)：按路径过滤 JSON 值
- [类型映射](../databases/overview.md#类型映射)：各数据库的物理列类型
