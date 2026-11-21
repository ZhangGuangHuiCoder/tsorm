---
description: "Date semantics of datetime fields: Date objects in and out, and how each database stores them."
---

# Date & Timezone

A `datetime` or `timestamp` field is an **instant**. The ORM reads and writes `Date` objects, so no timezone option exists and no output format has to be chosen.

```ts
const db = createClient({ connection: "file:./app.sqlite" });

const user = await db.user.create({
  data: { email: "time@example.com", createdAt: new Date() },
});
user.createdAt; // Date
```

## Inputs

Writes accept `Date` only:

```ts
await db.user.create({ data: { email: "time@example.com", createdAt: new Date("2026-11-02T15:30:00.000Z") } });
```

The same `Date`-only rule applies to `datetime` filters and `set` updates; strings, millisecond numbers, and other types are not accepted. Raw SQL parameters have no model field type, so pass a `Date` when binding an instant:

```ts
const since = new Date("2026-01-01T00:00:00.000Z");
const rows = await db.$queryRaw<{ id: unknown; email: string }[]>`
  SELECT "id", "email" FROM "User" WHERE "createdAt" >= ${since}
`;
```

## Storage

Choose `datetime` or `timestamp` as the field type. DDL, migrations, and runtime share this definition:

```ts
model Event {
  id: int @id @auto
  occurredAt: timestamp
  createdAt: datetime = now()
}
```

| Configuration | SQLite    | MySQL / MariaDB | PostgreSQL                    |
| ------------- | --------- | --------------- | ----------------------------- |
| `datetime`    | `TEXT`    | `DATETIME(3)`   | `TIMESTAMP(3) WITH TIME ZONE` |
| `timestamp`   | `INTEGER` | `BIGINT`        | `BIGINT`                      |

Each database stores the instant its own way; the adapter converts in both directions, so the client only ever sees `Date`:

| Database        | Stored value                   | Column type                   |
| --------------- | ------------------------------ | ----------------------------- |
| PostgreSQL      | Absolute instant               | `TIMESTAMP(3) WITH TIME ZONE` |
| MySQL / MariaDB | `Date` converted by the driver | `DATETIME(3)`                 |
| SQLite          | UTC ISO text (`toISOString`)   | `TEXT`                        |

MySQL `DATETIME` carries no timezone: the driver serializes and parses it using the connection `timezone` (local by default), while database defaults use the server timezone — set the connection `timezone` to the server timezone when both must agree. SQLite stores UTC ISO text (`now()` uses the same frame); PostgreSQL keeps the instant itself.

Explicit datetime foreign keys use the target key's storage configuration; implicit foreign keys inherit it.

### now()

On write, the ORM generates `now()` on the client and binds it as a parameter, instead of relying on the database's default time.

::: warning Database-generated times
The following sources of time come from the database, not from the ORM:

- Calling `NOW()` or `CURRENT_TIMESTAMP` directly
- Database defaults when a native `INSERT` omits the field
- Database defaults used to backfill during migrations

They agree with the ORM only when the timezone frames line up: PostgreSQL and SQLite always do; MySQL needs the connection `timezone` set to the server timezone.
:::

## Next Steps

- [Models and Fields](../schema/overview.md#field-types): the `datetime` and `timestamp` field types
- [Type Mapping](../databases/overview.md#type-mapping): the physical column type per database
- [Client Overview](./overview.md#options): the client options
