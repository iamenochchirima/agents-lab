# MCP integrations

MCP discovery and invocation stay behind `McpTransport`. A server identity and explicit
endpoint allowlist are required. Discovery returns bounded tool manifests; invocation
requires a selected manifest, a safe request ID, input validation at the adapter boundary,
timeouts, cancellation, and bounded output. Deadlines abort the child signal passed to the
MCP server; cancellation returns a classified cancelled result. Discovery alone never
grants a tool.
