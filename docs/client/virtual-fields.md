---
description: Typed virtual fields computed on the client.
---

# Virtual Fields

A virtual field is computed synchronously over query results and is never written to the database. Both the field value and its return type are inferred automatically.

## Definition

```ts
import { virtualField } from '@ofis/tsorm';
import { createClient, type AccountRow } from './generated/client.ts';

const define = virtualField<AccountRow>();

const db = await createClient({
  adapter,
  virtuals: {
    account: {
      displayName: define({
        needs: { name: true, email: true },
        compute: (row) => row.name ?? row.email,
      }),
    },
  },
});
```

| Property  | Description                                      |
| --------- | ------------------------------------------------ |
| `needs`   | The physical scalar fields the computation depends on |
| `compute` | A synchronous pure function whose argument contains only the declared dependencies |

## Reading

The default full record includes virtual fields; you can also pick them with `select` or drop them with `omit`:

```ts
const rows = await db.account.findMany({ select: { displayName: true } });
const others = await db.account.findMany({ omit: { displayName: true } });
```

Dependency fields are loaded automatically but do not appear in the `select` result.

## Rules

- `compute` must be synchronous; returning a Promise is rejected.
- Reading an undeclared dependency raises an error.
- Dependencies may only be physical scalar fields. Depending on another virtual field, circular dependencies, and name conflicts are all rejected when the client is created.
- Virtual fields appear only in query results and are never stored in the database.
