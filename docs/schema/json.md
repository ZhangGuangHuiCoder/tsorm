---
description: Declare the structure of JSON fields, validate it on read and write, and distinguish SQL NULL from JSON null.
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

Both writes and reads are validated:

- Unknown object properties and wrong types are rejected.
- Non-finite numbers, `Date`, `BigInt`, and other non-JSON data are rejected.
- Sparse arrays, accessors, and custom serialization are rejected, and getters are never invoked.
- Nesting is at most 64 levels.

Bad input reports the field path (`VALIDATION`). When a value already stored in the database does not match the structure, `INVALID_DATABASE_VALUE` is raised.

## Distinguishing NULL

```ts
import { DbNull, JsonNull } from "@ofis/tsorm";

await db.account.update({
  where: { id: 1 },
  data: { preferences: { set: DbNull } },
});
```

| Written value      | Meaning             | Requirement                                                              |
| ------------------ | ------------------- | ------------------------------------------------------------------------ |
| `DbNull` or `null` | SQL `NULL`          | The field is nullable                                                    |
| `JsonNull`         | JSON literal `null` | The JSON type itself includes `null`, for example `json<string \| null>` |

On read, both map to JavaScript `null`.

## Storage

| Database        | Physical type | Description                                                                                 |
| --------------- | ------------- | ------------------------------------------------------------------------------------------- |
| SQLite          | `TEXT`        | Validated by a `CHECK` constraint using `json_valid`                                        |
| MySQL / MariaDB | `JSON`        | The adapter pins `autoJsonMap: false`; the same-named setting in `connection` is overridden |
| PostgreSQL      | `JSONB`       | Uses query-level text parsing to avoid confusing JSON strings with raw JSON text            |

## Usage Notes

- Write a JSON field as a whole value or with `set`.
- Filter by path, see [Queries](../client/queries.md#json-fields).
- A `type` declaration only shapes the TypeScript type, so changing it generates no migration. Validate and backfill existing data in the migration SQL yourself.

## Next Steps

- [Queries](../client/queries.md#json-fields): filtering JSON values by path
- [Type Mapping](../databases/overview.md#type-mapping): the physical column type per database
