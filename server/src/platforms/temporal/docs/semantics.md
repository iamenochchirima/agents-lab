# Temporal baseline semantics

This page records the bounded baseline agent loop and the optional sustained
execution mode. Temporal owns Workflow history, native timers and approval
signals; shared capabilities own tool policy, skills and external receipts.

## Durable state and Lab evidence

Temporal owns workflow history and the workflow's small state: input values,
execution phase, attempt number, ordered event intents, safe output, usage, and
terminal error. The server owns these retained files:

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
server projects workflow state after start and during every status read.
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
| Server process restart | The stored manifest and native reference are reused. Event intents and terminal files are projected idempotently. |
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

The baseline performs multiple model/tool rounds, including connected read and
write actions subject to shared policy and exact-action review. It has no native
agent filesystem, subagent orchestration, streaming response, user authentication,
multi-tenant isolation or production Temporal deployment. These remain explicit
experimental boundaries.

The server-owned `local-mcp-safe` profile adds a read-only `mcp_fixture_lookup`
capability. Temporal performs its discovery and invocation from the Activity boundary;
the workflow records only bounded tool and connection evidence. The selected endpoint
identity, MCP server, tool name/version, and protocol version are immutable run data.
The deterministic local fixture proves the native boundary without claiming a hosted
MCP deployment or exactly-once tool execution.

## Sustained execution

`execution: { mode: "sustained" }` admits an absolute task deadline. The Workflow
checks it before each model round and tool dispatch; native approval waiting uses
`condition` with the remaining task duration. Worker replacement and review renewal
reuse the original deadline and call identity. A wait that reaches that deadline
ends with `RUN_DEADLINE_EXCEEDED` before an effect. Model and summary Activities use
the separate model timeout clipped to the remaining duration; tools retain their
own timeout cap. Missing execution policy preserves the earlier interactive limits.

`TaskProgress` contains the current round and count of observed completed tool
executions, never a synthetic percentage. Before each sustained model request, a
separate Activity projects the entire retained round context, including tool schemas
and loaded skills. If its estimated budget requires compaction, the selected model
summarizes only complete assistant/tool groups. Original instructions, current task,
skills and incomplete groups remain. The Activity result is retained in Workflow
history; private `sessions/<session-id>/native-rounds/` files preserve full source
observations and summary provenance without changing canonical chat history.
Summary dispatches and reported usage contribute to model metrics. Estimates are
labelled as estimates; a safe budget failure prevents the next request.

Sustained mode currently relies on proactive round preparation. A provider overflow
fails honestly rather than rebuilding the original turn and losing current tool
observations. Existing interactive overflow recovery remains unchanged. Native
Continue-As-New is deferred: the 24-round chat cap has not demonstrated history
pressure requiring it. No lost external acknowledgement is automatically replayed.

The opt-in `native-invocation-review` fixture with `AGENTLAB_NATIVE_SUSTAINED=1`
retains a 60-second Temporal approval wait, replaces its owned worker and API host,
then verifies the original approved call produces one independent fixture effect.
Its deadline case verifies zero effects after a three-second native review wait.
These are scripted native-mechanism checks, separate from real-model task quality.
