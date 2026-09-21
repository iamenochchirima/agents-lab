# Mastra baseline harness variant

The baseline is a direct-agent call with Lab-owned context and a bounded native tool:

```text
Lab manifest → Lab context snapshot → Mastra Agent.generate() → Lab evidence projection
```

It uses Mastra's native TypeScript runtime and accepts either a deterministic local
fake model or an opt-in OpenRouter model. The calculator is registered with the shared
tool registry and exposed through Mastra's native tool interface. The `local-mcp-safe`
profile also registers the server-owned `mcp_fixture_lookup` binding as a native Mastra
tool; discovery and invocation cross the local Streamable HTTP boundary from the tool
execution path. Context sessions, snapshots, token budgets, and transcript continuation
belong to the Lab; Mastra Memory, Mastra Storage, workflows, and durable execution are
not enabled in this variant. The runner is process-local, so an in-flight generation is
not recoverable after a server restart.

The MCP binding is immutable for the run. The endpoint and remote `fixture.lookup` tool
are resolved from server configuration, not from model arguments. A provider-declared
failure is failed, while a lost acknowledgement is `outcome_unknown`; neither is
converted into a successful final response by the agent runner.
