---
description: Local date-time semantics of datetime fields, the client timezone, and data migration caveats.
---

# Date & Timezone

A `datetime` field uses local date-time storage by default. The ORM converts input using the fixed offset configured on the client, and selects the read format through `datetimeFormat`.

## Configuring the Timezone

```ts
const db = await createClient({
  adapter,
  timezone: "+08:00",
  datetimeFormat: "utc",
});
```

`timezone` defaults to `+08:00`, is formatted as `±HH:mm`, and ranges from `-14:00` to `+14:00`. The same fixed offset applies all year, independent of the host timezone.

## Read and Write Formats

Both `datetime` and `timestamp` queries return `DateTime` strings:

| datetimeFormat    | Output               | Example with timezone +08:00 |
| ----------------- | -------------------- | ---------------------------- |
| `local` (default) | MySQL DATETIME style | `2026-11-02 15:30:00.000`    |
| `utc`             | ISO 8601 UTC         | `2026-11-02T07:30:00.000Z`   |

The format applies to model queries, write readback, relations, and date aggregates. For `datetime` storage, UTC output interprets stored local times using `timezone`; `timestamp` storage already represents an instant. Raw SQL result formatting follows the SQL expression and adapter parsing rules.

Writes accept `DateTimeInput = string | Date | number`. For `datetime` storage:

| Input                    | Handling                                                              |
| ------------------------ | --------------------------------------------------------------------- |
| Unix millisecond integer | Must be a safe integer; converted to client local time                |
| Local time string        | Validated and normalized, no timezone conversion                      |
| JavaScript `Date`        | Converted to a local time string in the client timezone               |
| ISO UTC string (`Z`)     | Accepted in `utc` mode and converted to client local time for storage |
| String with an offset    | Construct a JavaScript `Date` first                                   |

```ts
await db.user.create({
  data: {
    email: "time@example.com",
    createdAt: "2026-11-02 15:30:00",
  },
});
```

For example, `new Date('2026-11-02T07:30:00Z')` on a `+08:00` client is stored as `2026-11-02 15:30:00.000`, with `local` output returning that value and `utc` output returning `2026-11-02T07:30:00.000Z`.

`datetime` filters, `set` updates, and `Date` parameters in raw SQL all follow the same encoding rules. The ORM validates that dates are legal (including leap years) with millisecond precision; MySQL additionally requires years 1000–9999 for `DATETIME` storage; this limit does not apply to integer `timestamp` storage.

## Storage

Choose `datetime` or `timestamp` as the field type. DDL, migrations, and runtime share this definition:

```ts
model Event {
  id: int @id @auto
  occurredAt: timestamp
  createdAt: datetime = now()
}
```

| Configuration | SQLite    | MySQL / MariaDB | PostgreSQL                       |
| ------------- | --------- | --------------- | -------------------------------- |
| `datetime`    | `TEXT`    | `DATETIME(3)`   | `TIMESTAMP(3) WITHOUT TIME ZONE` |
| `timestamp`   | `INTEGER` | `BIGINT`        | `BIGINT`                         |

Timestamp storage uses Unix milliseconds representing a UTC instant. Local string inputs use `timezone`; JavaScript `Date` and millisecond integers represent an explicit instant. `datetimeFormat` independently controls output.

To keep drivers from interpreting naive values early:

- PostgreSQL configures text decoding for `timestamp` on every execution.
- The MySQL adapter forces `dateStrings`; the same-named setting in `connection` is overridden. If a `Date` output is received, the adapter refuses to decode rather than guessing a conversion.

For existing data, generate migration SQL and convert historical values using their original timezone. Explicit datetime foreign keys use the target key's storage configuration; implicit foreign keys inherit it.

### now()

On write, the ORM generates `now()` in the client timezone and binds it explicitly as a parameter, rather than relying on the database's default time.

::: warning Database-generated times
The following sources of time are decided by the database session or host timezone and are not controlled by `timezone`:

- Calling `NOW()` or `CURRENT_TIMESTAMP` directly
- Database defaults when a native `INSERT` omits the field
- Database defaults used to backfill during migrations

To obtain the same business time, pass a `Date` parameter or an already formatted string explicitly. MySQL and PostgreSQL adapter sessions are pinned to UTC; SQLite has no server session timezone.
:::

## Changing the Timezone and Migrating Old Data

- Changing `timezone` does not rewrite stored data, but affects input conversion and decoding: UTC output for local storage, and local output for timestamp storage.
- Older UTC / ISO strings or PostgreSQL `TIMESTAMPTZ` data cannot be carried over directly; migrate them according to their original semantics.
- Date results are strings, not `Date` objects. If migrating code that used `Date`, adjust calls such as `toISOString()` and `getTime()` to the selected format.

## Next Steps

- [Models and Fields](../schema/overview.md#field-types): the `datetime` and `timestamp` field types
- [Type Mapping](../databases/overview.md#type-mapping): the physical column type per database
- [Client Overview](./overview.md#options): the `timezone` and `datetimeFormat` options
