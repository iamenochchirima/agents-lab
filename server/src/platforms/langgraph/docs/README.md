# LangGraph baseline notes

## What is implemented

The baseline is a small `StateGraph` with context, model, approval and bounded tools nodes. The
graph is compiled with `SqliteSaver`, invoked with a stable `thread_id`, and consumed
through the platform-local FastAPI service. The service streams LangGraph `v2` updates,
tasks, and checkpoint parts into a redacted native event log.

The TypeScript side sends and validates JSON only. This is the seam that lets the Lab compare LangGraph with other platforms without pretending their state models are identical.

## Lifecycle

```text
POST /v1/runs
  -> session/client-turn admission
  -> queued service record
  -> running StateGraph on a stable thread_id
  -> model node and bounded node attempts
  -> SQLite checkpoint events
  -> completed / failed / cancelled / unknown inspection
```

`unknown` means the process stopped or the external model outcome could not be established. It is not a synonym for provider failure. The TypeScript adapter projects this state to the Lab's reconciliation-required terminal evidence.

The Lab keeps one `runId` per admitted turn. When a request has a `sessionId`, the
adapter derives `thread_id` as `langgraph:baseline:` plus the first 32 hexadecimal
characters of the SHA-256 session digest. This keeps the native thread stable across
turns without exposing arbitrary session input as a path-like identifier. The service
rejects a second active turn in the same session and reuses an admitted turn when its
`clientTurnId` and immutable request fingerprint match.

After the first settled turn, the next invocation loads the previous checkpoint,
appends only the new user message, and resets per-turn graph counters. The service
emits a bounded `CheckpointLoaded` event. The shared Lab context snapshot is still
prepared and recorded for budgeting; it does not replace the native checkpoint
transcript for a continuing LangGraph thread.

The native MCP graph test replaces the graph object while reusing the same SQLite
checkpoint and thread. The continuation reads the persisted tool result and does not
send a second `tools/call` request to the fixture. This is checkpoint continuation,
not proof that an interrupted provider acknowledgement is exactly-once; a lost MCP
response remains `unknown`.

The TypeScript adapter prepares that shared snapshot before dispatch. When the shared
budget crosses its compaction threshold, it compacts the older message groups before
calling the Python service. Fake profiles use a deterministic bounded summary. Real
OpenRouter profiles use the selected model for the summary through the server-owned
credential boundary. A summary request is not retried after dispatch because its
provider outcome may be unknown.

If the graph later reports `LANGGRAPH_CONTEXT_OVERFLOW`, the Lab server performs one
recovery attempt. The adapter forces a new shared context compaction, keeps the same
Lab session and native thread, and submits a separate deterministic native execution
identity. The original provider event and the recovery event stream use separate safe
source names, so both remain ordered in one Lab evidence file. A second overflow is
retained as a provider failure.

The recovery snapshot carries `compaction.trigger = "provider_overflow"`; the Python
service reports that preparation as `ContextRecoveryPrepared`. Ordinary preflight or
non-compacted snapshots remain `ContextPrepared`. This keeps the shared context
decision visible without copying the full snapshot into the native event payload.

When a later snapshot advances `compactionRevision`, the graph emits
`CheckpointContextReplaced` and uses that prepared snapshot as the next model input.
An unchanged revision continues from the native checkpoint and appends only the new
turn. A regressed revision fails closed. This prevents a successful checkpoint from
silently defeating a newer shared compaction decision.

## Shared capabilities and tool boundary

LangGraph checkpointers provide thread-scoped short-term state. This baseline does not
add a LangGraph Store, Postgres, hosted Agent Server, LangSmith Deployment, subgraphs,
or automatic in-flight resume. Capability profile selection belongs to the common Lab
server, not the Python service. The server resolves `local-safe` or
`local-write-approved` and sends the resulting `enabledNames` and `approvedNames` in
the platform request. The Python service does not resolve profile IDs or accept
credentials from the request.

The effective baseline tools are:

- `calculator`: a bounded, pure arithmetic tool;
- `fixture_lookup`: a read-only, deterministic local provider fixture; and
- `mcp_fixture_lookup`: a server-owned read-only MCP binding to the local
  `fixture.lookup` tool; and
- `fixture_write`: a write-shaped local fixture used to test approval boundaries.

`local-safe` enables the calculator and read fixture. The write profile enables the
write fixture only after the common resolver receives a matching, unexpired approval.
The native graph checks the approval again. If `fixture_write` is enabled but absent
from `approvedNames`, the tool node emits `ToolCallRejected` with
`APPROVAL_REQUIRED`, returns a bounded error message to the model, and does not call
the fixture implementation. An approved fixture write returns a deterministic
acknowledgement; it is not an external provider write and does not establish
exactly-once side-effect semantics. This second check keeps a malformed or direct
platform request from bypassing the shared server policy.

The platform does not define a second tool catalog. The common capability catalog is
the source of profile and grant identity; the Python graph owns only the native
translation, argument validation, execution boundary, and native tool events.

For `mcp_fixture_lookup`, the Python graph's tool node performs discovery and
invocation over Streamable HTTP using the immutable binding supplied by the TypeScript
adapter. A provider-declared MCP error is a failed tool execution. A lost response,
disconnect, or post-dispatch timeout is `unknown`; the graph does not emit a completed
tool event or fabricate a checkpointed result. Cancellation observed after the blocking
HTTP read but before the response is returned wins over the response, while a response
already handed to the graph is not retroactively cancelled.

