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

### Synthetic live eval transport

Runs selecting the `agent-harness-live` experiment use an opt-in AI SDK v2 OpenRouter
transport inside the existing Mastra `Agent.generate()` loop. It retains actual mapped
messages, tool definitions, responses and tool results through eval-only events, without
authentication headers. Requests enforce the selected approved free ID, zero-price
provider ceilings, disabled fallback and a 512-token output limit. SDK retries are zero;
provider failures stop the trial. Context compaction is refused for these short probes.
Ordinary interactive runs continue using the existing model router.

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

Generic Mastra SDK tools use the admitted JSON Schema directly. All wrappers
share the run call counter and execute through the common tool registry.
