# Temporal baseline harness variant

Status: first local baseline is runnable and covered by unit and local integration tests.

The baseline is the first narrow, comparable agent workload built on Temporal.
It is not intended to represent the complete professional agent planned for the
Lab. Its purpose is to make the control-plane/worker/workflow boundary concrete
before tools, skills, integrations, or multi-agent behaviour are introduced.

## Baseline scope

The first run is a single-turn prompt completion:

1. The control plane validates a Temporal/baseline request and writes its
   immutable manifest.
2. A Temporal workflow admits the run and records its durable execution phase.
3. The workflow requests one model response through an activity.
4. The workflow returns a terminal summary.
5. The control plane reconciles the workflow's ordered event intents and writes
   the normalized Lab evidence.

The initial context is limited to the declared initial instruction and the user
prompt. This variant does not yet include tool calls, skills, MCP, OAuth,
plugins, subagents, long-term memory, or external business side effects.

## Ownership

| Concern | Baseline owner |
| --- | --- |
| Workflow state and recovery | Temporal workflow history |
| Model/network I/O | Model activity, never workflow code |
| Model adapter selection | Baseline model boundary |
| Normalized Lab evidence | Fastify control plane's evidence store |
| Native Temporal identifiers and diagnostics | Temporal runner/variant telemetry |

The workflow should retain only the inputs, phase, safe references, and ordered
event intents needed for recovery and inspection. It must not write files in
`lab/runs/` directly. The control plane is the only normalized-evidence writer.

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
context/      initial instruction and prompt construction
durability/   Temporal-specific recovery decisions
execution/    workflow and activity entry points
models/       deterministic and opt-in provider adapters
runtime/      one-turn lifecycle state
sessions/     run/session-facing records when needed
state/        baseline state projections
telemetry/    native and normalized mapping
tests/        baseline-specific tests
```

Empty directory READMEs are structure notes, not evidence that the corresponding
runtime capability exists.

## Validation status

The baseline has been validated against a real local Temporal server and worker
for success, pre-dispatch retry, ambiguous failure, timeout, cancellation, and
control-plane reconciliation. The controlled worker restart exercise is
documented in the [development playground](../../../../../../development/playground/temporal-baseline/README.md).
See the [Temporal local-development notes](../../docs/local-development.md)
and the [active implementation plan](../../../../../../development/implementation-plans/active/lab-server-temporal-baseline.md)
for current evidence and limits.
