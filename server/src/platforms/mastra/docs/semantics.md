# Mastra execution semantics

The Lab exposes two Mastra variants. They share model selection, typed tools, and the
Lab-owned context contract, but they do not make the same durability claims.

## What this variant is

The baseline owns one in-process call to Mastra's `Agent.generate()`. The Lab run ID
is the execution identity. Mastra does not provide a durable workflow identity for
this direct call, so the adapter exposes a safe process-scoped reference:

```json
{
  "platform": "mastra",
  "variant": "baseline",
  "executionId": "mastra:<lab-run-id>",
  "native": {
    "mastraVersion": "1.66.0",
    "operation": "agent.generate",
    "processScoped": true,
    "storage": "libsql-file"
  }
}
```

This direct agent uses native approval snapshots; it is not a Mastra workflow
or memory thread. The process-scoped label applies to arbitrary in-flight inference,
while explicit approval waits have persisted continuation state.

## Workflow variant

`mastra/workflow` uses the native Mastra workflow engine with a typed approval step and
model step. The workflow run ID is the Lab run ID in the local profile, while the
opaque execution reference retains the workflow ID and storage profile. A prompt that
starts with `[approval]` suspends before the model step; the browser's approval action
calls `POST /api/runs/:runId/resume` with `{ "approved": true }` and continues the same
native run.

Workflow snapshots are persisted by Mastra's `LibSQLStore` at the configured local
file path. A replacement runner can inspect a suspended or completed native run from
that file. The Lab evidence store still owns normalized evidence and context
projection. A local file does not provide safe concurrent multi-process ownership, so
the profile is explicitly single-process.

## Lifecycle and evidence

When a session turn is supplied, the adapter first prepares the Lab-owned context
snapshot and passes its messages to Mastra. The snapshot ID, token budget, pressure,
and compaction flag are recorded in `ContextPrepared`. If the budget is due, the
selected Mastra model performs the summary call for a real provider profile; fake
profiles use a bounded deterministic extractive summary. The current direct baseline
does not use Mastra Memory or Storage, and it does not adopt in-flight work after a
process restart.

The adapter emits safe event intents in this order for a normal call:

```text
AgentStarted
ContextPreparationStarted
ContextPrepared
ModelRequested
AgentStepCompleted (when Mastra reports a completed step)
ToolCallRequested / ToolCallValidated / ToolExecutionStarted / ToolExecutionCompleted (when a tool is used)
ModelCompleted
AgentCompleted
RunCompleted
```

The common evidence store deduplicates those source sequences and writes the normalized
result, trajectory, and metrics. The adapter never writes `lab/runs/` directly.

## Failure and cancellation

- Configuration and missing OpenRouter credentials fail before dispatch.
- The baseline sets Mastra `maxRetries: 0`; it does not silently repeat a model call.
- A provider rejection after dispatch is recorded as a provider failure when the
  adapter can classify it safely.
- A sent request whose result cannot be confirmed is `outcome_unknown`, not a made-up
  success or retry.
- Cancellation uses the in-memory `AbortController`. If Mastra returns an empty output
  after an abort, the run is recorded as cancelled. If a non-empty response wins the
  cancellation race, the observed response remains the terminal result.
- A timeout after dispatch is recorded as `outcome_unknown` because the provider may
  have received the request.

## Restart and process loss

Active promises and abort controllers live in the runner process. Pending reviews,
native snapshots and terminal projections persist. Replacing the runner loses
arbitrary in-flight execution state. Inspection of a
retained reference then returns not-found to the common server, which projects
`reconciliation_required` without inventing completion.

The baseline persists native tool-approval snapshots and a protected pending-run
projection. A replacement runner can reconstruct a suspended approval and resume
its original tool call. It cannot adopt arbitrary in-flight inference or repair
unknown effects. The separate workflow variant retains its workflow replay scope.

## Deliberately excluded features

