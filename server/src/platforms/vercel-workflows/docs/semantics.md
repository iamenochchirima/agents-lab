# Execution semantics

The baseline has two durable boundaries:

1. The Lab admission ledger writes `pending` before calling `workflow.start()`.
2. The Workflow World persists the native run and delivers the generated flow.

When the native run ID is returned, the ledger changes to `accepted`. A repeated
request with the same Lab run ID and request hash returns the same native run. A
different request using that Lab run ID is rejected. If the process stops after the
pending write but before acceptance is recorded, later requests remain
`submissionOutcome: "unknown"`; the runner reports a `reconciliation_required`
result instead of creating a duplicate run or inventing a terminal failure.

The workflow function is deterministic. It may select the durable sleep branch and
then calls `executeModelStep`. Network I/O, time, provider credentials, and step
attempt metadata are kept inside the step. Workflow's native step retry policy may
repeat an OpenRouter request after a retryable provider or transport failure. The
baseline therefore provides at-least-once step execution and does not claim
exactly-once external model calls.

Cancellation is submitted to the native `Run.cancel()` API. A run already in a
terminal state is reported as `alreadyTerminal`. A failed run receives a normalized
failure record without exposing the provider response body.

The local World is started after the HTTP flow route is listening, so persisted
active runs can be delivered again after a service restart. The admission ledger
is loaded before that recovery pass. A reservation left in `pending` is not
replayed automatically because the native acceptance outcome is unknown.

The local World is a reproducible development backend, not Vercel's managed hosted
World. Hosted deployment, Vercel deployment identity, managed retention, and hosted
observability still need a separate hosted profile.
