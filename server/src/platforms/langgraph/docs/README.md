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

## First-party references

- [Application structure](https://docs.langchain.com/oss/python/langgraph/application-structure)
- [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [Streaming](https://docs.langchain.com/oss/python/langgraph/streaming)
- [Fault tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance)
- [Run a local server](https://docs.langchain.com/oss/python/langgraph/local-server)
- [Functional API](https://docs.langchain.com/oss/python/langgraph/functional-api)
