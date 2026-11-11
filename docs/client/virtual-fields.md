---
description: Typed virtual fields computed on the client.
---

# Virtual Fields

A virtual field is computed synchronously over query results and is never written to the database. Both the field value and its return type are inferred automatically. Virtual fields are attached with `$extend`; connection and runtime options remain on `createClient`.

## Definition

```ts
import { createClient } from "./generated/client.ts";

const base = await createClient({ adapter });
const db = base.$extend({
  virtuals: {
    user: {
      displayName: {
        needs: { name: true, email: true },
        compute: (row) => row.name ?? row.email,
      },
    },
  },
});
```

| Property  | Description                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `needs`   | The physical scalar fields the computation depends on                                                                |
| `compute` | A synchronous pure function; typed with the full row, but at runtime only the fields declared in `needs` are exposed |

## Sharing Across Models

When several models need the same virtual field, lift the definition into a constant and spread it into each model; model-specific fields go inline after the spread:

```ts
const shared = {
  emailDomain: {
    needs: { email: true },
    compute: (row: Readonly<{ email: string }>) => row.email.split("@")[1] ?? "",
  },
} as const;

const db = (await createClient({ adapter })).$extend({
  virtuals: {
    user: {
      ...shared,
      displayName: {
        needs: { name: true, email: true },
        compute: (row) => row.name ?? row.email,
      },
    },
    account: shared,
  },
});
```

- The shared constant maps field names to definitions and must be declared `as const`; otherwise the `true` in `needs` widens to `boolean` and the assignment fails.
- Since the shared constant is a named constant, its `compute` argument must be annotated with the common subset of fields, and those fields must exist on every model that uses it.
- Inline model-specific fields need no annotation; their `compute` argument is automatically the full row of the owning model.
- The fields declared in `needs` are validated per model when the client is extended; a missing field is an error.

The full semantics of extending — layering, lifecycle sharing, and chaining — are described in [Extensions](./extensions.md).

## Reading

The default full record includes virtual fields; you can also pick them with `select` or drop them with `omit`:

```ts
const rows = await db.user.findMany({ select: { displayName: true } });
const others = await db.user.findMany({ omit: { displayName: true } });
```

Dependency fields load automatically; `select` determines the result fields.

## Rules

- `compute` must be synchronous; returning a Promise is rejected.
- Reading an undeclared dependency raises an error.
- Dependencies may only be physical scalar fields. Depending on another virtual field, circular dependencies, and name conflicts are all rejected when the client is extended.
- Virtual fields appear only in query results and are never stored in the database.

## Next Steps

- [Extensions](./extensions.md): layering several virtual field definitions
- [Queries](./queries.md): selecting and omitting fields in a query