For local provider-boundary acceptance, start the fixture with
`./scripts/run_local_stack.sh local-fixture` or start the complete stack. The LangGraph
service receives `AGENTLAB_LOCAL_FIXTURE_URL` and sends `fixture.lookup` and
`fixture.write` over HTTP using the `conn_local_fixture` binding. The fixture stores
writes by idempotency key and returns a provider request ID. A disconnected read is a
bounded failure; a disconnected write is `unknown` because the provider may have
committed it before the acknowledgement was lost.

SQLite is used because it makes checkpoint creation and restart inspection observable
locally; it is not presented as the production persistence profile. The service enables
WAL journaling, `synchronous=FULL`, foreign-key checks, and a five-second busy timeout
for its process-owned connection. The service record tables and LangGraph checkpoint
tables share the file but have separate responsibilities.

On startup, legacy queued or running service records are changed to `unknown` with a
`RunReconciliationRequired` event. A later POST with the same immutable run identity
returns that persisted unknown record with `idempotent=true`; it does not start a
second graph execution. A late worker completion cannot overwrite that reconciliation
record.

Sustained admissions add an absolute deadline and model timeout to the retained
request. Startup resumes an original native checkpoint only when its run identity
matches and any recorded I/O intent is already represented in checkpoint state.
The service passes no fresh graph input, and preserves counters and call IDs.
Unresolved provider calls remain unknown. The state directory has one local
execution owner, enforced by an exclusive file lock. See
[durability](../variants/baseline/durability/README.md) for the recovery classification
and [context](../variants/baseline/context/README.md) for within-run compaction.

`GET /v1/recovery/diagnostics` is a bounded, read-only operator check. It reports
checkpoint threads with no owning service run, orphan writes, and admitted
queued/running/unknown records with no persisted checkpoint. It never adopts, resumes,
or deletes state. A `clean` response means no such rows were observed in the bounded
scan; it does not prove that a provider call completed. SQLite and Lab evidence
retention remain separate operational policies and are not performed by this endpoint.

## Observed behaviour and Lab guarantees

The following table separates what the local implementation currently observes from
what the Lab intentionally guarantees at its common runner boundary:

| Area | Observed locally | Lab guarantee |
| --- | --- | --- |
| Two turns | The same hashed `thread_id` loads the first settled checkpoint and emits `CheckpointLoaded` for the second turn. | One `sessionId` may own one active turn at a time; each admitted turn keeps its own `runId` and `clientTurnId`. |
| Model calls | Fake fixtures are deterministic; OpenRouter usage depends on the selected provider and network response. | Pre-dispatch failures may retry within the configured bound; an ambiguous post-dispatch result is never reported as success. |
| Checkpoints | SQLite checkpoints survive a service restart when they were committed before interruption. | A checkpoint alone does not prove that an interrupted provider call completed. The run becomes `unknown`/`reconciliation_required` when that outcome cannot be established. |
| Context | The TypeScript context service prepares the budget and compaction snapshot before dispatch. | Context usage is displayed from the shared snapshot; LangGraph checkpoint state is not treated as long-term memory or a second context authority. |
| Tools | Profile-selected calculator/read fixture calls are deterministic; the write fixture returns a bounded acknowledgement only after approval. | Tool names, arguments, results, approval, and call counts are validated at both the shared server boundary and the native graph boundary; no external side effect is claimed. |
| Evidence | Native events retain bounded graph, checkpoint, model, tool, retry, and recovery metadata. | Normalized Lab evidence remains owned by the Lab server and is written idempotently; secrets and arbitrary checkpoint values are excluded. |

The service exposes `GET /health`, `POST /v1/runs`, `GET /v1/runs/{executionId}`, and
`POST /v1/runs/{executionId}/cancel`. The TypeScript adapter is the supported caller
for Lab runs; direct service calls are useful for protocol learning and are not a
replacement for the server's admission, context, and evidence path.

The local SQLite profile is intentionally single-process. WAL and a busy timeout make
the process boundary observable and reduce accidental lock failures, but they do not
make SQLite a multi-worker production database. Hosted LangGraph, LangSmith, PostgreSQL,
and distributed worker deployment require separate platform plans.

## Retention and rollback

The local profile has no automatic cleanup. Platform SQLite state is retained until an
operator deliberately performs maintenance; Lab evidence under `lab/runs/` is a
separate record and is not removed when native state is reset. Before removing native
state, stop the LangGraph service, inspect `/v1/recovery/diagnostics`, preserve any
required run evidence, and remove only the explicitly selected platform state
directory. Do not use native-state cleanup as a recovery action.

To roll back this platform implementation, stop only the LangGraph service and leave
the Lab server, other platform services, and `lab/runs/` untouched. Revert the
LangGraph service, adapter, and protocol changes as one compatible versioned change;
existing evidence remains readable by the common server, while a protocol-version
mismatch must be reported as unavailable rather than silently interpreted.

## First-party references

- [Application structure](https://docs.langchain.com/oss/python/langgraph/application-structure)
- [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [Streaming](https://docs.langchain.com/oss/python/langgraph/streaming)
- [Fault tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance)
- [Run a local server](https://docs.langchain.com/oss/python/langgraph/local-server)
- [Functional API](https://docs.langchain.com/oss/python/langgraph/functional-api)
