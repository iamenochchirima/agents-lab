# Temporal baseline harness variant

Status: first local baseline is runnable and covered by unit and local integration tests.

The baseline is the first narrow, comparable agent workload built on Temporal.
It is not intended to represent the complete professional agent planned for the
Lab. Its purpose is to make the server/worker/workflow boundary concrete
before skills, integrations, or multi-agent behaviour are introduced.

## Baseline scope

The first run is a prompt completion with a server-owned multi-turn context session:

1. The server validates a Temporal/baseline request and writes its
   immutable manifest.
2. A Temporal workflow admits the run and records its durable execution phase.
3. A context Activity loads the canonical transcript, measures the selected model
   window, and compacts older history before it becomes unsafe when necessary.
4. The workflow requests one model response through an Activity using the immutable
   context snapshot.
5. The workflow returns a terminal summary and can perform one changed-input context
   recovery after a provider-reported overflow.
6. The server reconciles the workflow's ordered event intents and writes
   the normalized Lab evidence.

The session context currently contains the declared instruction and text transcript.
This slice exposes only the shared pure `calculator` tool. It does not include
skills, MCP, OAuth,
plugins, subagents, long-term memory, or external business side effects.

## Ownership

| Concern | Baseline owner |
| --- | --- |
| Workflow state and recovery | Temporal workflow history |
| Canonical transcript and context snapshots | Common context session store |
| Model/network I/O | Model activity, never workflow code |
| Model adapter selection | Baseline model boundary |
| Normalized Lab evidence | Fastify server's evidence store |
| Native Temporal identifiers and diagnostics | Temporal runner/variant telemetry |

The workflow should retain only the inputs, phase, safe references, and ordered
event intents needed for recovery and inspection. It must not write files in
`lab/runs/` directly. The server is the only normalized-evidence writer.

## Failure and retry intent

The baseline is designed to distinguish a failure before a provider request is
sent from an ambiguous failure after dispatch. Only a proven pre-dispatch
failure may be retried automatically. A timeout, connection loss, or lost
acknowledgement after dispatch must not blindly send the same prompt again; it
is recorded as an unknown outcome for this slice. Exactly-once model execution
is not claimed.

The baseline has no external tool side effects yet, so tool idempotency and
approval semantics are deliberately deferred rather than implied.

## Layout

The directories below are reserved for focused responsibilities as the
implementation arrives:

```text
config/       effective baseline configuration
context/      Temporal context Activity and snapshot boundary
durability/   Temporal-specific recovery decisions
execution/    workflow and activity entry points
models/       deterministic and opt-in provider adapters
runtime/      one-turn lifecycle state
sessions/     run/session-facing records and turn identity notes
state/        baseline state projections
telemetry/    native and normalized mapping
tests/        baseline-specific tests
```

The common context implementation lives in `server/src/capabilities/context/`; these
variant directories document only the Temporal boundary. Empty directory READMEs are
structure notes, not evidence that every future capability exists.

## Validation status

The baseline has been validated against a real local Temporal server and worker
for success, pre-dispatch retry, ambiguous failure, timeout, cancellation, and
server reconciliation. The controlled worker restart exercise is
documented in the [development playground](../../../../../../development/playground/temporal-baseline/README.md).
See the [Temporal local-development notes](../../docs/local-development.md)
and the [completed implementation plan](../../../../../../development/implementation-plans/completed/lab-server-temporal-baseline.md)
for current evidence and limits.
