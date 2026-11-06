---
description: Local date-time semantics of date fields, the client timezone, and data migration caveats.
---

# Date & Timezone

A `date` field stores a naive local date-time. The ORM converts input using the fixed offset configured on the client, and returns the string as-is on read, with no UTC round-trip conversion.

## Configuring the Timezone

```ts
const db = await createClient({
  adapter,
  timezone: '+08:00',
});
```

`timezone` defaults to `+08:00`, is formatted as `±HH:mm`, and ranges from `-14:00` to `+14:00`. The same fixed offset applies all year, independent of the host timezone.

## Read and Write Formats

Queries return `DateTime` strings in the fixed format `YYYY-MM-DD HH:mm:ss.SSS`.

Writes accept `DateTimeInput`:

| Input                                  | Handling                                         |
| -------------------------------------- | ------------------------------------------------ |
| Local time string                      | Validated and normalized, no timezone conversion |
| JavaScript `Date`                      | Converted to a local time string in the client timezone |
| String with `Z` or an offset           | Rejected; construct a `Date` explicitly first    |

```ts
await db.post.create({
  data: {
    title: 'Local time',
    authorId: 1,
    createdAt: '2026-11-02 15:30:00',
  },
});
```

For example, `new Date('2026-11-02T07:30:00Z')` on a `+08:00` client is stored as `2026-11-02 15:30:00.000`, and queries return that value.

`date` filters, `set` updates, and `Date` parameters in raw SQL all follow the same encoding rules. The ORM validates that dates are legal (including leap years) with millisecond precision; MySQL additionally requires the year to be between 1000 and 9999.

## now()

On write, the ORM generates `now()` in the client timezone and binds it explicitly as a parameter, rather than relying on the database's default time.

::: warning Database-generated times
The following sources of time are decided by the database session or host timezone and are not controlled by `timezone`:

- Calling `NOW()` or `CURRENT_TIMESTAMP` directly
- Database defaults when a native `INSERT` omits the field
- Database defaults used to backfill during migrations

To obtain the same business time, pass a `Date` parameter or an already formatted string explicitly. Adapter connection sessions are pinned to UTC.
:::

## Storage

| Database          | Physical type                      |
| ----------------- | ---------------------------------- |
| MySQL / MariaDB   | `DATETIME(3)`                      |
| PostgreSQL        | `TIMESTAMP(3) WITHOUT TIME ZONE`   |
| SQLite            | `TEXT`                             |

To keep drivers from interpreting naive values early:

- PostgreSQL configures text decoding for `timestamp` on every execution.
- The MySQL adapter forces `dateStrings`; the same-named setting in `connection` is overridden. If a `Date` output is received, the adapter refuses to decode rather than guessing a conversion.

## Changing the Timezone and Migrating Old Data

- Changing the client timezone neither modifies nor recomputes existing records.
- Older UTC / ISO strings or PostgreSQL `TIMESTAMPTZ` data cannot be carried over directly; migrate them according to their original semantics.
- After regenerating the client, the return type of date fields changes from `Date` to `string`, so existing `toISOString`, `getTime`, and similar calls need adjusting.
