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

The session context currently contains the declared instruction, text transcript, and any
selected versioned skill as untrusted context. The shared profile can expose `calculator`,
the local read fixture, and the approval-gated local write fixture through Temporal
Activities. MCP and OAuth are exercised through their explicit local protocol boundaries;
provider accounts and business integrations are not implied by the fixture.

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
and the [completed implementation plan](../../../../../../development/implementation-plans/platforms/completed/lab-server-temporal-baseline.md)
for current evidence and limits.

## Extensible tool catalogs

Admitted profile runs carry a frozen `toolCatalog` snapshot with full JSON Schema,
source identity, effective limits, execution binding, and failure policy. The
model sees that snapshot rather than a platform-owned list of tool names. Adding
a hosted tool package changes the capability catalog; it does not require adding
a branch to this platform's agent loop. Direct legacy callers without a snapshot
retain the original built-ins.

Hosted tools require the Lab capability host (`AGENTLAB_CAPABILITY_HOST_URL`,
default `http://127.0.0.1:4318`) and its local worker credential
(`AGENTLAB_CAPABILITY_HOST_KEY_FILE`, default `lab/runs/.capability-host.key`).
Only an opaque catalog revision and execution identity cross the runtime
boundary; credentials and host addresses stay outside run manifests and model
context. The host rechecks the admitted run's catalog and approval policy.
Known failures become model feedback only when the frozen descriptor permits
it. Unknown dispatch outcomes stop the turn and are never automatically retried.

Workflow code projects declarations and validates calls without host I/O. The
`executeTool` Activity owns authenticated host dispatch and native cancellation.

### Invocation review

Tools configured with `approvalMode: "invocation"` persist a proposal in a short
`prepareInvocation` Activity before any provider dispatch. The Workflow exposes
`suspended` and its pending request through `baselineSnapshot`, then waits for
`baselineReviewDecision` using a Workflow condition. Review request, revision and
original tool-call identity must match. Approval continues the existing call;
denial becomes correlated tool feedback without dispatch. Cancellation wakes the
wait and settles the existing turn. Human waiting does not hold a tool Activity
or consume a provider deadline.

Workflow history retains the waiting state across worker replacement. This does
not promise recovery of an arbitrary external effect. The host independently
checks the persisted decision immediately before provider dispatch. Tool Activities
send heartbeats while awaiting I/O so the server can deliver cancellation and
longer operations do not trigger the one-second heartbeat deadline.

The isolated actual-worker check is:

```sh
AGENTLAB_RUN_TEMPORAL_TOOL_HEARTBEAT=1 node --test dist/integration-tests/temporal-tool-heartbeat.test.js
```

Run it from `server/` after building, with a reachable local Temporal server. It
starts its own worker/task queue, verifies a 1.5-second MCP read completes, then
cancels a second in-flight read without retrying it.

## Exact-action review and renewal

Proposal persistence runs in a short heartbeating Activity. Human waiting stays
in Workflow state and uses a validated signal; no tool Activity or model call
remains active while waiting. Signals bind request ID, call ID and current revision.
A renewal accepts only the next revision, fetches its proposal in a fresh Activity
and remains suspended. It cannot dispatch an operation or authorize that revision.
Approval/denial must subsequently target the renewed proposal. Cancellation wins
before a renewed or approved source dispatch. Temporal history retains the wait,
renewal and continuation separately from business effects.

Tool events retain effect certainty, presentation validity and original content.
Model tool messages use explicit text/JSON projection and identify unsupported media.

### Context preparation liveness

Context preparation also emits heartbeats while loading context and awaiting a
model-backed compaction summary. It clears its timer when the Activity settles.
The one-second heartbeat deadline describes worker liveness; it is distinct from
the configured model/Activity start-to-close budget. SDK heartbeats can be
[throttled before reaching the server](https://docs.temporal.io/encyclopedia/detecting-activity-failures).
A heartbeat loss after model dispatch retains an unknown outcome and does not
justify retrying the provider call.

The narrow acceptance uses a local controlled summary provider delayed by two
seconds, exceeding the heartbeat deadline without spending model tokens:

```sh
AGENTLAB_TEMPORAL_ENDPOINT=127.0.0.1:17233 \
pnpm --filter @agent-harness-lab/lab-server exec tsx src/evals/compaction.ts \
  --platforms temporal --summary-delay-ms 2000
```

The optional delay accepts 0–10000 ms; default zero preserves the normal X05
fixture. Evidence retains the requested delay, actual receive/respond timestamps,
source hashes and native run IDs. Before the context heartbeat correction,
`compaction-abfa27a9-45a5-43eb-998e-ec9964efcbf1` failed with
`CONTEXT_PREPARATION_FAILED`. Afterward,
`compaction-0f23f5a6-ee2a-4f8c-a94e-a7c9c7185b5b` passed all X05 assertions.
Three affected B03 trials also passed in
`behaviour-9a8be7fa-4ec9-4db7-9b1e-a97512c8b995`.

This is composite affected-path validation after the prior 144-case core batch,
not a claim that the complete core readiness gate ran again at this revision.
The earlier live L07 model heartbeat loss remains unresolved: its model Activity
already emitted heartbeats, so this context correction cannot establish that
incident's cause or overwrite its error.
