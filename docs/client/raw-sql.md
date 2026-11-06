---
description: Execute parameterized raw SQL with $queryRaw and $executeRaw.
---

# Raw SQL

`$queryRaw` and `$executeRaw` run statements that the model API cannot express. They accept only tagged templates or `sql` fragments, never plain strings.

## Queries

```ts
const email = 'alice@example.com';
const rows = await db.$queryRaw<{ id: unknown; email: string }[]>`
  SELECT "id", "email" FROM "User" WHERE "email" = ${email}
`;
```

The generic parameter is the type of the whole return value, usually declared as an array of records.

## Writes

`$executeRaw` returns the number of affected rows:

```ts
const affected = await db.$executeRaw`
  UPDATE "Post" SET "views" = 0 WHERE "published" = ${0}
`;
```

## Composing Fragments

Use `sql` to build nestable fragments. Parameter placeholders are generated as `?` or `$n` for the current database.

```ts
import { sql } from '@ofis/tsorm';

const condition = sql`"email" = ${email}`;
const rows = await db.$queryRaw<{ id: unknown; email: string }[]>(
  sql`SELECT "id", "email" FROM "User" WHERE ${condition}`,
);
```

## Transactions

The `tx` in a transaction callback provides the same interface:

```ts
await db.$transaction(async (tx) => {
  await tx.$executeRaw`DELETE FROM "Tag" WHERE "name" = ${'obsolete'}`;
});
```

## Caveats

::: danger Interpolation must be a value
Interpolations in a template are bound only as parameters and cannot serve as table or column names.
:::

- **Identifiers**: quoting is written by the caller in the database's dialect. SQLite and PostgreSQL use double quotes, MySQL uses backticks.
- **Result types**: returned records are not decoded through the model, and declared types are not validated at runtime. Value types are decided by the driver; for example, an `int` column returns `BigInt` on SQLite, not `number`. `date`, JSON, and similar values follow the adapter's parsing settings.
- **`Date` parameters**: encoded in the client timezone, see [Date & Timezone](./datetime.md).
- **Soft delete**: raw SQL does not apply the soft-delete policy.
- **Type checking**: this is not TypedSQL; statements are not checked against the schema at compile time.
