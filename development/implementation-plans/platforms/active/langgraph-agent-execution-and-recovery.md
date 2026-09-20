# LangGraph agent execution — end-to-end continuation and recovery

**Created:** 2026-09-20T00:11:06+02:00  
**Last updated:** 2026-09-20T02:30:20+02:00
**Status:** Active  
**Owner:** Primary platform implementation agent  
**Platform:** `langgraph`  
**Variant:** `baseline`

This is the next major platform implementation after the completed Restate session and
recovery wave. It extends the existing LangGraph baseline; it does not replace the
common runner contract or redesign the Platform UI.

## Start here

Read these before changing code:

- [`repository rules`](../../../../AGENTS.md)
- [`documentation guide`](../../../../docs/contributing/documentation.md)
- [`server ownership`](../../../../server/README.md)
- [`server architecture`](../../../../server/src/control-plane/README.md)
- [`platform ownership`](../../../../server/src/platforms/README.md)
- [`runner interfaces`](../../../../server/src/control-plane/ports/README.md)
- [`server platform foundation`](../completed/server-platform-foundation.md)
- [`completed LangGraph baseline`](../completed/langgraph-baseline.md)
- [`completed Restate recovery plan`](../completed/restate-session-continuity-and-recovery.md)
- [`shared context and compaction`](../completed/context-management.md)
- [`shared browser Chat surface`](../completed/browser-chat-surface.md)
- [`platform conformance workload`](../completed/platform-agent-conformance.md)
- [`LangGraph platform README`](../../../../server/src/platforms/langgraph/README.md)
- [`LangGraph service notes`](../../../../server/src/platforms/langgraph/docs/README.md)
- [`language boundary decision`](../../../../docs/adr/0002-language-boundary.md)
- [`first-party platform source audit`](../../../../docs/research/platform-plan-source-audit.md)

The existing baseline is useful code and evidence, not a completion of this plan. Start
by inspecting its current protocol, service, graph, adapter, tests, and local launcher.
Preserve its working fake-model path while making the real lifecycle more complete.

## First-party source verification

The implementation must follow the reviewed LangGraph documentation and the pinned
packages in this repository. The following sources were checked on
`2026-09-20T00:11:06+02:00`:

