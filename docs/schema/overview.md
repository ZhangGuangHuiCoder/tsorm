---
description: Field types, defaults, field attributes, and reserved names in schema.orm.
---

# Models and Fields

`schema.orm` describes models with TypeScript-flavored syntax. The generator turns it into client types and table DDL.

## Model Basics

Every model must have a primary key: use `@id` for a single-field key and `@@id` for a composite key.

```ts
model User {
  id: int @id @auto
  email: string @unique
  name?: string
  enabled: boolean = true
  createdAt: datetime = now()
}
```

The full form of a field is `name[?]: type [= default] [attributes...]`, with attributes written after the default value:

```ts
model Token {
  id: string(36) = uuid() @id
  value: string
}
```

## Field Types

| Type                   | Description                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `int`                  | Integer within the JavaScript safe-integer range, read back as `number`                                                      |
| `bigint`               | 64-bit integer, read as `string`; accepts an integer string, `bigint`, or safe integer                                       |
| `number`               | Finite floating-point number                                                                                                 |
| `decimal(p, s)`        | Decimal value, read as a string; accepts strings or numbers. `p` ranges from 1 to 65, `s` from 0 to 30 and cannot exceed `p` |
| `string` / `string(n)` | String, `n` ranges from 1 to 16383 counted by Unicode code points; 191 when the length is omitted                            |
| `text`                 | Unbounded string; cannot be a key or indexed                                                                                 |
| `boolean`              | Boolean value                                                                                                                |
| `datetime`             | Local date-time storage; output follows `datetimeFormat`, see [Date & Timezone](../client/datetime.md)                       |
| `timestamp`            | Unix milliseconds in an integer column; output follows `datetimeFormat`                                                      |
| `"a" \| "b"`           | String literal union, enforced by a database `CHECK` constraint                                                              |
| `json<T>`              | Typed JSON, see [Typed JSON](./json.md)                                                                                      |
| `bytes`                | Binary data, read and written as `Uint8Array`                                                                                |

A `?` after the field name makes it nullable; without an explicit default it defaults to `NULL`. Physical type mappings are listed in [Type Mapping](../databases/overview.md#type-mapping).

Values exceeding an explicitly declared decimal precision or scale raise `VALIDATION`. Without `(p, s)`, the ORM does not impose a model precision/scale, but database limits still apply: MySQL uses `DECIMAL(65,30)`. String inputs avoid JavaScript floating-point conversion, not database precision limits. SQLite uses NUMERIC affinity and may store fractional values as floating point (about 15 significant digits), so exact decimal arithmetic is not guaranteed.

Both `int` and `bigint` map to `BIGINT` in MySQL and PostgreSQL; they differ only in the JavaScript type, so switching between them requires no migration.

### Why `string` Defaults to 191

For compatibility with MySQL's older row formats: the index limit is 767 bytes, and utf8mb4 uses up to 4 bytes per character. Rounding 767÷4 down gives 191. Use `string(n)` for longer fields.

## Defaults

| Form        | Description                                              |
| ----------- | -------------------------------------------------------- |
| `= literal` | Fixed default value, must match the field type           |
| `= now()`   | Current time; available for `datetime` and `timestamp`   |
| `= uuid()`  | Generates a UUID, only for strings of length at least 36 |

Date fields (`datetime` and `timestamp`) accept `now()`; nullable date fields also accept `null`. JSON fields only accept `null` as a default.

## Field Attributes

| Attribute        | Description                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@id`            | Single-field primary key                                                                                                               |
| `@auto`          | Auto-generated ID, only for `int @id` or `bigint @id` without a default value                                                          |
| `@unique`        | Single-field unique constraint                                                                                                         |
| `@updatedAt`     | Set to the current time on create and every update, only for `datetime` or `timestamp` without an explicit default value               |
| `@map("name")`   | Column name in the database, see [Name Mapping](./attributes.md#name-mapping)                                                          |
| `@via(field)`    | Declares the field on the other model that the back relation points to                                                                 |
| `@relation(...)` | Binds one explicit foreign key field and configures referential actions, see [Referential Actions](./relations/referential-actions.md) |

`@updatedAt` fields may be omitted on create. On any ORM update (`updateMany`, `upsert`, and nested updates included), the field is set to the current time whenever a field is written; an explicit value always wins. Soft delete and restore leave it unchanged.

## Reserved Names

Models and fields cannot use reserved names, including `AND`, `OR`, `NOT`, `_count`, `constructor`, `prototype`, and `__proto__`, nor can they start with `$`. Field names also cannot start with `__orm_`.

Validate a schema file with [`tsorm validate`](../reference/cli/overview.md#commands); syntax errors include line and column numbers.

## Next Steps

- [Relations](./relations/overview.md): one-to-many, one-to-one, many-to-many, and polymorphic relations
- [Model Attributes](./attributes.md): composite keys, indexes, name mapping, and soft delete
