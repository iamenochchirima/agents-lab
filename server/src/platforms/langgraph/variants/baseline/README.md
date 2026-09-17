# LangGraph baseline variant

Status: implemented locally and registered through the common runner seam.

## Graph

The baseline is intentionally one graph with explicit model and tool nodes:

```text
START -> model -> (tools -> model)* -> END
```

The `model` node owns the model call. The `tools` node validates and executes the
allowlisted calculator, then routes the result back to the model. Both nodes emit safe
request/response metadata, use LangGraph's node-attempt information, and return only
JSON-safe state. Round and tool-call limits are explicit. The graph is compiled with
`SqliteSaver` so the service can inspect checkpoints after a successful run and after a
service restart.

Supported deterministic models:

- `fake-success`
- `fake-pre-dispatch-retry`
- `fake-pre-dispatch-failure`
- `fake-provider-failure`
- `fake-ambiguous`
- `fake-timeout`
- `fake-cancel`
- `fake-delay`
- `fake-context`
- `fake-tool-call`

The `openrouter` provider uses `OPENROUTER_API_KEY` inside the Python service. The
Platform UI selects the model ID from the shared catalog; the key is never accepted
in a request body or returned in an event. Fake model names are reserved for tests.

## What this does not establish

This graph does not establish durable scheduling, automatic in-flight process recovery,
exactly-once model or tool calls, long-term memory, context compaction in the Python
service, or hosted LangGraph/LangSmith deployment semantics. SQLite checkpoint state,
the process-local run registry, and the canonical transcript bridge have separate
failure and recovery boundaries that require their own evidence.
