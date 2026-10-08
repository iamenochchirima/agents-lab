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
effect and does not prove idempotent provider writes. The MCP read boundary is real but
local: discovery and invocation happen inside the native graph tool node, while the
server-owned binding supplies the endpoint and selected `fixture.lookup` tool. A lost
MCP acknowledgement is `unknown`, not a successful checkpointed tool result. Context
compaction belongs to the shared TypeScript context service before dispatch; the Python
service consumes the resulting snapshot. SQLite checkpoint state, the process-local run
registry, and the compatibility transcript bridge have separate failure and recovery
boundaries that require their own evidence.

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

The Python tool node validates the same JSON Schema with pinned `jsonschema`
4.25.1. This dependency replaces handcrafted per-tool argument checks for
registered extensions; the standard library cannot validate Draft 2020-12.
Hosted HTTP calls are bounded, interrupt their connection on cancellation, and
retain uncertain side effects as unknown outcomes.

## Invocation review and renewal

The graph has a dedicated approval node between the model and tools. It prepares
an exact-call proposal through the authenticated capability host, then uses a
native LangGraph interrupt. The interruption checkpoints pending calls and the
unfinished transcript. A decision resumes the same thread using `Command(resume)`;
it does not submit the original prompt or perform another inference while waiting.

The service persists the original admitted request alongside its SQLite lifecycle
record, so a suspended execution can be reconstructed after service restart.
Suspended rows are excluded from generic interrupted-execution reconciliation and
keep the session occupied. The resume endpoint requires the trusted host credential
and validates request, call and revision against the native interrupt. Cancellation
of a waiting execution settles it without dispatch. Arbitrary in-flight model or
source recovery is not implied by this waiting boundary.

Expired proposals can be renewed through the control plane. A renewal carries the
same request/call identity and the next revision. The native node fetches the
current proposal and interrupts again without dispatch or inference. Cached renewal
values replay as the node resumes, while the host revision cannot move backwards.
Approval/denial still targets the exact current revision. The capability host
rechecks actual decision authority immediately before external execution.

The text-only model projection includes text, structured JSON and textual resources.
Unsupported image/audio content is explicitly identified and retained in evidence.
Business-effect certainty, output validation and original content blocks stay in
native events independently of the projected model message.
