---
description: Find documentation by task and understand where each topic is maintained.
---

# Documentation Map

Start with [Getting Started](./getting-started.md), then choose the task you need.

| Task                    | Reading                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Define data             | [Models and Fields](../schema/overview.md), [Model Attributes](../schema/attributes.md), [Relations](../schema/relations/overview.md)        |
| Read and summarize      | [Queries](../client/queries.md), [Aggregations](../client/aggregations.md)                                                                   |
| Write data              | [Create](../client/create.md), [Update](../client/update.md), [Delete](../client/delete.md), [Relation Writes](../client/relation-writes.md) |
| Coordinate operations   | [Transactions](../client/transactions.md), [Raw SQL](../client/raw-sql.md)                                                                   |
| Connect and deploy      | [Database Capabilities](../databases/overview.md), [Adapters](../databases/adapters/overview.md), [Migrations](../databases/migrations.md)   |
| Look up an API or error | [Client API](../reference/client-api.md), [CLI](../reference/cli/overview.md), [Error Codes](../reference/errors.md)                         |
| Work on the repository  | [Development & Validation](./development.md), [Full Example](./examples.md), [VS Code Extension](./vscode.md)                                |

## Documentation Categories

- **Guide**: setup, complete examples, and contributor procedures.
- **Schema**: declarations in `schema.orm`, including fields, constraints, relations, typed JSON, and soft delete.
- **Client**: query and write behavior, transactions, and runtime configuration.
- **Databases**: physical mappings, adapter configuration, and migration workflows.
- **Reference**: API lookup and per-command options. Migration workflows link here for parameter details.

## Capability Map

Topics live with the module that declares or configures them:

| Topic                                                     | Entry point                                            |
| --------------------------------------------------------- | ------------------------------------------------------ |
| [Typed JSON](../schema/json.md)                           | `json<T>`                                              |
| [Soft Delete](../schema/soft-delete.md)                   | `@@softDelete`                                         |
| [Date & Timezone](../client/datetime.md)                  | `datetime` / `timestamp`, `timezone`, `datetimeFormat` |
| [Extensions and Field Exclusion](../client/extensions.md) | `$extend({ virtuals, omit })`                          |
| [Virtual Fields](../client/virtual-fields.md)             | `$extend({ virtuals })`                                |
| [Event Logging](../client/logging.md)                     | `logger`                                               |

## Next Steps

- [Getting Started](./getting-started.md): run your first query
- [Introduction](./introduction.md): project scope and supported versions
