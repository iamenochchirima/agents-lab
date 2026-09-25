# Output and actions module

This module prepares an agent result or requested action and delivers it through a host-provided sink. Preparation and delivery are separate so the caller can inspect and check a proposal before a side effect occurs.

## Interface

`prepare` receives an action ID, kind, JSON payload, and run scope. It returns a `proposed` record with a summary and optional evidence. `deliver` receives that proposal and an optional idempotency key. It returns `committed`, `rejected`, or `uncertain`. The module does not run a Safety policy; the host must evaluate the proposal before calling `deliver`.

```ts
const proposal = await output.prepare({ scope, action }, signal);
const receipt = await output.deliver({ scope, proposal, idempotencyKey: action.actionId }, signal);
```

## Lifecycle and side effects

`prepare` must not perform the requested external action. `deliver` may create an external side effect. `committed` means the sink acknowledged it; `rejected` means it did not commit; `uncertain` means the acknowledgement does not establish the outcome. The caller must reconcile an uncertain receipt before retrying. The module passes the idempotency key to its sink when supported, but the interface does not promise exactly-once delivery.

Cancellation before delivery begins is safe to retry. Cancellation after the sink may have accepted the action must produce an uncertain outcome, not a claim of rollback. The module owns no durable state; any receipt persistence belongs to the host or sink and must be named in its implementation docs.

## Configuration and checks

The default payload limit is 65536 bytes and an idempotency key is required. `parseOutputActionsConfig` rejects invalid types, unknown fields, and payload bounds outside 1–1048576 bytes.

```sh
pnpm --filter @agent-harness-lab/agent-protocol build
pnpm --filter @agent-harness-lab/module-output-actions build
pnpm --filter @agent-harness-lab/module-output-actions typecheck
pnpm --filter @agent-harness-lab/module-output-actions test
```

Build the shared protocol package first in a fresh checkout because the emitted declarations are a package dependency.

This package defines the contract and config parser only. A later implementation must test proposal validation, approval handoff, sink rejection, duplicate keys, and lost acknowledgements.
