---
description: 使用 $queryRaw 和 $executeRaw 执行参数化的原生 SQL。
---

# 原生 SQL

`$queryRaw` 和 `$executeRaw` 用于执行模型 API 无法表达的语句。它们只接受标签模板或 `sql` 片段，不接受普通字符串。

## 查询

```ts
const email = 'alice@example.com';
const rows = await db.$queryRaw<{ id: unknown; email: string }[]>`
  SELECT "id", "email" FROM "User" WHERE "email" = ${email}
`;
```

泛型参数表示整个返回值的类型，通常声明为记录数组。

## 写入

`$executeRaw` 返回受影响的行数：

```ts
const affected = await db.$executeRaw`
  UPDATE "Post" SET "views" = 0 WHERE "published" = ${0}
`;
```

## 组合片段

使用 `sql` 构造可以嵌套的片段。参数位置会按当前数据库生成为 `?` 或 `$n`。

```ts
import { sql } from '@ofis/tsorm';

const condition = sql`"email" = ${email}`;
const rows = await db.$queryRaw<{ id: unknown; email: string }[]>(
  sql`SELECT "id", "email" FROM "User" WHERE ${condition}`,
);
```

## 事务

事务回调中的 `tx` 提供相同的接口：

```ts
await db.$transaction(async (tx) => {
  await tx.$executeRaw`DELETE FROM "Tag" WHERE "name" = ${'obsolete'}`;
});
```

## 注意事项

::: danger 插值只能是值
模板内的插值只作为绑定参数，不能用作表名或列名。
:::

- **标识符**：引号由调用方按数据库方言书写。SQLite 和 PostgreSQL 使用双引号，MySQL 使用反引号。
- **结果类型**：返回的记录不经过模型解码，声明的类型也不做运行时校验。值的类型由驱动决定，例如 `int` 列在 SQLite 上返回 `BigInt`，不是 `number`。`date`、JSON 等值遵循适配器的解析设置。
- **`Date` 参数**：按客户端时区编码，见[日期与时区](./datetime.md)。
- **软删除**：原生 SQL 不应用软删除策略。
- **类型检查**：这不是 TypedSQL，编译期不会根据数据库结构检查语句。