- [Application structure](https://docs.langchain.com/oss/python/langgraph/application-structure)
  — graph construction and application ownership.
- [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
  — thread-scoped checkpoints, checkpointers, state history, and pending writes.
- [Memory](https://docs.langchain.com/oss/python/langgraph/add-memory)
  — short-term thread state versus separate long-term memory.
- [Context concepts](https://docs.langchain.com/oss/python/concepts/context)
  — runtime context, graph state, and cross-conversation context are separate data.
- [Streaming](https://docs.langchain.com/oss/python/langgraph/streaming)
  — stream modes and event handling.
- [Fault tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance)
  — retry policies, node boundaries, and failure handling.
- [Durable execution](https://docs.langchain.com/oss/python/langgraph/durable-execution)
  — checkpointing, replay, idempotency, and side-effect boundaries.
- [Local server guidance](https://docs.langchain.com/oss/python/langgraph/local-server)
  — official local-service concepts. This plan does not adopt LangGraph Platform as
  the Lab runtime.
- [Time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel)
  — checkpoint history and branching are useful reference behaviour, but the full
  time-travel UI is deferred.

The pinned local baseline currently records `langgraph==1.2.10`,
`langgraph-checkpoint-sqlite==3.1.1`, `fastapi==0.141.1`, and `uvicorn==0.53.0` for
Python `>=3.11,<3.13`. Before implementation, verify those versions against the
lockfile and record any intentional update with its reason and validation.

The official documentation describes framework behaviour. It does not establish the
Lab's guarantees for OpenRouter delivery, SQLite process replacement, normalized
evidence, or the browser projection. Those remain explicit Lab contracts below.

### Reference implementations

- The existing LangGraph baseline — keep its Python/TypeScript boundary, protocol
  validation, safe native fields, and deterministic fixtures; replace its
  run-id-as-thread-id shortcut with an explicit session/thread contract.
- The completed Restate recovery implementation — reuse its evidence, unknown-outcome,
  cancellation, polling, browser, and plan-validation discipline; do not copy
  Restate's durable workflow semantics into LangGraph.
- LangGraph's official persistence and fault-tolerance guidance — use checkpoint
  boundaries, thread identity, and retry classification as design input; preserve
  useful platform-specific state instead of reducing it to generic events.

## Purpose

Turn the existing LangGraph baseline into a complete local, inspectable platform
profile for a real multi-turn agent conversation. A contributor must be able to use
the existing Platform Chat or generic API to select LangGraph, send two turns through
one session, observe model and tool events, restart the LangGraph service or Lab
server, and see the same run either reconcile to a known result or remain explicitly
unknown.

This is a Python-native LangGraph service behind the TypeScript Lab server. It is not
LangGraph Platform, LangSmith Deployment, or a claim that SQLite is sufficient for a
multi-process production deployment. The purpose is to learn and compare LangGraph's
actual graph, checkpoint, streaming, retry, and recovery behaviour under a disciplined
local implementation.

## Platform and variant identity

| Field | Decision |
| --- | --- |
| Platform identifier | `langgraph` |
| Display name | LangGraph |
| Variant identifier | `baseline` |
| Display name | LangGraph baseline |
| Status before this plan | Runnable baseline; continuation/recovery incomplete |
| Native runtime | Python `>=3.11,<3.13` service; TypeScript/Node Lab adapter |
| LangGraph version | `1.2.10`, unless a documented first-party compatibility update is required |
| Checkpointer | `langgraph-checkpoint-sqlite==3.1.1` for this local profile |
| HTTP service | FastAPI `0.141.1` with Uvicorn `0.53.0` |
| Execution model | A compiled Python `StateGraph` with model and bounded tool nodes |
| Durability model | Application-managed LangGraph checkpoints in SQLite; no external scheduler |
| Session identity | Lab `sessionId` maps to one stable LangGraph `thread_id` per platform/variant |
| Turn identity | Lab `clientTurnId` and `runId`; each turn is a separate Lab run |
| Environment | Local Python process and local SQLite database; no Docker required |
| External model | OpenRouter through the existing real-model boundary when configured |

### Definition of done

From a clean checkout, without Docker, a contributor can start the local stack, open
`/platforms/langgraph/chat`, choose a real OpenRouter model or deterministic fake
fixture, send two messages in one session, and inspect the graph/checkpoint/tool
evidence. During a delayed turn, replacing the LangGraph service or Lab server does
not create a second execution for the same admitted turn. The UI shows context usage,
native state, and an honest recovery or unknown outcome.

```text
browser/API request
  -> Lab run admission and session/turn identity
  -> LangGraph TypeScript runner adapter
  -> versioned Python HTTP protocol
  -> LangGraph StateGraph with stable thread_id
  -> SQLite checkpoint and graph state
  -> OpenRouter or deterministic model fixture
  -> bounded tool loop and graph events
  -> adapter reconciliation and normalized Lab evidence
  -> Chat status, transcript, context meter, and native details
```

The completed implementation must be able to:

- [ ] accept a generic `langgraph/baseline` run with a stable `sessionId` and
  `clientTurnId`;
- [x] execute a real LangGraph graph through the Python service, not a fake HTTP
  response, with both deterministic and OpenRouter model profiles;
- [ ] continue a second turn from the same LangGraph checkpoint thread while keeping
  separate Lab run and turn identities;
- [ ] expose model, graph-node, checkpoint, tool, usage, retry, cancellation, and
  terminal events without leaking prompts, credentials, or unrestricted native state;
- [x] survive service and Lab-server replacement with a deterministic result or an
  explicit unknown/reconciliation-required state;
- [ ] handle duplicate admission, concurrent same-session turns, stale inspection,
  cancellation races, and provider outcomes that cannot be known after dispatch;
- [ ] write normalized `config.json`, `events.jsonl`, `trajectory.json`, `metrics.json`,
  `result.json`, and safe `native/langgraph.json` evidence;
- [ ] render the existing Chat surface with session continuity, context-window usage,
  compaction/retry/recovery state, and no duplicate React keys or blinking polling;
- [ ] explain an unavailable Python service without fabricating a completed run.

## Scope

- [ ] Replace the baseline run-id/thread-id shortcut with a versioned session/thread
  identity and turn-admission contract.
- [ ] Harden the Python service lifecycle, SQLite ownership, startup recovery, readiness,
  shutdown, and bounded concurrent-run behaviour.
- [ ] Complete the real OpenRouter request path and deterministic provider fixtures,
  including pre-dispatch retry, post-dispatch unknown outcome, context overflow, and
  usage accounting.
- [ ] Complete the LangGraph state/checkpoint model for multi-turn continuation,
  checkpoint inspection, graph-step events, and bounded tool execution.
- [ ] Integrate the shared context snapshot and compaction policy without confusing
  LangGraph checkpoint state with long-term memory or the Lab transcript projection.
- [ ] Make cancellation, timeout, retry, service restart, Lab-server restart, duplicate
  request, and stale projection semantics explicit and testable.
- [ ] Extend the runner adapter and API projection with safe native state, recovery,
  context usage, and operational evidence.
- [ ] Verify the existing Platform Chat UI and shared model picker end to end for
  LangGraph, including two turns and recovery states.
- [ ] Update platform, architecture, local-development, browser-test, and playground
  documentation, then record validation and focused commits.

## Explicitly out of scope

- LangGraph Platform, LangSmith Deployment, hosted Agent Server, or remote control-plane
  deployment.
- PostgreSQL, Redis, multi-process SQLite workers, autoscaling, Kubernetes, and Docker
  as required dependencies. A future production deployment profile needs its own plan.
- Full time-travel or branching UI, graph visual editor, subgraphs, supervisor graphs,
  human-in-the-loop interrupt UX, background cron, or long-running external workflows.
- Long-term memory stores, vector search, MCP, OAuth, plugins, social connectors,
  browser automation, filesystem/computer environments, and the general skill system.
- Changes to Restate, Temporal, Mastra, Anesu, Studio, or the common runner contract
  unless a concrete LangGraph incompatibility is demonstrated and separately recorded.
- Exactly-once OpenRouter execution. Provider calls remain at-least-once or unknown
  according to the dispatch boundary and must be reported honestly.

## Architecture and ownership

### Boundary map

```text
server/src/control-plane/
  request admission, manifests, lifecycle projection, shared context, and evidence

server/src/platforms/langgraph/protocol/
  versioned JSON wire schema, Pydantic models, TypeScript parsers

server/src/platforms/langgraph/service/
  FastAPI process, lifecycle, SQLite run store, recovery, and HTTP ownership

server/src/platforms/langgraph/variants/baseline/
  StateGraph, graph state, model node, bounded calculator tool node, retry policy

server/src/platforms/langgraph/runner-adapter/
  TypeScript HTTP client, admission reconciliation, native-reference validation,
  context preparation, inspect, cancel, and runner-contract mapping

apps/web/src/features/platforms/
  existing shared Chat, model picker, context meter, status and evidence projection

lab/runs/<run-id>/
  config.json, events.jsonl, trajectory.json, metrics.json, result.json,
  native/langgraph.json, logs/, and artifacts/
```

Ownership rules:

- Python LangGraph SDK types and checkpoint objects stay inside
  `server/src/platforms/langgraph/`.
- The TypeScript adapter owns the wire protocol and translates native state to the
  generic `PlatformRunner` contract; common control-plane modules do not import Python
  or LangGraph types.
- The Python service owns graph execution, checkpoint persistence, service-local run
  records, and native event collection.
- The Lab evidence store remains the sole writer of normalized run evidence.
- The browser reads the server projection and evidence endpoint; it does not call the
  Python LangGraph service directly.
- Framework-specific checkpoint values, raw model payloads, authorization headers,
  prompts, and arbitrary graph state must not cross the safe native boundary.

### Files allowed to change

| Workstream | Owned paths | Must not change without a recorded boundary decision |
| --- | --- | --- |
| Python protocol/service | `server/src/platforms/langgraph/protocol/`, `service/`, `variants/baseline/` | Other platform services, common runner types |
| TypeScript adapter | `server/src/platforms/langgraph/runner-adapter/`, LangGraph adapter tests | Restate/Temporal adapter behaviour |
| LangGraph process tests | `server/src/platforms/langgraph/service/tests/`, `server/tests/platforms/langgraph/`, `server/integration-tests/` | Production code from tests |
| Local operations | `scripts/run_local_stack.sh`, platform deployment/local docs | Docker requirements or unrelated launcher semantics |
| Browser acceptance | `apps/web/tests/browser/` and existing platform feature files only when required | Anesu/Studio UI and unrelated platform behaviour |
| Documentation | `server/src/platforms/langgraph/docs/`, `server/src/platforms/langgraph/README.md`, `development/playground/`, this plan | Published claims about hosted LangGraph |

Existing dirty Anesu, Studio, lockfile, and playground work belongs to other workstreams
and must remain unstaged and unchanged.

## First implementation audit

Before production changes, record the current baseline behaviour and close each question:

- [ ] Confirm the exact Python interpreter selected by `scripts/run_local_stack.sh` and
  verify Python 3.11 and 3.12 behaviour from a clean virtual environment.
- [ ] Confirm the Python service's SQLite connection mode, journal mode, busy timeout,
  checkpointer lifetime, and whether concurrent graph calls can share one database.
- [ ] Confirm how `graph.stream(..., stream_mode=["updates", "checkpoints", "tasks"],
  version="v2")` represents node updates, checkpoint metadata, tasks, and failures.
- [ ] Confirm which state is restored when the same `thread_id` is invoked for turn two
  and which fields must be supplied only on the first invocation.
- [ ] Confirm whether a service restart can inspect a checkpoint without resuming an
  unfinished model call, and classify the result if the call may have reached OpenRouter.
- [ ] Confirm all current wire fields, safe reference fields, event names, and evidence
  paths against the code rather than relying on the old baseline plan.
- [ ] Record observed behaviour separately from official LangGraph guarantees and Lab
  decisions in the progress log below.

## Session, turn, and checkpoint identity

The current baseline uses `threadId = runId`. That is not sufficient for multi-turn
Chat. This plan replaces it with the following explicit model:

| Identity | Owner | Rule |
| --- | --- | --- |
| `sessionId` | Lab request/UI | Stable conversation identity selected by the user |
| `clientTurnId` | Client/Lab admission | Idempotency key for one user turn |
| `runId` | Lab control plane | Unique evidence and execution projection for one admitted turn |
| `thread_id` | LangGraph adapter/service | Stable deterministic mapping from platform, variant, and `sessionId` |
| checkpoint ID | LangGraph | Native state version returned by the checkpointer |
| graph task ID | LangGraph | Native node invocation identity; diagnostic only |

Required rules:

- [ ] Derive a stable, bounded `thread_id` from `langgraph`, `baseline`, and
  `sessionId`; do not expose arbitrary user input as a filesystem path or SQL fragment.
- [ ] Keep `runId` and `thread_id` separate in protocol, native evidence, events, and
  UI details.
- [x] Repeating the same `clientTurnId` with the same request fingerprint returns the
  original run; the request must not execute the graph twice.
- [x] Repeating a `clientTurnId` with a different prompt, model, context, tool, or
  graph configuration returns a stable conflict and does not mutate the checkpoint.
- [x] Admit at most one active turn per session/thread unless LangGraph concurrency is
  deliberately proven safe; concurrent requests receive an explicit conflict or join
  the already admitted run.
- [ ] A new model or context-affecting configuration after a settled turn requires a
  new Chat session, matching the existing UI rule.
- [ ] A second turn loads the previous settled LangGraph state and appends the new user
  message exactly once. It must not replay the first user message as a new turn.
- [ ] Context snapshots and LangGraph checkpoints have separate IDs and evidence; one
  must not silently stand in for the other.

## Protocol and lifecycle

Extend the existing versioned protocol only where the full session contract requires it.
Preserve forward rejection of unsupported protocol versions and strict bounds on every
input. The protocol should carry only the data needed by the graph and safe result
projection.

### Required request fields

```json
{
  "protocolVersion": 1,
  "runId": "run-id",
  "sessionId": "session-id",
  "clientTurnId": "client-turn-id",
  "threadId": "langgraph:baseline:stable-session-id",
  "prompt": "user prompt",
  "systemInstruction": "redacted in evidence",
  "model": { "provider": "openrouter", "model": "provider/model" },
  "context": {
    "snapshotId": "snapshot-id",
    "compactionRevision": 0,
    "contextWindowTokens": 128000
  },
  "tools": { "enabledNames": ["calculator"], "maxRounds": 6, "maxCalls": 8 }
}
```

- [ ] Validate required identity fields, maximum sizes, allowed provider/model values,
  tool allowlist, context budgets, and request fingerprints at the Python boundary.
- [ ] Return stable HTTP errors for malformed requests, duplicate conflicts, unavailable
  dependencies, and unknown executions; never return a success-shaped body for failure.
- [ ] Ensure start admission is persisted before graph work begins.
- [ ] Ensure inspect is safe and idempotent after terminal completion, process restart,
  or an unknown submission response.
- [ ] Ensure cancel is idempotent and reports whether it was accepted, already terminal,
  or unable to establish the external outcome.
- [ ] Bound all response bodies, event payloads, output text, tool arguments, and native
  checkpoint summaries.

### Lifecycle states

```text
received
  -> validated
  -> admitted / queued
  -> running
  -> completed
  -> failed | cancelled | unknown | reconciliation_required
```

For every transition, identify the durable owner and evidence write order:

| Transition | Persist first | Then emit/project | Recovery rule |
| --- | --- | --- | --- |
| admission | run identity, fingerprint, thread identity | `RunAdmitted` | duplicate request inspects existing record |
| graph start | service record and attempt | `PlatformExecutionStarted` | startup recovery inspects record/checkpoint |
| checkpoint | native checkpoint metadata | `CheckpointWritten` | duplicate checkpoint projection is ignored |
| model request | bounded dispatch metadata | `ModelRequested` | pre-dispatch may retry; post-dispatch may be unknown |
| tool call | call ID/name/attempt | tool lifecycle events | duplicate call ID is rejected or deduplicated |
| terminal result | result/error/status/usage | terminal normalized events | terminal record is immutable |
| cancellation | cancellation intent | cancellation event | race resolves to honest terminal/unknown state |

## Graph and tool execution

The baseline graph remains small, but it must be a real inspectable graph rather than a
single opaque model call.

- [ ] Keep separate `model` and `tools` nodes with explicit transitions and bounded
  maximum rounds/calls.
- [ ] Use a typed graph state that stores raw messages, tool calls/results, model usage,
  node/round counters, compaction revision, and safe execution metadata; do not store
  prompt-formatted duplicates that can drift from the source transcript.
- [ ] Load prior thread state for a continuation turn and append only the new user
  message before entering the model node.
- [ ] Preserve graph node boundaries so checkpoint and failure evidence shows what may
  be replayed after interruption.
- [ ] Keep the calculator fixture for deterministic tests and add no unrestricted shell,
  network, filesystem, or computer tool to this plan.
- [ ] Validate tool name, call ID, argument schema, argument bytes, call count, result
  size, and round count before execution.
- [ ] Emit model, graph-step, checkpoint, tool-request, tool-validation, tool-start,
  tool-complete, tool-failure, and terminal events with stable ordering metadata.
- [ ] Record tool side-effect policy explicitly: the calculator is pure and replay-safe;
  future side-effecting tools require their own idempotency design.
- [ ] Preserve LangGraph-native checkpoint/task information in bounded native evidence
  without serializing arbitrary state or secrets.

## Real model and provider semantics

The real model path must use the selected OpenRouter model when the key is intentionally
provided. Fake models are allowed only as deterministic fixtures and must remain visibly
identified as fake in tests and evidence.

- [ ] Send the configured OpenRouter model, system instruction, thread transcript, tool
  definitions, and current context snapshot through one bounded model-request boundary.
- [ ] Record sanitized provider/model identity, request attempt, dispatch phase, usage,
  latency, and outcome classification; never write API keys, authorization headers, or
  raw provider bodies to evidence.
- [ ] Distinguish configuration failure, pre-dispatch failure, retryable transport/rate
  failure, provider-declared context overflow, timeout before dispatch, timeout after
  dispatch, and unknown outcome after dispatch.
- [ ] Retry only failures proven not to have sent the provider request, with a bounded
  attempt count and backoff recorded in graph/native/normalized evidence.
- [ ] Do not retry a provider call after an ambiguous post-dispatch failure unless a
  future provider-specific idempotency contract proves it safe.
- [ ] On provider context overflow, perform at most one shared compaction preparation,
  record the changed snapshot/revision, and retry the changed request once. A second
  overflow becomes an explicit failure.
- [ ] Preserve usage when the provider returns it and use the existing estimator only
  when the contract explicitly identifies the value as estimated.

## Context and memory boundary

This plan implements LangGraph's use of the existing shared context system; it does not
invent a second generic context implementation or add long-term memory.

- [x] Prepare the shared context snapshot before the graph turn using system instructions,
  transcript, selected tools, and the configured context window.
- [x] Pass the snapshot identity, compaction revision, context-window budget metadata,
  and bounded prepared input identity to the Python service without duplicating the
  whole context into native metadata.
- [ ] Make the LangGraph checkpoint the source of platform-native short-term graph state;
  make the shared context snapshot the source of Lab-wide context budgeting and display.
- [ ] Define how prior checkpoint messages and a newly prepared compacted context are
  reconciled so the model does not receive duplicate history.
- [ ] Expose used tokens, context window, percentage left, pressure, compaction count,
  snapshot ID, and estimated-versus-provider-reported usage in the server projection.
- [ ] Ensure compaction is bounded, idempotent per turn, and cannot loop after a retry or
  service restart. The summary request and deterministic fake path are implemented; the
  provider-overflow retry and restart proof remain.
- [ ] Record that LangGraph short-term checkpoint state is not long-term memory and do
  not add a Store/vector database in this implementation.

## Persistence, restart, and recovery

SQLite is the required no-Docker local profile. It must be treated as a real persistence
boundary with explicit limitations, not as an in-memory test double.

- [ ] Give the LangGraph service one configured database path per local profile and keep
  it outside generated source directories.
- [ ] Configure and test SQLite connection lifecycle, WAL/locking behaviour, busy
  timeout, schema initialization, process ownership, and safe shutdown.
- [ ] Reopen the same database after service replacement and verify settled checkpoints,
  session turns, native references, and run records remain readable.
- [ ] During an active model or tool step, replace the service and classify the prior
  execution as completed, resumable, failed, or unknown based on persisted evidence;
  never infer provider success merely because a checkpoint exists.
- [x] Replace the Lab server while the Python service and graph remain active, then
  reconcile the retained execution by stable `runId` and `thread_id`.
- [x] If both Lab server and Python service are replaced, recover settled state and
  expose explicit recovery-required/unknown state for an interrupted external call.
- [x] On startup, inspect nonterminal service records and mark or resume them according
  to the documented rule; do not silently start a second graph for every stale record.
- [x] Handle orphaned checkpoints and run records with bounded diagnostics and cleanup
  rules. Never delete evidence as part of ordinary recovery.
- [ ] Define retention for SQLite run state and Lab evidence separately; cleanup is not
  part of the default acceptance path.

### Recovery matrix

| Failure point | Expected result | Retry rule | Evidence |
| --- | --- | --- | --- |
| before admission | no run | safe to retry request | no terminal run record |
| after admission, before graph start | same run is inspectable | reconcile by `clientTurnId` | admission + recovery event |
| before provider dispatch | failed/retryable | bounded retry allowed | attempt and no-dispatch proof |
| after provider dispatch, before response | unknown/recovery-required | no blind duplicate | `outcome_unknown`, no exactly-once claim |
| after checkpoint write | checkpoint/state inspectable | resume only by defined graph rule | checkpoint/native evidence |
| during pure calculator tool | replay-safe or deduplicated | bounded retry | tool call ID and result |
| cancellation before dispatch | cancelled | no provider retry | cancellation event |
| cancellation after dispatch | completed/unknown/cancelled based on evidence | no stronger claim | cancellation race detail |
| service restart | settled result or explicit recovery | startup reconciliation | service replacement record |
| Lab-server restart | same run projection | inspect retained native execution | server replacement record |

## Runner adapter and server projection

- [ ] Update `LangGraphBaselineRunner.start()` to send the session/turn/thread contract
  and reconcile lost admission responses without issuing a duplicate POST.
- [ ] Validate every persisted native reference before contacting the service, including
  service origin, protocol, execution ID, thread ID, graph, and bounded fields.
- [ ] Make `inspect()` map Python service states and graph events to the generic runner
  without hiding native checkpoint details.
- [ ] Make `cancel()` idempotent and preserve unknown outcomes when cancellation races
  with provider dispatch.
- [ ] Ensure every shared context/tool configuration field is passed consistently from
  the manifest to the Python graph.
- [ ] Keep normalized evidence writes in the control plane and native evidence writes in
  the LangGraph boundary; terminal writes must be idempotent.
- [ ] Include safe operational log fields for request ID, run/session/turn identity,
  status, native status, outcome, duration, retry count, and stable error code only.
- [ ] Add no LangGraph-specific assumptions to Temporal, Restate, Mastra, or common
  comparison code unless the existing generic seam is demonstrably insufficient.

## Browser Chat acceptance

Use the existing shared Chat route and model picker. Do not create a separate LangGraph
dashboard for this plan.

- [x] Open `/platforms/langgraph/chat` and create a new session in the deterministic
  browser fixture.
- [x] Select a searchable OpenRouter model in the shared picker and send a real prompt.
- [x] Send a second prompt and verify one session, two Lab turns, one LangGraph thread,
  and two distinct run IDs in the deterministic browser fixture.
- [x] Show model identity, session/thread identity, context window usage, graph/native
  status, and tool details through progressive disclosure in Chat.
- [x] Show retrying, compaction, unavailable, cancelled, stale, failed, and
  recovery-required states without fabricated assistant output.
- [x] Refresh during a running turn and verify the same run is reused without duplicate
  assistant messages or duplicate React keys.
- [ ] Change model or context configuration after a settled turn and require a new chat
  or show a clear inline conflict.
- [x] Replace the Lab server during a delayed run and verify browser reconciliation.
- [x] Replace the LangGraph service during a delayed run and verify completion or an
  explicit recovery state.
- [ ] Inspect wide, tablet, and narrow layouts manually; keep the platform tab row and
  Chat controls usable without a blinking polling surface.
- [ ] Inspect the browser console for route errors, failed health probes, duplicate-key
  warnings, unhandled polling exceptions, and unexpected network loops.

## Evidence and observability

Every accepted run must retain:

```text
lab/runs/<run-id>/
  config.json
  context.json
  events.jsonl
  trajectory.json
  metrics.json
  result.json
  native/langgraph.json
  logs/operations.jsonl
  artifacts/
```

- [x] Record resolved platform/runtime versions and protocol version in `config.json` or
  safe native metadata.
- [ ] Keep normalized event order monotonic by the Lab event sequence and preserve
  LangGraph checkpoint/graph-step sequence separately.
- [ ] Record model request attempts, graph nodes, checkpoints, tool calls, usage,
  compaction, retries, cancellation, duration, and outcome classification.
- [ ] Redact prompts, system instructions, authorization values, API keys, raw provider
  payloads, unbounded tool arguments/results, and arbitrary checkpoint values.
- [ ] Verify duplicate inspection, retries, service replacement, and terminal writes do
  not append duplicate normalized events or overwrite a settled result.
- [ ] Include enough native detail to explain a recovery decision without claiming that
  every internal LangGraph state value is persisted in the Lab evidence.

## Test matrix

Tests must exercise real boundaries, not only helper functions.

### Python service and graph tests

- [ ] Protocol rejects unsupported versions, missing identity, oversized fields, invalid
  tools, invalid context budgets, and malformed model configuration.
- [ ] Graph completes fake success, real-model request construction, tool call, tool
  rejection, tool limit, model round limit, and output-size limit.
- [ ] Same `thread_id` continues a second turn with the first turn's settled messages
  exactly once.
- [ ] Different sessions do not share checkpoints or transcript state.
- [ ] Checkpoint metadata, graph steps, tasks, usage, and errors are bounded and safe.
- [ ] Pre-dispatch failures retry within the configured bound; post-dispatch failures
  become unknown without a second provider request.
- [ ] Context overflow performs one compaction recovery and cannot loop.
- [ ] Cancellation before and during a model/tool step is classified correctly.
- [ ] Duplicate start with same fingerprint is idempotent; conflicting duplicate is
  rejected; concurrent same-session admission is deterministic.
- [ ] Service shutdown marks unfinished records according to the recovery matrix.

### TypeScript adapter and server tests

- [ ] Protocol parsers reject unsafe or malformed Python responses.
- [ ] Adapter maps all normal, retry, cancellation, unknown, stale, and recovery states.
- [ ] Native reference validation prevents malformed service/admin requests.
- [ ] Context and tool configuration pass through without loss or platform leakage.
- [ ] Lost admission response reconciles by stable execution identity.
- [ ] Evidence writes are idempotent and redact secrets.
- [ ] Generic Fastify API supports two turns, duplicate requests, cancellation, refresh,
  service unavailability, and terminal inspection.

### Native process-level acceptance without Docker

- [x] Start the locked Python service on an isolated port and verify health/readiness.
- [x] Run one fake model/tool turn through the generic Fastify API.
- [x] Run two fake-model turns in one session and inspect one stable LangGraph thread
  with separate Lab run IDs through the generic Fastify API.
- [x] Replace the Python service during a delayed turn using the same SQLite database and
  verify settled/recovery behaviour.
- [x] Replace the Lab server during a delayed turn while the Python service remains up.
- [x] Replace both processes and verify the documented outcome.
- [x] Exercise duplicate admission, concurrent session conflict, and cancellation.
- [x] Exercise stale projection, timeout-after-dispatch, ambiguous provider outcome,
  and context-overflow fixtures through the native LangGraph process boundary.
- [x] Run one opt-in OpenRouter multi-turn acceptance when a safe local key is present;
  record model, usage, status, and evidence paths without recording the key.
- [ ] Docker-backed profiles, if any remain in the repository, are explicitly skipped
  and reported as optional rather than required.

### Browser acceptance

- [x] Add deterministic fixture coverage to `apps/web/tests/browser/platform-chat.browser.test.mjs`
  for LangGraph two-turn continuity, context usage, graph/tool events, retry, recovery,
  cancellation, refresh, stale state, duplicate-key safety, and responsive widths. The
  fixture now also covers retrying, compaction evidence, provider failure, unavailable
  health, and stale projection without fabricated assistant output.
- [x] Add an opt-in live LangGraph Chat test for real OpenRouter execution.
- [x] Add an opt-in browser test that replaces the Lab server during a LangGraph run.
- [x] Add an opt-in browser test that replaces the LangGraph service during a run using
  the same configured SQLite database and verifies the same run result or honest recovery
  state.
- [x] Keep all destructive process replacement tests opt-in and document their cleanup.

## Local operations and commands

The normal contributor path must remain no-Docker:

```bash
./scripts/run_local_stack.sh langgraph
./scripts/run_local_stack.sh server
```

The exact launcher may start the Lab server and LangGraph service together; the plan
must document the supported command after implementation and ensure conflicting ports
are stopped/restarted according to the repository launcher contract.

Required checks before completion:

```bash
pnpm --filter @agent-harness-lab/lab-server run typecheck
pnpm --filter @agent-harness-lab/lab-server exec tsx --test \
  tests/platforms/langgraph/protocol.test.ts \
  tests/platforms/langgraph/runner-adapter.test.ts \
  tests/platforms/langgraph/langgraph-runner.test.ts
pnpm --filter @agent-harness-lab/lab-server run test:langgraph
pnpm --filter @agent-harness-lab/lab-server test
pnpm --filter @agent-harness-lab/web run typecheck
pnpm --filter @agent-harness-lab/web run build
node --test apps/web/tests/browser/platform-chat.browser.test.mjs
git diff --check
```

Required Python checks use the locked environment selected by the launcher:

```bash
cd server/src/platforms/langgraph
python -m pytest service/tests
python -m compileall -q protocol service variants
```

Record exact interpreter, LangGraph, checkpoint, FastAPI, Uvicorn, and SQLite versions
in the completion record. If a command cannot run because a dependency is unavailable,
record the exact prerequisite and keep the plan active.

## Documentation and release completeness

- [x] Update `server/src/platforms/langgraph/README.md` with the final session/thread,
  checkpoint, retry, cancellation, restart, and local-operation contract.
- [x] Update `server/src/platforms/langgraph/docs/README.md` with observed versus
  documented behaviour and the SQLite limitations.
- [x] Add or update a focused `development/playground/langgraph-*.md` walkthrough that
  starts the service, runs two turns, inspects checkpoints/evidence, and performs a
  controlled restart.
- [x] Update browser-test documentation with all opt-in live and process-replacement
  commands.
- [ ] Update platform navigation and plan index when the plan is archived.
- [x] Check for `docs/internal/operations/release-process.md`; it is absent in this
  checkout, so documentation, logging, metrics, version, migration, rollout, and
  rollback decisions are recorded in this plan and the platform notes.
- [x] Analytics: not applicable; this slice adds no product analytics.
- [ ] Structured logs: request/run/session/turn identity, status, native status, outcome,
  duration, retry count, and stable error code only; no prompt or credential logging.
- [ ] Metrics: model calls, tool calls, graph steps, checkpoint count, retries, duration,
  token usage, compaction, and unknown outcomes in run evidence.
- [x] Version identity: platform protocol and resolved Python dependency versions are
  retained as safe native metadata in the execution reference.
- [ ] Migration: old baseline run records remain readable; changed protocol/reference
  fields have a compatibility or explicit rejection rule.
- [ ] Rollback: document how to stop LangGraph only, preserve Lab evidence, and revert
  LangGraph changes without changing Restate, Temporal, or other platform runners.

## Progress log

Add timestamped entries as implementation proceeds. Each entry must state what changed,
what was observed, the exact validation command, and what remains.

- **2026-09-20T00:11:06+02:00 — plan created.** The existing LangGraph baseline is
  runnable and has Python/TypeScript tests, SQLite checkpointing, a bounded calculator,
  and generic UI wiring. The next implementation is the missing full session/thread,
  context, recovery, evidence, and browser acceptance contract. No production code was
  changed in this planning step.

- **2026-09-20T00:21:06+02:00 — session/thread admission implemented.** Added a stable
  SHA-256-derived native thread mapping for Lab sessions, explicit `sessionId` and
  `clientTurnId` protocol fields, SQLite session/turn columns with migration support,
  same-session single-flight admission, and fingerprint-aware duplicate turn reuse.
  Updated the Python protocol, TypeScript adapter, JSON schema, and platform docs.
  Validation passed: Python protocol/service tests `29 passed`; TypeScript protocol and
  adapter tests `8 passed`; `git diff --check` passed. Graph continuation, recovery,
  context, and browser work remain.

- **2026-09-20T00:24:58+02:00 — native checkpoint continuation implemented.** A later
  turn now loads the previous settled LangGraph checkpoint, appends only its new user
  message, resets per-turn counters, and emits a bounded `CheckpointLoaded` event.
  Added a service test proving a second `fake-context` turn remembers data from the
  first turn without using a shared transcript snapshot. The focused Python suite now
  covers this native continuation path; recovery and context reconciliation remain.

- **2026-09-20T00:31:43+02:00 — LangGraph context summary path implemented.** The
  TypeScript adapter now uses a bounded deterministic summary for fake profiles and a
  server-owned OpenRouter summary request for real profiles. Missing credentials,
  cancellation, oversized responses, invalid responses, empty summaries, and upstream
  HTTP failures have explicit error codes without copying provider bodies into errors.
  Added focused summary tests and adapter documentation. Validation passed: server
  typecheck, nine LangGraph TypeScript tests, and `git diff --check`. Provider-overflow
  retry, restart reconciliation, and browser acceptance remain.

- **2026-09-20T00:35:27+02:00 — shared compaction verified at the adapter boundary.**
  Added a filesystem-backed runner test that fills an admitted session, triggers the
  shared preflight compaction policy, confirms the snapshot identity crosses the
  TypeScript/Python request boundary, and checks that the resulting snapshot retains a
  bounded summary without becoming exhausted. Validation passed: ten focused
  LangGraph TypeScript tests and `git diff --check`.

- **2026-09-20T00:37:52+02:00 — SQLite replacement semantics hardened.** The
  platform store now enables WAL, full synchronous commits, foreign-key checks, a
  bounded busy timeout, and idempotent close. Added tests for reopening terminal run
  records and native events, replaying an unknown run after replacement without a
  second admission, and the late-worker race that must not overwrite reconciliation.
  Validation passed: forty LangGraph Python tests. Full process replacement and
  browser recovery still remain opt-in integration work.

- **2026-09-20T00:38:56+02:00 — provider context overflow classification added.** The
  native OpenRouter boundary now recognizes common HTTP 400/413 context-limit
  responses as `LANGGRAPH_CONTEXT_OVERFLOW` without copying the provider body into
  errors. A focused Python test covers the classification and redaction. The bounded
  shared-compaction retry was then added in the recovery section below.

- **2026-09-20T00:46:33+02:00 — one-time overflow recovery wired through the Lab.**
  Added an optional runner recovery seam, LangGraph's forced `provider_overflow`
  compaction dispatch, deterministic recovery identities, safe per-execution event
  sources, and evidence replacement for the retained native reference. The common
  service coalesces concurrent recovery attempts and blocks a second attempt after a
  persisted recovery request. Added run-service and adapter tests proving one overflow
  becomes one recovery dispatch, a forced `provider_overflow` snapshot, and ordered
  evidence. Validation passed: sixteen run-service tests, fourteen focused LangGraph
  TypeScript tests, forty-one LangGraph Python tests, server typecheck, and
  `git diff --check`.

- **2026-09-20T00:53:47+02:00 — LangGraph Chat acceptance surface added.** The shared
  browser Chat now exposes the LangGraph session ID and native thread/graph identity
  through the existing run-details disclosure, while retaining the shared context
  meter. Added a deterministic browser acceptance test for two turns, one session and
  thread, distinct Lab run IDs, tool activity, context usage, model locking, and
  duplicate-key safety. Validation passed: web typecheck and all twelve platform Chat
  browser tests; `git diff --check` passed. Real OpenRouter and process-replacement
  browser acceptance remain open.

- **2026-09-20T01:01:01+02:00 — no-Docker local API smoke completed.** Restarted the
  workspace-owned LangGraph process with the current protocol, then ran two fake-model
  turns through an isolated Fastify server on port `4320`. Both completed with one
  stable `langgraph:baseline:<hash>` thread, separate Lab run IDs, a native
  `CheckpointLoaded` event on the second turn, graph/checkpoint/model events, and
  estimated context budgets. The standalone LangGraph launcher now replaces an older
  workspace-owned listener before starting. Validation passed: health/readiness curl
  checks, the two-turn API smoke, `bash -n scripts/run_local_stack.sh`, and
  `git diff --check`. Real OpenRouter, tool-call, and process-replacement acceptance
  remain open.

- **2026-09-20T01:06:04+02:00 — real-process generic API acceptance strengthened.** The
  opt-in integration test now uses the prepared locked Python interpreter when
  available, admits a shared-context session through Fastify, executes the real
  LangGraph calculator tool path, verifies the native hashed thread and context
  projection, reads context/native evidence, and still covers cancellation and
  SQLite service replacement reconciliation. Validation passed:
  `AGENTLAB_RUN_LANGGRAPH_INTEGRATION=1 pnpm --filter @agent-harness-lab/lab-server exec
  tsx --test integration-tests/langgraph-baseline.test.ts` (`1 passed`) and
  `git diff --check`. The broader server typecheck is currently blocked by an
  unrelated dirty Studio catalog type error in `server/src/studio/catalog.ts`.

- **2026-09-20T01:07:53+02:00 — generic API continuation added.** Extended the same
  real-process acceptance to submit a second Fastify turn with a new client turn key,
  then verify a distinct Lab run, the same session and native thread, and a persisted
  `CheckpointLoaded` event. The opt-in integration test passed again; `git diff --check`
  passed. Duplicate admission, refresh, service unavailability, and process-replacement
  browser tests remain open.

- **2026-09-20T01:13:04+02:00 — live OpenRouter continuation verified.** Added an
  opt-in real-provider acceptance path that loads the ignored local server environment
  only when explicitly requested, sends two OpenRouter turns through the real Python
  LangGraph service, and removes its temporary SQLite/context state afterward. The
  test passed with two completed model responses, one stable native thread, and a
  `CheckpointLoaded` event on turn two. The deterministic real-process acceptance also
  passed again. Validation passed:
  `AGENTLAB_RUN_LANGGRAPH_OPENROUTER=1 pnpm --filter @agent-harness-lab/lab-server
  exec tsx --test integration-tests/langgraph-baseline.test.ts` (`1 passed`, `1 skipped`),
  `AGENTLAB_RUN_LANGGRAPH_INTEGRATION=1 pnpm --filter
  @agent-harness-lab/lab-server exec tsx --test integration-tests/langgraph-baseline.test.ts`
  (`1 passed`, `1 skipped`), and `git diff --check`. Live browser execution, process
  replacement, and the remaining retry/cancellation/unknown-outcome matrix remain open.

- **2026-09-20T01:17:03+02:00 — Lab-server replacement acceptance added.** Added a
  deterministic `fake-slow-success` fixture that creates a bounded completion window
  without becoming a timeout, then rebuilt the Fastify Lab server against the same run
  root while the Python LangGraph service remained active. The replacement server
  recovered the original run by `runId`, projected one completed result, and a repeated
  inspection did not append duplicate events. Validation passed: the LangGraph graph
  suite (`10 passed`), the no-Docker real-process integration (`1 passed`, `1 skipped`),
  and `git diff --check`. Both-process replacement, explicit unknown-outcome fixtures,
  and browser process-replacement coverage remain open.

- **2026-09-20T01:19:15+02:00 — both-process replacement acceptance added.** The
  no-Docker integration now starts a delayed native run, replaces the Lab server and
  LangGraph service, reopens the same SQLite state, and verifies that startup marks the
  interrupted native execution unknown. The rebuilt Lab server projects the retained
  run as `reconciliation_required` with reconciliation evidence, without starting a
  second graph. Validation passed:
  `AGENTLAB_RUN_LANGGRAPH_INTEGRATION=1 pnpm --filter @agent-harness-lab/lab-server
  exec tsx --test integration-tests/langgraph-baseline.test.ts` (`1 passed`, `1 skipped`),
  and `git diff --check`. Browser process replacement and the remaining duplicate,
  stale, timeout-after-dispatch, and context-overflow fixtures remain open.

- **2026-09-20T01:21:42+02:00 — generic API admission conflicts verified.** The
  real-process Fastify acceptance now replays a completed turn with the same
  `clientTurnId` and confirms the original `runId` and event count, rejects a changed
  prompt with `CONTEXT_CONFLICT`, and rejects a second active session turn with
  `CONTEXT_BUSY` before allowing the first to complete. Validation passed:
  `AGENTLAB_RUN_LANGGRAPH_INTEGRATION=1 pnpm --filter @agent-harness-lab/lab-server
  exec tsx --test integration-tests/langgraph-baseline.test.ts` (`1 passed`, `1 skipped`),
  and `git diff --check`. Stale projection, timeout-after-dispatch, and context-overflow
  integration fixtures remain open.

- **2026-09-20T01:29:41+02:00 — browser LangGraph recovery surface verified.** Added
  deterministic Chat coverage for refresh reuse, cancellation without fabricated model
  output, recovery-required state, native thread disclosure, and duplicate rendering
  safety. Added an opt-in live Chromium test that selects the real OpenRouter model,
  completes two LangGraph turns in one session, and verifies context usage and native
  thread details. Validation passed: `node --test
  apps/web/tests/browser/platform-chat.browser.test.mjs` (`15 passed`),
  `AGENTLAB_RUN_LIVE_LANGGRAPH_CHAT_UI=1 node --test
  apps/web/tests/browser/live-platform-runners.browser.test.mjs` (`1 passed`, `3 skipped`),
  `node --test apps/web/tests/browser/live-platform-runners.browser.test.mjs` (`4 skipped`),
  and `git diff --check`. Native stale, timeout-after-dispatch, context-overflow, and
  browser process-replacement coverage remain open.

- **2026-09-20T01:41:51+02:00 — native failure matrix completed.** Added a deterministic
  `fake-context-overflow` fixture, made the Python service label a snapshot with the
  explicit `provider_overflow` compaction trigger as `ContextRecoveryPrepared`, and
  added a service regression test for that event contract. The real no-Docker process
  acceptance now verifies timeout-after-dispatch, one bounded context recovery followed
  by a terminal second overflow, an ambiguous provider acknowledgement, and stale
  projection after the native service is stopped. Validation passed: LangGraph Python
  service/graph tests (`31 passed`), and
  `AGENTLAB_RUN_LANGGRAPH_INTEGRATION=1 pnpm --filter @agent-harness-lab/lab-server
  exec tsx --test integration-tests/langgraph-baseline.test.ts` (`1 passed`, `1 skipped`).
  Committed as `a64f955` (`test(langgraph): verify native failure outcomes`). Browser
  process replacement, the full browser failure-state matrix, and remaining
  documentation/release gates remain open.

- **2026-09-20T01:48:09+02:00 — browser native-replacement acceptance scaffolded.** Added
  an opt-in Chromium test that validates the supplied LangGraph service PID, admits a
  deterministic delayed run, replaces the native process against the same SQLite path,
  and requires the Chat surface to show `Run outcome needs recovery.` without a
  fabricated completed assistant message. Documented the safe separate-process setup.
  Validation passed: `node --check apps/web/tests/browser/live-platform-runners.browser.test.mjs`,
  the default live suite (`5 skipped`), `node --test
  apps/web/tests/browser/platform-chat.browser.test.mjs` (`15 passed`), and
  `git diff --check`. The destructive opt-in browser run remains unexecuted and must
  be run with an explicit service PID before this plan item is checked.

- **2026-09-20T01:55:08+02:00 — deterministic LangGraph browser failure matrix completed.**
  Extended the shared browser fixture with LangGraph retry, compaction, provider failure,
  unavailable health, and stale projection states. The acceptance tests verify context
  pressure and compaction evidence, terminal failure without a completed assistant
  message, honest unavailable/stale states, and zero browser console errors. Validation
  passed: `node --check apps/web/tests/browser/platform-chat.browser.test.mjs` and
  `node --test apps/web/tests/browser/platform-chat.browser.test.mjs` (`17 passed`).
  Committed as `de293e2` (`test(web): cover LangGraph Chat failure states`). The live
  process-replacement checks and remaining documentation/release gates remain open.

- **2026-09-20T02:01:36+02:00 — local documentation and playground updated.** Expanded
  the LangGraph semantics notes with observed behaviour versus Lab guarantees, SQLite
  limits, API ownership, and recovery rules. Updated the deployment profile for the
  registered shared-server path and replaced the playground with a no-Docker walkthrough
  covering two-turn identity, evidence, and controlled interruption. Documentation
  generation passed with 72 curated documents; `git diff --check` passed. The remaining
  release gates are structured logging/metrics/version evidence, final manual browser
  inspection, and opt-in destructive process replacement. Committed as `635841c`
  (`docs(langgraph): document local recovery workflow`).

- **2026-09-20T02:02:00+02:00 — browser process-replacement acceptance completed as code.**
  Added the opt-in LangGraph Lab-server replacement check alongside the native-service
  replacement check. The former uses `fake-slow-success` and expects one reconciled
  completed assistant message; the latter reopens the same SQLite path and expects an
  honest recovery-required state. Both validate repository-owned PIDs, document cleanup,
  and remain skipped unless explicitly enabled. Validation passed: `node --check
  apps/web/tests/browser/live-platform-runners.browser.test.mjs`, the default live suite
  (`6 skipped`), and `git diff --check`. Committed as `0c754cb` (`test(web): cover
  LangGraph server replacement`). The destructive opt-in runs themselves remain
  unexecuted.

- **2026-09-20T02:05:28+02:00 — runtime version identity retained in native evidence.**
  Extended the versioned start response and schema with service, LangGraph, and Python
  runtime metadata. The TypeScript adapter now preserves that metadata in the native
  execution reference, allowing retained evidence to be interpreted after the local
  environment changes. Validation passed: 33 Python service/protocol tests, 11
  TypeScript protocol/adapter tests, Lab server typecheck, and `git diff --check`.
  Committed as `3d8a079` (`feat(langgraph): retain runtime version evidence`).

- **2026-09-20T02:23:31+02:00 — destructive browser replacement checks executed.** Fixed
  custom-port CORS propagation in `scripts/run_local_stack.sh`, forwarded run/context
  roots into replacement processes, and made the delayed-success fixture provide a
  deterministic browser observation window. The native-service test now uses `SIGKILL`
  to model process loss (graceful `SIGTERM` correctly produces cancellation), while the
  Lab-server test replaces the interrupted server against the same evidence root.
  Both tests passed against isolated native processes without Docker:

  - `AGENTLAB_RUN_LIVE_LANGGRAPH_SERVICE_RESTART_UI=1 ... node --test
    apps/web/tests/browser/live-platform-runners.browser.test.mjs` — 1 passed, 5 skipped;
    run `3e266caf-0cee-4108-a307-a9713e62159e` rendered recovery-required state.
  - `AGENTLAB_RUN_LIVE_LANGGRAPH_SERVER_RESTART_UI=1 ... node --test
    apps/web/tests/browser/live-platform-runners.browser.test.mjs` — 1 passed, 5 skipped;
    run `5a0fa2ac-3af5-4f68-a133-644da7bba6f5` reconciled to one completed result.

  Additional validation passed: 44 Python LangGraph tests, 14 focused TypeScript tests,
  17 deterministic browser tests, web typecheck, `bash -n scripts/run_local_stack.sh`,
  and `git diff --check`. Remaining plan work includes the broader completion audit,
  manual layout/console inspection, and release/migration/rollback records.

- **2026-09-20T02:30:20+02:00 — bounded recovery diagnostics implemented.** Added the
  read-only `GET /v1/recovery/diagnostics?limit=...` service endpoint, strict Python and
  TypeScript protocol models/parsers, and the JSON schema entry. The report identifies
  checkpoint threads without a service-run owner, orphan writes, and admitted
  nonterminal/unknown runs without a checkpoint. It never adopts, resumes, deletes, or
  treats a checkpoint as proof of provider completion. Fresh databases without
  checkpointer tables return a clean bounded response, and tests verify orphan state is
  retained after inspection. Validation passed: LangGraph service tests (`46 passed`),
  focused TypeScript tests (`19 passed`, `1 skipped`), schema JSON parsing, and
  `git diff --check`. Retention, structured logs/metrics, migration/rollback records,
  and manual browser inspection remain open.

- **2026-09-20T02:41:12+02:00 — snapshot metadata binding hardened.** LangGraph dispatch
  now carries the immutable compaction revision and context-window metadata alongside
  the snapshot identity. The Python service rejects stale revision or window metadata
  before graph execution, while the prepared message list remains filesystem-owned and
  is not duplicated in the wire protocol. Validation passed: 10 focused TypeScript
  tests (one skipped) and 36 Python protocol/service tests. The first test fixtures were
  updated to create real context sessions where a snapshot is required.

## Commit discipline

Use focused commits. Do not create one large final commit.

1. `docs(langgraph): record execution and recovery contract` — plan and source audit.
2. `feat(langgraph): define session thread and turn admission` — protocol, identity,
   duplicate/concurrency rules, and Python/TypeScript tests.
3. `feat(langgraph): harden graph model tool and context execution` — graph state,
   OpenRouter boundary, tool loop, shared context/compaction, and unit tests.
4. `feat(langgraph): add service restart and reconciliation` — SQLite lifecycle,
   service/Lab restart, unknown outcomes, cancellation, and native integration tests.
5. `feat(web): complete LangGraph Chat recovery surface` — shared Chat projection,
   context/native details, browser fixtures, and opt-in live acceptance.
6. `docs(langgraph): document local operations and completion evidence` — README,
   playground, browser instructions, validation record, and limitations.

Before each commit:

- [ ] Review `git status` and preserve unrelated Anesu, Studio, lockfile, and playground
  changes.
- [ ] Run narrow checks for the changed section.
- [ ] Inspect the complete staged diff for secrets, generated environments, and unrelated
  platform changes.
- [ ] Keep shared control-plane changes separate from LangGraph-specific changes.
- [ ] Record the commit hash and validation result in the progress log.

## Completion gate

Do not move this plan to `platforms/completed/` until all applicable items are checked:

- [ ] The clean-checkout no-Docker path is documented and runnable.
- [ ] Two turns use one stable LangGraph thread and separate Lab run identities.
- [ ] Real OpenRouter and deterministic model/tool paths are both tested.
- [ ] Context usage and bounded compaction are visible and tested.
- [ ] Checkpoint, graph-node, tool, retry, cancellation, and terminal evidence is
  inspectable without secrets.
- [ ] Duplicate admission, concurrent session conflict, stale state, and unknown
  post-dispatch outcome semantics are tested.
- [ ] LangGraph service, Lab server, and SQLite replacement have tested outcomes.
- [ ] Browser Chat works for normal, continuation, refresh, cancellation, retry,
  compaction, unavailable, stale, and recovery states without duplicate rendering.
- [ ] Full Python, TypeScript, server, browser, build, and diff validation has passed.
- [ ] Documentation, playground, rollback, known limitations, and focused commit hashes
  are recorded.

## Completion record

Complete only when archiving this plan.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`  
**Commits:** `[focused commit hashes]`

### Validation

- `[command]` — `[result]`
- `[native restart exercise]` — `[result]`
- `[browser acceptance]` — `[result]`
- `[manual UI inspection]` — `[result]`

### Known limitations

- `[deliberate local-only limitation or follow-up]`

This plan records the run-oriented LangGraph baseline at completion time. Hosted
LangGraph/LangSmith deployment, production database infrastructure, long-term memory,
human approval, and time-travel UI require separate plans.
