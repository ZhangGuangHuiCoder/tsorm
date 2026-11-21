---
description: "Extend clients with $extend: layer virtual fields and omit on top of an existing client while reusing its connection."
---

# Extensions

`$extend` layers `virtuals` and `omit` onto a new client without changing the original; both share the adapter's connections. Connection and runtime options stay on `createClient`.

## Extending

```ts
const db = createClient({ connection: "file:./app.sqlite" });

const extended = db.$extend({
  virtuals: {
    user: {
      displayName: {
        needs: { name: true, email: true },
        compute: (row) => row.name ?? row.email,
      },
    },
  },
  omit: { user: { name: true } },
});

const rows = await extended.user.findMany();
rows[0].displayName; // computed on the client
```

| Option     | Description                                                |
| ---------- | ---------------------------------------------------------- |
| `virtuals` | Virtual fields added on top of the ones already configured |
| `omit`     | Global omit entries layered on top of the current ones     |

The `compute` argument of an inline definition is typed as the full model row, but only `needs` fields are exposed at runtime; see [Virtual Fields](./virtual-fields.md).

`omit` suits fields that should never be returned by default, such as password hashes. It applies to every method that returns records (and nested relations); bring fields back with query-level `select` or `omit: { field: false }`. Filtering, ordering, and unique lookups are unaffected:

```ts
const db = createClient({ connection: "file:./app.sqlite" }).$extend({
  omit: { user: { name: true } },
});
await db.user.findUnique({ where: { id: 1 } }); // without name
await db.user.findUnique({ where: { id: 1 }, omit: { name: false } });
```

## Semantics

- **Layered, not replaced.** New entries are added on top of the current ones; redefining a virtual field name overrides the earlier definition.
- **Immutable.** The original client keeps its own behavior; queries on `db` never return `displayName`.
- **Chainable.** Every `$extend` call returns another client, so modules can layer independently (`shared` is defined in [Virtual Fields](./virtual-fields.md#sharing-across-models)):

```ts
const withShared = db.$extend({ virtuals: { user: shared, post: shared } });
const withProfile = withShared.$extend({ omit: { user: { name: true } } });
```

- **Validated per model.** `needs` is checked against physical scalar fields when `$extend` is called; a missing field or a dependency on another virtual field is an error.

Internal relation checks retain physical keys regardless of global omission.

## Shared Lifecycle

An extended client shares connections, logging, and lifecycle state with the original:

- Queries on the extended client inside a `$transaction` callback join the same transaction and roll back with it, and `$close` on either client closes the connection for all of them.

```ts
await db.$transaction(async () => {
  await extended.user.create({ data: { email: "in-tx@example.com" } });
}); // extended-client writes belong to the transaction
await extended.$close(); // closes db too
```

## Next Steps

- [Virtual Fields](./virtual-fields.md): defining and sharing computed fields
- [Client Overview](./overview.md#options): the options a base client is created with
