# LangGraph baseline variant

Status: implemented locally and registered through the common runner seam.

## Graph

The baseline is intentionally one graph with explicit model and tool nodes:

```text
START -> model -> (tools -> model)* -> END
```

The `model` node owns the model call. The `tools` node validates and executes the
effective tools selected by the shared server profile, then routes each result back to
the model. The current bounded tools are the pure `calculator`, read-only
`fixture_lookup`, server-owned MCP `mcp_fixture_lookup`, and approval-gated `fixture_write`. The fixture tools are local
provider-shaped test fixtures; they do not establish an external integration. Both
nodes emit safe request/response metadata, use LangGraph's node-attempt information,
and return only JSON-safe state. Round and tool-call limits are explicit. The graph is
compiled with `SqliteSaver` so the service can inspect checkpoints after a successful
run and after a service restart.

The common server resolves capability profiles before the runner is called. A
`local-safe` run receives `calculator` and `fixture_lookup`. A
`local-write-approved` run receives `fixture_write` only when its capability approval
matches the selected grant and has not expired. The Python graph still checks
`approvedNames` at the tool boundary: if a write call is presented without approval,
it emits a rejected tool event with `APPROVAL_REQUIRED`, returns the bounded error to
the model, and does not execute the fixture.

Supported deterministic models:

- `fake-success`
- `fake-pre-dispatch-retry`
- `fake-pre-dispatch-failure`
- `fake-provider-failure`
- `fake-ambiguous`
- `fake-timeout`
- `fake-cancel`
- `fake-delay`
- `fake-slow-success`
- `fake-context`
- `fake-context-overflow`
- `fake-tool-call`
- `fake-connected-tool`
- `fake-mcp-connected-tool`
- `fake-connected-write`

The `openrouter` provider uses `OPENROUTER_API_KEY` inside the Python service. The
Platform UI selects the model ID from the shared catalog; the key is never accepted
in a request body or returned in an event. Fake model names are reserved for tests.

`mcp_fixture_lookup` is a native graph tool node. The TypeScript runner passes only the
immutable connection selection; the Python service resolves the MCP endpoint from its
process configuration, performs bounded discovery and invocation over Streamable HTTP,
and stores the result in the LangGraph checkpoint. The endpoint, server name, selected
tool, and version are never taken from model arguments. A lost tool-call response is
reported as `unknown` and is not retried automatically.

## What this does not establish

This graph does not establish durable scheduling, automatic in-flight process recovery,
exactly-once model or tool calls, long-term memory, or hosted LangGraph/LangSmith
deployment semantics. The local fixture write is deliberately not an external side
effect and does not prove idempotent provider writes. Context compaction belongs to the
shared TypeScript context service before dispatch; the Python service consumes the
resulting snapshot. SQLite checkpoint state, the process-local run registry, and the
compatibility transcript bridge have separate failure and recovery boundaries that
require their own evidence.
