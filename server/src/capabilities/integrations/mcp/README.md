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
statuses. It does not authorize an endpoint; callers must still pass the exact
configured endpoint through `McpTransport`'s allowlist. The local fixture's `/mcp`
endpoint is the deterministic no-Docker acceptance boundary.

Native platform runners keep their own I/O boundary: Temporal uses an Activity, Restate
uses a durable action, LangGraph uses its Python graph tool node, and Mastra uses a
registered Agent tool. Normalized evidence retains only the server/tool identity,
protocol version, lifecycle phase, bounded request identity, and provider request IDs.
It never includes raw JSON-RPC bodies or authorization headers.