- automatic workflow replay or orphan adoption
- Mastra memory (native approval snapshot storage is enabled)
- social channels, plugin marketplace, and provider-specific business integrations
- distributed workflow storage and multi-process ownership
- exactly-once provider-call claims

The shared Lab capability profile can still bind local tools, a read connection, an
approval-gated write fixture, and selected skills to the native Mastra Agent or workflow
boundary. MCP and OAuth are explicit protocol integrations with local fixtures; they are
not implicit connected accounts for this baseline.

The `local-mcp-safe` profile registers `mcp_fixture_lookup` as a native Mastra Agent
tool (and the workflow composition reuses the same binding). The tool raises a
classified error for cancellation, failure, or unknown external outcomes. Mastra may
turn a known provider failure into a tool error that the model can recover from, so the
run can complete while retaining `ToolExecutionFailed`. An unknown external outcome is
different: the native runner rejects a final response after `ToolExecutionUnknown` and
records `outcome_unknown`. The direct Agent variant still has process-scoped lifecycle
state; the workflow variant retains its own native workflow storage semantics.

These exclusions keep the direct-agent comparison honest. Mastra's official docs
describe storage-backed memory and workflow snapshots separately from a bare direct
agent call:

- [Mastra agents](https://mastra.ai/docs/agents/overview)
- [Mastra memory](https://mastra.ai/docs/memory/overview)
- [Mastra storage](https://mastra.ai/docs/storage)
- [Mastra workflows](https://mastra.ai/docs/workflows/overview)
- [Mastra workflow snapshots](https://mastra.ai/en/reference/workflows/snapshots)

## Sustained baseline policy

The preceding direct-agent exclusions describe default short mode. An admitted
`execution` policy (`schemaVersion: 1`, `mode: "sustained"`, absolute `deadlineAt`,
`modelTimeoutMs`) selects pinned native DurableAgent for baseline only. The workflow
variant rejects it. Evidence retains baseline identity and adds
`executionMode: "sustained"`, `nativeEngine: "durable-agentic-loop"`, and
`processScoped: false`.

The Lab checks deadlines before model/tool dispatch and bounds each model request.
Approval waiting releases the active timer and owner; resumption retains the original
absolute deadline. Inspection after a waiting deadline acquires the local lease,
cancels the persisted native workflow through its public `cancel()` API, confirms
`canceled` storage status, and reports `RUN_DEADLINE_EXCEEDED` without dispatching
the proposed action. The common observer can then settle the shared context turn.
Cancellation aborts native work and preserves uncertain outcomes.
Native retries remain disabled. Recovery can repeat interrupted model inference,
so provider requests are not exactly-once.

Retained active runs use native `recover`; decisions use native
`approveToolCallGenerate`/`declineToolCallGenerate`. Storage and ownership stay open
until native trailing checkpoint writes settle. Core 1.66.0 recovery streams stay
open at suspension, so the adapter observes public `onSuspended` and cleans up its
subscription when projecting waiting. A PID/token lease excludes another live owner
on one host; malformed leases or uncertain process liveness are refused. This is
not distributed ownership across hosts sharing a filesystem. Dead-owner reclamation
is serialized by an exclusive lock; a crash during reclamation conservatively
blocks adoption until that lock is inspected and removed by an operator.

External dispatch IDs are persisted before shared tool invocation and retained
through terminal native settlement. An acknowledged result alone does not clear
the barrier because the worker could die before native checkpoint persistence.
This conservatively refuses active recovery even after a known external result;
the adapter does not infer that every external checkpoint is safe to replay. An unresolved ID or unknown outcome refuses recovery
before another provider/tool request and settles as `reconciliation_required` with
`MASTRA_RECOVERY_UNSAFE`. External effects outside the admitted tool boundary are
not covered. Acknowledgement loss does not authorize automatic retry.

Core 1.66.0 running-snapshot pruning removes `messageListState` from completed nested
`map-to-llm-input` output. Restart reuses that output and fails in
`MessageList.deserialize` reading `messages`. Public `workflow.options.pruneSnapshot`
policies retain complete running snapshots recursively, preserving original
suspended/terminal pruning. Extra private storage is bounded by admitted rounds/tools.
No dependency upgrade or SDK file modification was needed. Remove the workaround
only after killed-worker recovery succeeds without it against a validated SDK.

Before every native request, shared context compaction removes only completed
assistant/tool groups, preserving pending call IDs, task and skills. Surviving native
message objects retain their roles; SDK canonical history is unchanged. Tool schemas
count toward the budget. Private `context-round-<n>.json` records retain source and
projected messages, budget, summary and skill digests under
`<contextRoot>/.mastra-baseline/<runId>/`. `state.json`, LibSQL snapshots and
`recovery-snapshot.json` retain restart evidence. These contain model context and
are not published artifacts. `DurableModelRequested` counts agent attempts;
`SummaryModelRequested`/`SummaryModelCompleted` retain `purpose: "summary"` and
reported usage. Summary attempts contribute to total model counts/tokens. An
interrupted summary leaves token totals unknown. Fake extractive summaries make
no provider call. Cost remains unknown because this adapter lacks provider pricing.

Validation uses pinned SDK/LibSQL: a child dies during the second model request after
a calculator result is checkpointed; a fresh runner completes without duplicating
the calculator effect. A separate fresh-process probe resumes exact persisted
approval. The sustained hosted review fixture also reconstructs a wait after a
completed external read, resumes two original write decisions independently, and
verifies waiting deadline expiry with zero effects. Injecting an unresolved
external ID verifies refusal without inference;
it does not establish a real remote lost-acknowledgement outcome. Native prompt
projection tests cover completed and pending tool groups. A model timeout test
verifies no automatic request retry. Deterministic fixtures measure harness
semantics, not model quality.

See [native durable agents](https://mastra.ai/docs/harness/durable-agents) and
[native approval](https://mastra.ai/docs/agents/human-in-the-loop) for SDK APIs.

Native streaming transport errors emit bounded `ModelTransportFailed` diagnostics
before SDK stream conversion or terminal snapshot cleanup. `NativeAgentFailed`
also retains the native lifecycle error, including failures after transport. Only error identity,
redacted message and observed HTTP status are retained; response bodies, headers
and credentials are excluded. A confirmed HTTP rejection is a provider failure,
while an API transport failure without a confirmed status remains `outcome_unknown`.
No retry is introduced. Earlier runs without this diagnostic may retain only a
native `finishReason: "error"`; their missing provider status must not be inferred.
The default OpenRouter route is tested against a mocked HTTP rejection, with no
external provider request.

The opt-in controlled free-model transport supplies both SDK `doGenerate` and
`doStream`. Native DurableAgent's generate facade calls `doStream` internally.
The adapter makes the same bounded, non-streaming OpenRouter HTTP request used
by legacy direct execution, then emits SDK response metadata, text/tool-call
chunks and usage from that observed response. It does not simulate provider token
streaming or make another HTTP request. Exact model ID, experiment output allowance
(512 or 2048 tokens), zero-price ceilings, required parameters, disabled fallback
and zero retries remain enforced immediately before dispatch. A real pinned native
SDK tool loop with mocked HTTP responses verifies two requests, one calculator
effect, correlated call ID and usage. The previous explicit streaming rejection
was a harness incompatibility, before provider dispatch, rather than model quality.

Dynamic skill activation is projected from persisted session state before every
native request. A loader's JSON tool result differs from the authority-free
`Previously loaded skill ...` activation text. If that text is absent, the adapter
adds it as protected **user** context before budgeting/compaction, with skill ID,
version, digest, `trust: untrusted` and `authority: none` in private provenance.
It grants no tool permissions or system authority. Existing copies are recognized
and protected without repeated injection. The regression executes the actual
skill loader, persists activation during an admitted turn, compacts away the
completed loader group, and verifies the procedure and provenance remain in the
next native request projection.
