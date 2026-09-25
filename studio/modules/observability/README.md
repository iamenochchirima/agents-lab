# Observability module

Observability records ordered normalized events and preserves useful module-specific detail. It reports whether an append is buffered or durable and whether a flush made all pending records durable.

## Interface

`append` receives an `AgentEvent` from the shared protocol and optional module detail with its owner and schema version. Sequence numbers are monotonic within a run. An identical repeated event is reported as `duplicate`; a conflicting duplicate, out-of-order event, invalid record, or full buffer is rejected. The module must not silently reorder or discard events.

`flush` receives a run scope and returns `durable`, `partial`, `failed`, or `unknown`, along with the highest durable sequence and pending count. An `unknown` result means the store may have persisted some data even though its acknowledgement was lost.

```ts
const receipt = await observability.append({ event, moduleDetail }, signal);
const flush = await observability.flush(scope, signal);
```

## Lifecycle and recovery

The host owns the recorder lifecycle and must flush before reporting a run as durably complete. Cancellation may leave events buffered; the host should retry flush when safe and keep the receipt state. Append idempotency uses event ID and sequence. A repeated identical event can be acknowledged as duplicate; reusing either identity with different content is a conflict. A store write with uncertain acknowledgement must not be represented as durable.

The module preserves module detail instead of flattening it into normalized fields. The configured detail-size limit bounds each module payload; implementations should report rejection rather than truncate without evidence. Redaction rules belong to the implementation and host configuration. The interface does not prescribe a storage format or claim that data survives restart.

## Configuration and checks

`parseObservabilityConfig` bounds buffered event count, flush frequency, and module detail bytes. It rejects non-integers, invalid ranges, a flush threshold larger than the buffer, and unknown fields.

```sh
pnpm --filter @agent-harness-lab/agent-protocol build
pnpm --filter @agent-harness-lab/module-observability build
pnpm --filter @agent-harness-lab/module-observability typecheck
pnpm --filter @agent-harness-lab/module-observability test
```

Build the shared protocol package first in a fresh checkout because the emitted declarations are a package dependency.

This package defines the contract and config parser only. A concrete recorder must test ordered writes, duplicate and conflicting events, cancellation, restart behavior, partial flushes, and lost acknowledgements.
