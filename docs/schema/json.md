---
description: Declare the structure of JSON fields and validate it on read and write.
---

# Typed JSON

A `json<T>` field provides a compile-time type and validates the structure on read and write.

## Declaration

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

Supported structures include objects, optional fields, arrays, literal unions, `null`, `Record<string, T>`, and type references.

## Validation

- Unknown object properties and wrong types are rejected.
- Non-finite numbers, `Date`, `BigInt`, sparse arrays, accessors, and custom serialization are rejected; getters are never invoked, and nesting is at most 64 levels.

Bad input reports the field path (`VALIDATION`). A stored value that does not match the structure raises `INVALID_DATABASE_VALUE`.

## Distinguishing NULL

```ts
import { DbNull, JsonNull } from "@ofis/tsorm";

await db.account.update({
  where: { id: 1 },
  data: { preferences: { set: DbNull } },
});
```

| Written value      | Meaning             | Requirement                                                       |
| ------------------ | ------------------- | ----------------------------------------------------------------- |
| `DbNull` or `null` | SQL `NULL`          | The field is nullable                                             |
| `JsonNull`         | JSON literal `null` | The JSON type includes `null`, for example `json<string \| null>` |

On read, both map to JavaScript `null`.

## Storage

| Database        | Physical type | Description                                                                 |
| --------------- | ------------- | --------------------------------------------------------------------------- |
| SQLite          | `TEXT`        | Validated by a `CHECK` constraint using `json_valid`                        |
| MySQL / MariaDB | `JSON`        | The adapter pins `autoJsonMap: false`; a `connection` setting is overridden |
| PostgreSQL      | `JSONB`       | Query-level text parsing avoids confusing JSON strings with raw JSON text   |

## Usage Notes

- Filter by path, see [Queries](../client/queries.md#json-fields).
- A `type` declaration only shapes the TypeScript type, so changing it generates no migration; validate and backfill existing data in the migration SQL yourself.

## Next Steps

- [Queries](../client/queries.md#json-fields): filtering JSON values by path
- [Type Mapping](../databases/overview.md#type-mapping): the physical column type per database
