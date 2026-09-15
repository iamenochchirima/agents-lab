# LangGraph baseline variant

Status: implemented locally; common Lab registration is pending the shared integration handoff.

## Graph

The baseline is intentionally one graph and one node:

```text
START -> model -> END
```

The `model` node owns the model call. It emits safe request/response metadata, uses LangGraph's node-attempt information, and returns only JSON-safe state. The graph is compiled with `SqliteSaver` so the service can inspect checkpoints after a successful run and after a service restart.

Supported deterministic models:

- `fake-success`
- `fake-pre-dispatch-retry`
- `fake-pre-dispatch-failure`
- `fake-provider-failure`
- `fake-ambiguous`
- `fake-timeout`
- `fake-cancel`

The optional `openrouter` provider uses `OPENROUTER_API_KEY` inside the Python service. It is never accepted in a request body or returned in an event.

## What this does not establish

This graph does not establish durable scheduling, automatic process recovery, exactly-once model calls, tools, side-effect idempotency, long-term memory, or hosted LangGraph/LangSmith deployment semantics. Those require separate variants and their own evidence.
