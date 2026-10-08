# MCP integrations

MCP discovery and invocation stay behind `McpTransport`. A server identity and explicit
endpoint allowlist are required. Discovery returns bounded tool manifests; invocation
requires a selected manifest, a safe request ID, input validation at the adapter boundary,
timeouts, cancellation, and bounded output. Deadlines abort the child signal passed to the
MCP server; cancellation returns a classified cancelled result. Discovery alone never
grants a tool.

`HttpMcpServer` translates MCP JSON-RPC over Streamable HTTP into the provider-neutral
`McpServer` contract. It supports the legacy `2025-06-18` initialize/initialized
handshake and the current `2026-07-28` per-request protocol metadata, then performs
`tools/list` and `tools/call`. Responses, tool manifests, and error messages are bounded;
the selected server and tool version are checked again before invocation. A lost
tool-call response is `unknown`, while cancellation and deadline expiry remain separate
statuses. Only an explicitly classified `McpPreDispatchError` is retryable, and
`maxAttempts` bounds those retries; an ordinary HTTP failure during `tools/call` is
treated as ambiguous because the request may have reached the server. It does not
authorize an endpoint; callers must still pass the exact
configured endpoint through `McpTransport`'s allowlist. The local fixture's `/mcp`
endpoint is the deterministic no-Docker acceptance boundary.

Native platform runners keep their own I/O boundary: Temporal uses an Activity, Restate
uses a durable action, LangGraph uses its Python graph tool node, and Mastra uses a
registered Agent tool. Normalized evidence retains only the server/tool identity,
protocol version, lifecycle phase, bounded request identity, and provider request IDs.
It never includes raw JSON-RPC bodies or authorization headers.

## Configured generic sources

`extensions/connected-sources.ts` contributes discovered MCP tools to the shared
hosted catalog. Trusted configuration chooses aliases, risk classes and limits;
remote annotations do not grant write authority. Unselected discovery uses the
conservative `external` risk class. Admission freezes the declaration digest, and
invocation discovers the selected remote tool again before dispatch to reject
changed or missing schemas, descriptions and versions.

The generic adapter retains the complete bounded MCP result, including text,
image/resource blocks and structured content. A read `isError` result remains
a failed tool result with correlated feedback. A write error cannot establish
absence of partial effects and stops as unknown. An acknowledged write with invalid
structured output retains `effect.state=acknowledged` and `presentation=invalid`
while stopping native continuation for reconciliation. Lost acknowledgements and cancelled
or timed-out writes remain unknown and are never automatically retried. Endpoint
and resolved credential headers belong to process configuration and stay outside
the model descriptor. Credential values are redacted from returned content. A
connection-backed source resolves current headers immediately before every HTTP
request, including paginated discovery, the final tool call, legacy notifications
and best-effort cleanup. A revoke or credential rotation during the schema-check
network wait is rechecked before dispatch; its stable authority identity, rather than rotating token bytes,
defines the admitted source digest. Each invocation owns and closes its MCP client.
`trustedContext: "session"` forwards the server-owned session ID in
`X-AgentLab-Session-Id`; model arguments cannot set or override this identity.

Streamable HTTP supports the sessionless `2026-07-28` protocol and the initialized
`2025-06-18`/`2025-11-25` protocols. Legacy session IDs returned by initialization
are carried on subsequent requests. Discovery follows bounded pagination and
permits missing descriptions, supplying a short callable description. Unknown
protocol versions fail explicitly. Stdio is unsupported. Optional connection-backed
OAuth onboarding belongs to the [connection manager](../oauth/README.md); a static
Bearer source alone does not implement that flow.

The sessionless requests include the required protocol-version and client-capability
metadata in `params._meta`, alongside the HTTP routing headers. Remote tool names
retain their case-sensitive MCP identity; model-facing aliases use the catalog's
stricter naming rules. Responses must match the request ID. The adapter supports
complete tool results, not multi-round client interactions such as sampling or
elicitation; unsupported result types fail explicitly. This is a tools transport,
not a claim of full MCP client conformance. See the [MCP request metadata
contract](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)
and [tool naming rules](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool-names).

SSE replies are parsed incrementally with a total response-byte limit. Progress
and unrelated envelopes cannot complete a call: only the correlated final result
or error does. A valid final response returns without waiting for stream EOF,
and the response reader is released. Up to 32 progress notifications per tool call
retain finite progress/total values and messages bounded to 512 characters in the
sanitized source-attempt receipt, with an omitted count. Progress does not establish
completion; tokens, request envelopes and unrelated notifications are not retained.
Modern tool calls mirror supported
`x-mcp-header` properties using the protocol's header-value encoding; unsafe,
duplicate or composition/array annotations are rejected. Unsupported interactive
results remain explicit failures rather than simulated tool completion.

Hosted calls retain sanitized full `ConnectionResult` records, including each
attempt and source output, in their durable capability-call receipt. Native tool
events may use the smaller connection summary. If execution succeeds but saving
its acknowledgement fails, the pending receipt remains and the result is unknown;
recovery does not dispatch the operation again.

`HttpMcpServer.resolveHeaders(signal)` provides that request boundary. Resolution
errors happen before the external-dispatch marker, so a denied grant does not
become an unknown write. Precise transport adapters supply `isDispatched` to retain
that distinction during a credential-resolution timeout or cancellation. Legacy
adapters without the observer keep conservative timeout classification. All
credential generations actually resolved during an invocation are used to sanitize
its returned content and retained attempts, including pre-rotation values.
