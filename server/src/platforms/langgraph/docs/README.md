# LangGraph baseline notes

## What is implemented

The baseline is a small `StateGraph` with one model node. The graph is compiled with `SqliteSaver`, invoked with a stable `thread_id`, and consumed through the platform-local FastAPI service. The service streams LangGraph `v2` updates, tasks, and checkpoint parts into a redacted native event log.

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

## Persistence and tool boundary

LangGraph checkpointers provide thread-scoped short-term state. This baseline does not
add a LangGraph Store, Postgres, hosted Agent Server, LangSmith Deployment, subgraphs,
human approval, or automatic in-flight resume. It exposes only the Lab's bounded pure
`calculator` tool when the request enables it; it does not define a second tool catalog.
SQLite is used because it makes checkpoint creation and restart inspection observable
locally; it is not presented as the production persistence profile. The service enables
WAL journaling, `synchronous=FULL`, foreign-key checks, and a five-second busy timeout
for its process-owned connection. The service record tables and LangGraph checkpoint
tables share the file but have separate responsibilities.

On startup, queued or running service records are changed to `unknown` with a
`RunReconciliationRequired` event. A later POST with the same immutable run identity
returns that persisted unknown record with `idempotent=true`; it does not start a
second graph execution. A late worker completion cannot overwrite that reconciliation
record.

## Observed behaviour and Lab guarantees

The following table separates what the local implementation currently observes from
what the Lab intentionally guarantees at its common runner boundary:

| Area | Observed locally | Lab guarantee |
| --- | --- | --- |
| Two turns | The same hashed `thread_id` loads the first settled checkpoint and emits `CheckpointLoaded` for the second turn. | One `sessionId` may own one active turn at a time; each admitted turn keeps its own `runId` and `clientTurnId`. |
| Model calls | Fake fixtures are deterministic; OpenRouter usage depends on the selected provider and network response. | Pre-dispatch failures may retry within the configured bound; an ambiguous post-dispatch result is never reported as success. |
| Checkpoints | SQLite checkpoints survive a service restart when they were committed before interruption. | A checkpoint alone does not prove that an interrupted provider call completed. The run becomes `unknown`/`reconciliation_required` when that outcome cannot be established. |
| Context | The TypeScript context service prepares the budget and compaction snapshot before dispatch. | Context usage is displayed from the shared snapshot; LangGraph checkpoint state is not treated as long-term memory or a second context authority. |
| Tools | The baseline exposes only the pure calculator with bounded calls and rounds. | Tool arguments, names, results, and call counts are validated at the native boundary; side-effecting tools are out of scope here. |
| Evidence | Native events retain bounded graph, checkpoint, model, tool, retry, and recovery metadata. | Normalized Lab evidence remains owned by the Lab server and is written idempotently; secrets and arbitrary checkpoint values are excluded. |

The service exposes `GET /health`, `POST /v1/runs`, `GET /v1/runs/{executionId}`, and
`POST /v1/runs/{executionId}/cancel`. The TypeScript adapter is the supported caller
for Lab runs; direct service calls are useful for protocol learning and are not a
replacement for the server's admission, context, and evidence path.

The local SQLite profile is intentionally single-process. WAL and a busy timeout make
the process boundary observable and reduce accidental lock failures, but they do not
make SQLite a multi-worker production database. Hosted LangGraph, LangSmith, PostgreSQL,
and distributed worker deployment require separate platform plans.

## First-party references

- [Application structure](https://docs.langchain.com/oss/python/langgraph/application-structure)
- [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [Streaming](https://docs.langchain.com/oss/python/langgraph/streaming)
- [Fault tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance)
- [Run a local server](https://docs.langchain.com/oss/python/langgraph/local-server)
- [Functional API](https://docs.langchain.com/oss/python/langgraph/functional-api)
