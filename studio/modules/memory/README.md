# Memory module

Memory owns records that may survive across turns within a session. It exposes
`recall` to return provenance-bearing candidates and `observe` to accept new
observations with a write receipt. Context decides whether and how recalled records
become model-visible. Memory does not receive Context messages or format prompts.

`createInMemorySession` is a deterministic reference implementation. It ranks
records by shared ASCII letter/number query terms longer than two characters,
applies a stable tie-break, and treats repeated
observation IDs as skips. It stores state only in the returned object: records
survive turns using that object but are lost when it is closed or the process exits.
It makes no durability or cross-process recovery claim. The current implementation
validates a complete write batch before mutation; cancellation before commit aborts
the write, while the synchronous commit section is atomic within this process. A
future persistent implementation must define what an interrupted write receipt
means if the outcome cannot be known.

Use `parseMemoryConfig` before construction. The in-memory implementation also
checks session ownership on each call, rejects oversized records, and returns an
`AbortError` when cancellation is observed before work or before returning recall
results. Its operation scope deliberately requires both the owner ID and the
protocol's optional session ID; both must match the scope used to create the session.
Closing a session is idempotent and clears its in-memory state.

| Setting | Default | Accepted range |
| --- | ---: | ---: |
| `maxRecords` | 500 | 1–100,000 |
| `maxContentBytes` | 16,384 | 1–10,000,000 |
| `maxRecallResults` | 20 | 1–10,000 |

```ts
import { createSessionId } from "@agent-harness-lab/agent-protocol";
import { createInMemorySession, parseMemoryConfig } from "@agent-harness-lab/module-memory";

const memory = createInMemorySession(
  { ownerId: "demo", sessionId: createSessionId("session-1") },
  parseMemoryConfig(),
);
```

```sh
pnpm --filter @agent-harness-lab/module-memory typecheck
pnpm --filter @agent-harness-lab/module-memory test
```
