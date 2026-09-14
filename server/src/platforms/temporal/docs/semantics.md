# Temporal baseline semantics

This page records the behaviour that the first slice promises. It is more
specific than a generic description of Temporal so tests and future variants
have a clear comparison point.

## Durable state and Lab evidence

Temporal owns workflow history and the workflow's small state: input values,
execution phase, attempt number, ordered event intents, safe output, usage, and
terminal error. The control plane owns these retained files:

```text
lab/runs/<run-id>/
  config.json
  events.jsonl
  trajectory.json
  metrics.json
  result.json
  native/temporal.json
  logs/
  artifacts/
```

The workflow does not open, append, or rename a file in `lab/runs/`. The
control plane projects workflow state after start and during every status read.
Writing the same event or terminal record again is safe when its content is
identical. Different content for an existing identity is an evidence conflict.

## Retry classification

The model boundary returns whether a request was sent:

| Outcome | Automatic retry in this slice | Evidence |
| --- | --- | --- |
| Proven pre-dispatch failure | Yes, up to the manifest limit, with exponential backoff | `ModelFailed`, `ModelRetryScheduled`, next `ModelRequested` |
| Provider-declared HTTP or response failure | No | `ModelFailed`, `RunFailed`, `failureKind: provider` |
| Timeout, network loss, or lost acknowledgement after dispatch | No | `ModelFailed`, `RunFailed`, `failureKind: outcome_unknown` or `timeout` |

The workflow uses a stable attempt ID of `<run-id>:model:<attempt>`. This is a
diagnostic identity, not an exactly-once guarantee. Replaying a model request is
not safe unless a later provider integration proves an idempotency mechanism.

## Cancellation

The API sends a durable `baselineCancel` signal to the workflow. The workflow
marks cancellation requested and cancels the current activity scope. The model
activity receives the SDK cancellation signal and the deterministic delayed
fixtures respond to it. Once the workflow records `RunCancelled`, later status
reads cannot turn it into a successful result.

Cancellation is asynchronous. The cancel endpoint can return a still-running
view while the signal is being processed. Repeating the request after a terminal
result returns that result without sending another cancellation.

## Process restarts

| Failure | Expected behaviour |
| --- | --- |
| Browser reload or API poll interruption | The next `GET /api/runs/:runId` reads server evidence and reconciles Temporal state. |
| Control-plane process restart | The stored manifest and native reference are reused. Event intents and terminal files are projected idempotently. |
| Worker process restart | Temporal keeps workflow history and redelivers work according to Temporal activity semantics. The workflow is not recreated under a new Lab run ID. |
| Temporal service restart with persistent local DB | Workflow history remains available after the service returns. The API may be stale while it is unavailable. |
| Missing manifest or missing Temporal execution | The Lab records `reconciliation_required`; it does not adopt an orphan or fabricate completion. |

The controlled restart exercise uses `fake-pre-dispatch-retry` with a deliberately
long retry backoff. Stop the worker after `ModelRetryScheduled`, while the
workflow is waiting on its durable timer. Restart it on the same task queue. The
same workflow ID should resume, perform the second attempt, and complete.

Stopping the worker during an in-flight model activity is a different experiment.
The activity acknowledgement is then ambiguous, so this baseline records an
`outcome_unknown` failure instead of replaying the model request. That result is
intentional and must not be confused with timer recovery.

## Metrics and unknown values

`metrics.json` counts model requests and attempts and calculates duration when
the workflow supplies valid timestamps. Token counts and cost remain `null` when
the provider does not return them. A missing measurement is not recorded as
zero.

## Deliberate limits

The baseline has one model call, no tool side effects, no streaming response,
no user authentication, no multi-tenant isolation, and no production Temporal
deployment. Those omissions are explicit experimental boundaries, not implied
guarantees about later platforms.
