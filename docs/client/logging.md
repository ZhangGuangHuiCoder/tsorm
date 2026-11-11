---
description: Receive SQL, transaction, and client lifecycle events through the logger callback.
---

# Event Logging

With a `logger` callback configured, the ORM emits structured events. Printing, storage, filtering, and log levels are all implemented by the caller.

## Configuration

```ts
import { createClient } from "./generated/client.ts";
import { sqlite } from "@ofis/tsorm/adapters/sqlite";
import type { Logger } from "@ofis/tsorm";

const logger: Logger = (event) => {
  if (event.type === "query") {
    console.log(event.sql, event.durationMs, event.status);
  }
};

const db = await createClient({ adapter: sqlite(), logger });
```

## Event Types

Every event includes `database`, `timestamp`, and `durationMs`, plus `type` and `status` (`success` or `error`). On failure, `error` is the ORM-mapped error.

| `type`        | When fired                            | Other fields                            |
| ------------- | ------------------------------------- | --------------------------------------- |
| `query`       | A SQL statement finished              | `sql`, `parameters`, `affectedRows`     |
| `transaction` | A transaction operation finished      | `action`: `begin`, `commit`, `rollback` |
| `client`      | A client lifecycle operation finished | `action`: `connect`, `close`            |

`query` events include the SQL from in-transaction relation loading and nested writes. Adapter-internal connection setup, version checks, and table-creation statements do not emit separate `query` events; their total time is counted in the `connect` event.

## Behavior Contract

- Event objects and parameter arrays are read-only.
- `logger` may return `void` or `Promise<void>`. Async callbacks run independently.
- A `logger` that throws or returns a rejected Promise never interrupts the database operation.
- Manage the logger queue in application code and flush it before shutdown for reliable persistence.
- With no `logger` configured, the ORM uses the raw adapter directly, with no event-wrapping overhead.

::: warning Sensitive data
`parameters` may contain business data; mask them in the `logger` before recording.
:::

## Next Steps

- [Client Overview](./overview.md#options): the `logger` option
- [Transactions](./transactions.md): the `transaction` events emitted per operation
