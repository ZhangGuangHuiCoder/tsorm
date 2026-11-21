---
description: Receive SQL, transaction, and client lifecycle events through the logger callback.
---

# Event Logging

With a `logger` callback configured, the ORM emits structured events; printing, storage, filtering, and log levels are the caller's job.

## Configuration

```ts
import { createClient } from "./generated/client.ts";
import type { Logger } from "@ofis/tsorm";

const logger: Logger = (event) => {
  if (event.type === "query") {
    console.log(event.sql, event.durationMs, event.status);
  }
};

const db = createClient({ connection: "file::memory:", logger });
```

## Event Types

Every event includes `database`, `timestamp`, and `durationMs`, plus `type` and `status` (`success` or `error`). On failure, `error` is the ORM-mapped error.

| `type`        | When fired                            | Other fields                            |
| ------------- | ------------------------------------- | --------------------------------------- |
| `query`       | A SQL statement finished              | `sql`, `parameters`, `affectedRows`     |
| `transaction` | A transaction operation finished      | `action`: `begin`, `commit`, `rollback` |
| `client`      | A client lifecycle operation finished | `action`: `connect`, `close`            |

`connect` fires when the first operation opens the connection, not when `createClient` returns; an unused, closed client emits nothing. `query` events include in-transaction relation loading and nested writes, but not adapter-internal setup, version checks, or table creation — those are counted in `connect`.

## Behavior Contract

- Event objects and parameter arrays are read-only.
- `logger` may return `void` or `Promise<void>`; async callbacks run independently.
- A `logger` that throws or returns a rejected Promise never interrupts the database operation; without a `logger`, statements and transaction operations are not wrapped for event reporting.
- Manage the logger queue in application code and flush it before shutdown for reliable persistence.

::: warning Sensitive data
`parameters` may contain business data; mask them in the `logger` before recording.
:::

## Next Steps

- [Client Overview](./overview.md#options): the `logger` option
- [Transactions](./transactions.md): the `transaction` events emitted per operation
