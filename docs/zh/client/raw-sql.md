---
description: 使用 $queryRaw 和 $executeRaw 执行参数化的原生 SQL。
---

# 原生 SQL

`$queryRaw` 和 `$executeRaw` 用于执行模型 API 无法表达的语句。参数使用标签模板或 `sql` 片段。

以下示例使用 SQLite / PostgreSQL 的标识符引号；MySQL 请改用反引号。

## 查询

```ts
const email = "alice@example.com";
const rows = await db.$queryRaw<{ id: unknown; email: string }[]>`
  SELECT "id", "email" FROM "User" WHERE "email" = ${email}
`;
```

泛型参数表示整个返回值的类型，通常是记录数组，不会校验或转换运行时结果。

## 写入

`$executeRaw` 返回受影响的行数：

```ts
const affected = await db.$executeRaw`
  UPDATE "Post" SET "views" = 0 WHERE "published" = ${false}
`;
```

## 组合片段

使用 `sql` 构造可以嵌套的片段。参数位置会按当前数据库生成为 `?` 或 `$n`。

```ts
import { sql } from "@ofis/tsorm";

const condition = sql`"email" = ${email}`;
const rows = await db.$queryRaw<{ id: unknown; email: string }[]>(sql`SELECT "id", "email" FROM "User" WHERE ${condition}`);
```

## 事务

事务回调中的 `tx` 提供相同的接口：

```ts
await db.$transaction(async (tx) => {
  await tx.$executeRaw`DELETE FROM "Tag" WHERE "name" = ${"obsolete"}`;
});
```

## 注意事项

::: danger 插值只能是值
模板插值用于绑定数据值；表名和列名使用静态 SQL。
:::

- **标识符**：引号由调用方按数据库方言书写。SQLite 和 PostgreSQL 使用双引号，MySQL 使用反引号。
- **结果类型**：结果不经过模型解码，而遵循适配器的解析与规范化规则，例如 `int` 列在 SQLite 上返回字符串，不是 `number`。`datetime`、JSON 等值遵循适配器的解析设置。
- **`Date` 参数**：按客户端时区编码，见[日期与时区](./datetime.md)。
- **写入保护与软删除**：原生 SQL 不应用模型可见性、非空 `where` 检查或 `maxAffected`；请自行提供并校验条件。
- **语句校验**：SQL 语法与结构由数据库校验。

## 下一步

- [事务](./transactions.md)：在事务中执行原生语句
- [日期与时区](./datetime.md)：`Date` 参数的编码方式
- [软删除](../schema/soft-delete.md)：原生 SQL 需自行添加的可见性条件
