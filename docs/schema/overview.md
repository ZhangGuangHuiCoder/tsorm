---
description: Field types, defaults, field attributes, and reserved names in schema.orm.
---

# Models and Fields

## Model Basics

Every model must have a primary key: `@id` for a single-field key and `@@id` for a composite key.

```ts
model User {
  id: int @id @auto
  email: string @unique
  name?: string
  enabled: boolean = true
  createdAt: datetime = now()
}
```

A field is `name[?]: type [= default] [attributes...]`, with attributes written after the default:

```ts
model Token {
  id: string(36) = uuid() @id
  value: string
}
```

## Field Types

| Type                   | Description                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `int`                  | Integer within the JavaScript safe-integer range, read back as `number`                                            |
| `bigint`               | 64-bit integer read as `string`; accepts an integer string, `bigint`, or safe integer; same physical type as `int` |
| `number`               | Finite floating-point number                                                                                       |
| `decimal(p, s)`        | Decimal read as a string; accepts strings or numbers. `p` 1–65, `s` 0–30 and not above `p`                         |
| `string` / `string(n)` | String; `n` 1–16383 counted by Unicode code points, 191 when the length is omitted                                 |
| `text`                 | Unbounded string; cannot be a key or indexed                                                                       |
| `boolean`              | Boolean value                                                                                                      |
| `datetime`             | Date-time; read and written as `Date`, see [Date & Timezone](../client/datetime.md)                                |
| `timestamp`            | Unix milliseconds in an integer column; read and written as `Date`                                                 |
| `"a" \| "b"`           | String literal union, enforced by a database `CHECK` constraint                                                    |
| `json<T>`              | Typed JSON, see [Typed JSON](./json.md)                                                                            |
| `bytes`                | Binary data, read and written as `Uint8Array`                                                                      |

A `?` after the field name makes it nullable; without an explicit default it defaults to `NULL`. Physical type mappings are listed in [Type Mapping](../databases/overview.md#type-mapping). Values beyond a declared decimal precision or scale raise `VALIDATION`; without `(p, s)` only database limits apply (MySQL `DECIMAL(65,30)`, SQLite NUMERIC affinity is approximate).

### Why `string` Defaults to 191

MySQL's older row formats cap indexes at 767 bytes and utf8mb4 uses 4 bytes per character, giving 767÷4 = 191. Use `string(n)` for longer fields.

## Defaults

| Form        | Description                                              |
| ----------- | -------------------------------------------------------- |
| `= literal` | Fixed default value, must match the field type           |
| `= now()`   | Current time; for `datetime` and `timestamp`             |
| `= uuid()`  | Generates a UUID, only for strings of length at least 36 |

## Field Attributes

| Attribute        | Description                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@id`            | Single-field primary key                                                                                                               |
| `@auto`          | Auto-generated ID, only for `int @id` or `bigint @id` without a default value                                                          |
| `@unique`        | Single-field unique constraint                                                                                                         |
| `@updatedAt`     | Set to the current time on create and every update; only for `datetime`/`timestamp` without a default, `@id` or `@unique`              |
| `@map("name")`   | Column name in the database, see [Name Mapping](./attributes.md#name-mapping)                                                          |
| `@via(field)`    | Declares the field on the other model that the back relation points to                                                                 |
| `@relation(...)` | Binds one explicit foreign key field and configures referential actions, see [Referential Actions](./relations/referential-actions.md) |

`@updatedAt` may be omitted on create. Any ORM update that writes a field refreshes it; an explicit value wins, and soft delete or restore leaves it unchanged.

## Table Prefix

A top-level `prefix` adds the same prefix to every physical table name; model names and the client API stay the same:

```ts
prefix "app_"

model User {
  id: int @id @auto
}
```

- The table above is `app_User`; `@@map("users")` becomes `app_users`, and junction tables, index, foreign key, and migration history (`<prefix>_tsorm_migrations`) names get the prefix too.
- Letters, digits and underscores only, one `prefix` per file; `ignore` patterns match the prefixed names. Adding or changing a prefix on an existing database shows up as dropping the old tables and creating new ones, so write a rename migration by hand.

## Ignoring Tables

Declare the tables this schema does not manage with a top-level `ignore`; migration commands skip them:

```ts
ignore ["legacy_*", "misc"]

model User {
  id: int @id @auto
}
```

- Entries are physical table names: `*` matches any run of characters, everything else matches literally, ignoring case; several `ignore` statements combine. A model table, an `@@map` name or a junction table must not match, or validation fails.
- Ignored tables take no part in drift detection, `diff` or `push`, and `--reset` drops only this schema's tables. See [Ignored Tables](../databases/migrations.md#ignored-tables).

## Reserved Names

Models and fields cannot use reserved names — `AND`, `OR`, `NOT`, `_count`, `constructor`, `prototype`, `__proto__` — nor start with `$` (fields also not `__orm_`). Validate a schema file with [`tsorm validate`](../reference/cli/overview.md#commands); syntax errors include line and column numbers.

## Next Steps

- [Relations](./relations/overview.md): one-to-many, one-to-one, many-to-many, and polymorphic relations
- [Model Attributes](./attributes.md): composite keys, indexes, name mapping, and soft delete
