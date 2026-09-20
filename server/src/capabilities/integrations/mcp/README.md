# MCP integrations

MCP discovery and invocation stay behind `McpTransport`. A server identity and explicit
endpoint allowlist are required. Discovery returns bounded tool manifests; invocation
requires a selected manifest, a safe request ID, input validation at the adapter boundary,
timeouts, cancellation, and bounded output. Deadlines abort the child signal passed to the
MCP server; cancellation returns a classified cancelled result. Discovery alone never
grants a tool.

`HttpMcpServer` translates MCP JSON-RPC over Streamable HTTP into the provider-neutral
`McpServer` contract. It performs initialization, `tools/list`, and `tools/call`, bounds
responses, and forwards the caller's abort signal to `fetch`. It does not authorize an
endpoint; callers must still pass the exact configured endpoint through `McpTransport`'s
allowlist. The local fixture's `/mcp` endpoint is the deterministic no-Docker acceptance
boundary.
