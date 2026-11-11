---
description: Execute parameterized raw SQL with $queryRaw and $executeRaw.
---

# Raw SQL

`$queryRaw` and `$executeRaw` run statements that the model API cannot express. They accept only tagged templates or `sql` fragments, never plain strings.

The examples below use SQLite / PostgreSQL identifier quoting. For MySQL, use backticks for identifiers.

## Queries

```ts
const email = "alice@example.com";
const rows = await db.$queryRaw<{ id: unknown; email: string }[]>`
  SELECT "id", "email" FROM "User" WHERE "email" = ${email}
`;
```

The generic parameter is the type of the whole return value, usually an array of records; it does not validate or convert runtime results.

## Writes

`$executeRaw` returns the number of affected rows:

```ts
const affected = await db.$executeRaw`
  UPDATE "Post" SET "views" = 0 WHERE "published" = ${false}
`;
```

## Composing Fragments

Use `sql` to build nestable fragments. Parameter placeholders are generated as `?` or `$n` for the current database.

```ts
import { sql } from "@ofis/tsorm";

const condition = sql`"email" = ${email}`;
const rows = await db.$queryRaw<{ id: unknown; email: string }[]>(sql`SELECT "id", "email" FROM "User" WHERE ${condition}`);
```

## Transactions

The `tx` in a transaction callback provides the same interface:

```ts
await db.$transaction(async (tx) => {
  await tx.$executeRaw`DELETE FROM "Tag" WHERE "name" = ${"obsolete"}`;
});
```

## Caveats

::: danger Interpolation must be a value
Template interpolations bind data values. Use static SQL for table and column names.
:::

- **Identifiers**: quoting is written by the caller in the database's dialect. SQLite and PostgreSQL use double quotes, MySQL uses backticks.
- **Result types**: returned records are not decoded through the model, and declared types are not validated at runtime. Adapters normalize bigint and date-time values to strings. Model `int` fields are converted to safe JavaScript numbers through the model API. `datetime`, JSON, and similar values follow the adapter's parsing settings.
- **`Date` parameters**: encoded in the client timezone, see [Date & Timezone](./datetime.md).
- **Write guards and soft delete**: raw SQL bypasses model visibility, non-empty `where` checks, and `maxAffected`; provide and validate the intended conditions yourself.
- **Statement validation**: the database validates SQL syntax and structure.

## Next Steps

- [Transactions](./transactions.md): run raw statements inside a transaction
- [Date & Timezone](./datetime.md): how `Date` parameters are encoded
- [Soft Delete](../schema/soft-delete.md): visibility conditions that raw SQL must add itself
