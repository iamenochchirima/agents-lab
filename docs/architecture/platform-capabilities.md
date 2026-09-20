# Platform capabilities

Platform runs select capabilities through a server-owned profile. The profile is an
allowlist and policy decision, not a request from the model. The common capability code
defines bounded JSON-safe manifests, grants, risks, approvals, skills, and connection
results; it does not import a platform SDK or call a provider.

```text
Chat / Compare
  -> profile ID and optional approval reference
server admission
  -> immutable manifest + capabilities.json
capability catalog
  -> resolved grants + context-only skill projections
platform adapter
  -> native Temporal activity, Restate action, LangGraph node, or Mastra tool
local or configured connection
  -> bounded result + native lifecycle evidence
```

The first local profile contains `calculator`, `fixture_lookup`, and the
`research-summary` skill. `fixture_write` is separate and remains unavailable until the
run includes a matching approval. A skill becomes an untrusted developer-context
message; it has no grants, authority, secret access, or execution path. Run evidence
redacts skill bodies but retains safe IDs, versions, digests, and policy decisions.

Connection seams are deliberately independent:

- MCP discovery and invocation require an allowlisted endpoint and bounded tool/result
  payloads. Discovery does not authorize a tool.
- Direct API requests preserve provider request IDs, retry read-only transient failures,
  and never automatically retry a write after a timeout or dispatch ambiguity.
- OAuth uses one-time state, S256 PKCE, exact HTTP(S) redirects, serialized refresh,
  revocation, and a secret-store interface. Tokens never enter manifests, prompts,
  evidence, or browser storage.

The platform owns durability and native evidence. Temporal keeps activity history and
retries, Restate keeps journaled named actions, LangGraph keeps SQLite checkpoints, and
Mastra keeps its native agent/workflow lifecycle. The local fixtures prove these seams
without claiming that every external provider has been integrated.

See the [capability module](../../server/src/capabilities/README.md), the
[platform implementation plan](../../development/implementation-plans/platforms/active/platform-capabilities-and-integrations.md),
and the [development playground](../../development/playground/platform-capabilities/README.md).
