# Output and actions module

This module prepares an agent result or requested action and hands it to a
host-provided sink. Preparation and delivery are separate so the caller can
inspect and check a proposal before a side effect occurs.

## Initial implementation

`createTextOutputActions` creates `text-output-actions@0.1.0`. It supports one
action kind, `text-response`, with a JSON payload shaped as
`{ "text": "..." }`. `prepare` validates the payload and returns a frozen
proposal with its serialized UTF-8 byte count. It does not call the sink.
`deliver` validates the proposal again, then passes it, the run scope, and the
idempotency key to the injected `OutputActionSink`.

```ts
const output = createTextOutputActions({}, { sink: hostResponseSink });
const proposal = await output.prepare({ scope, action: {
  actionId: "response-1",
  kind: "text-response",
  payload: { text: "The task is complete." },
} }, signal);

// The host checks Safety or approval here before causing a side effect.
const receipt = await output.deliver({
  scope,
  proposal,
  idempotencyKey: proposal.actionId,
}, signal);
```

The example assumes `hostResponseSink`, `scope`, and `signal` come from the host.
This package does not provide a chat or network sink.

## Lifecycle and side effects

`prepare` has no external effects. `deliver` may create one. `committed` means
the sink acknowledged delivery, `rejected` means the sink reports that it did
not commit, and `uncertain` means the caller cannot establish the outcome. The
caller must reconcile an uncertain receipt before deciding whether to retry.

The module does not run a Safety policy. The host must evaluate the proposal
before calling `deliver`. The sink owns destination behavior and duplicate-key
handling. This implementation passes the idempotency key through; it does not
claim exactly-once delivery.

Cancellation before delivery begins throws `OUTPUT_ACTION_CANCELLED` and is safe
to retry. Cancellation after the sink call begins returns an `uncertain` receipt,
because the sink may have accepted the action. A sink exception or invalid receipt
after dispatch also returns `uncertain`. The module does not retry delivery. The
module owns no durable state; receipt persistence belongs to the host or sink.

## Configuration and checks

The default serialized-payload limit is 65536 UTF-8 bytes and an idempotency key
is required. `parseOutputActionsConfig` rejects invalid types, unknown fields,
and payload bounds outside 1–1048576 bytes. Invalid requests and proposals throw
`OutputActionsError`; an oversized payload throws `OUTPUT_ACTION_TOO_LARGE`.

```sh
pnpm --filter @agent-harness-lab/agent-protocol build
pnpm --filter @agent-harness-lab/module-output-actions build
pnpm --filter @agent-harness-lab/module-output-actions typecheck
pnpm --filter @agent-harness-lab/module-output-actions test
```

Build the shared protocol package first in a fresh checkout because the emitted
declarations are a package dependency. Tests use a local sink fixture. They do
not connect the package to the Studio chat endpoint or add an approval workflow.
Document the sink's idempotency and receipt persistence where the host supplies
it.
