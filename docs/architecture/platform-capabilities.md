# Platform capabilities

Platform runs select capabilities through a server-owned profile. The profile is an
allowlist and policy decision, not a request from the model. The common capability code
defines bounded JSON-safe manifests, grants, risks, approvals, skills, and connection
results; it does not import a platform SDK or call a provider.

```text
Normal Chat
  -> server-composed connected-agent profile for enabled, available packages
Run Setup / Compare
  -> explicitly selected server-owned profile
server admission
  -> immutable manifest + capabilities.json + CapabilityResolutionRecorded
capability catalog
  -> resolved grants + context-only skill projections
platform adapter
  -> native Temporal activity, Restate action, LangGraph node, Mastra tool, or Workflow step
local or configured connection
  -> bounded result + native lifecycle evidence
```

The built-in `local-safe` profile contains `calculator`, `fixture_lookup`, and the
`research-summary` skill. `fixture_write` is separate and remains unavailable until the
run includes a matching approval. A skill becomes an untrusted developer-context
message; it has no grants, authority, secret access, or execution path. Run evidence
redacts skill bodies but retains safe IDs, versions, digests, and policy decisions.

Normal platform Chat is composed by the capability management service when it loads
the catalog. It preserves the read-only `local-safe` foundation (calculator,
`fixture_lookup`, and the `research-summary` skill), adds tools from each enabled,
available managed package, and exposes discovery/loading tools for enabled skills.
It excludes disabled or unavailable packages. Individual tool approval modes remain
attached to their grants, so automatically including a write tool does not
automatically approve its invocation. Admission freezes the resulting tool schemas
and authority for that run; later catalog changes affect subsequent admitted turns, including turns in the
same conversation. A pending call keeps its original frozen descriptor.

Connection seams are deliberately independent:

- MCP discovery and invocation require an allowlisted endpoint and bounded tool/result
  payloads. Discovery does not authorize a tool. The `local-mcp-safe` profile binds the
  same selected `fixture.lookup` server tool into Temporal, Restate, LangGraph, and
  Mastra, but each platform performs the network work at its own native boundary.
- Direct API requests preserve provider request IDs, retry read-only transient failures,
  and never automatically retry a write after a timeout or dispatch ambiguity.
- OAuth uses one-time state, S256 PKCE, exact HTTP(S) redirects, serialized refresh,
  revocation, and a secret-store interface. Tokens never enter manifests, prompts,
  evidence, or browser storage.

The platform owns durability and native evidence. Temporal keeps activity history and
retries, Restate keeps journaled named actions, LangGraph keeps SQLite checkpoints, and
Mastra keeps its native agent/workflow lifecycle, and Vercel Workflows keeps
local World history, durable steps and revision-specific hooks. The local fixtures prove these seams
without claiming that every external provider has been integrated. In a full local
stack, the provider-shaped fixture is a separate HTTP process. `conn_local_fixture` is
an opaque allowlisted binding; its endpoint is configured by the server and never comes
from model output. Read calls may use bounded retries, while a dispatched write that
loses its acknowledgement is recorded as unknown and requires reconciliation.

See the [capability module](../../server/src/capabilities/README.md), the
[platform implementation plan](../../development/implementation-plans/platforms/completed/platform-capabilities-and-integrations.md),
and the [development playground](../../development/playground/platform-capabilities/README.md).

Capability resolution is recorded before platform dispatch. The ordered event contains only
profile/policy identifiers, bounded decision codes, grant operations, approval state, and
opaque connection references. `metrics.json` derives capability counts from the persisted
event stream so a platform inspection that omits earlier server events cannot erase approval
or connection measurements.

Normalized event identity is scoped to the platform, run, attempt, source, and source
sequence. New event producers may provide `platform` and a stable `attemptId`; source
sequence ordering is then enforced independently for each scoped stream. An exact replay
returns the retained event, while different content for the same identity is a conflict and
a gap in one stream is an ordering error. Legacy schema-v1 events without these optional
fields keep their existing `runId:source:sourceSequence` IDs and are read as one legacy
attempt, so existing run evidence remains readable while new platform retries can be
deduplicated independently.

Action review controls have per-action identities: request, revision and retained
decision/renewal ID. Multiple decisions of the same event kind are retained;
repeating one immutable control preserves its first record. The evidence store
allocates control source sequence under the same per-run queue as native event
projection, preventing concurrent controls from claiming one sequence. This is
single-store-owner serialization, not a distributed writer lock. Lifecycle controls
without an action identity keep their historical singleton-per-kind behavior.
The observer can reconstruct missing control projections from authoritative saved
review records after an interrupted host write; it cannot invent authorization or
infer tool completion from delivery acceptance. Existing historical events are
not rewritten or renumbered.

## Operational evidence and retention

Normalized lifecycle events are the authoritative run record. The server derives
`metrics.json` from those events and the platform result, including model usage, duration,
tool attempts and duration, retries, approval outcomes, cancellations, timeouts, and
unknown external outcomes when the source reports them. `logs/operations.jsonl` is a
bounded diagnostic projection: it records classifications, safe operation/request IDs,
durations, and retry counts without prompts, provider bodies, headers, or tokens. Losing a
diagnostic log entry must not change the run result.

Run evidence is retained for inspection and is never rewritten during credential rotation.
The local fixture's process state may be discarded with the local stack. Connection
metadata and encrypted secret records have a separate retention and deletion policy owned
by the configured secret store. Rotate credentials there, reauthorize the opaque
connection reference, and leave historical run evidence intact. Hosted secret stores and
provider-specific retention remain deployment decisions rather than claims of this local
profile.

For MCP specifically, the run evidence retains the selected endpoint reference, server
name, protocol version, tool name/version, discovery or invocation phase, and bounded
provider request IDs. It excludes raw JSON-RPC messages, headers, credentials, and
unbounded tool output. The local acceptance path supports both the legacy fixture
handshake and the current per-request MCP protocol shape without requiring Docker.

For rollback, set `AGENTLAB_CONNECTED_CAPABILITIES_ENABLED=false` before starting the server.
The API keeps affected profiles visible with an unavailable reason, resolution fails closed,
and pure inline tools remain usable.

## Connected package authority and invocation review

Generic package sources use the connection manager separately from the legacy local
fixture connections above. Admission freezes the tool descriptor's safe connection
reference, resource, scopes and authority revision. Credentials resolve immediately
before source I/O; token rotation preserves authority while revoke/reconnect or
configuration changes invalidate old bindings. No model or browser input can supply
a new endpoint, account owner or secret header.

A grant may allow automatic execution, require an upfront tool grant, or permit
proposing an invocation for review. The last mode does not authorize effects at
admission. Its decision binds the retained call, source and argument digest, and
native continuation resumes the unfinished turn. Renewal advances the review without
inference or effects. Skills cannot grant tool access or approve an action.

The [connected architecture](extensible-capabilities.md),
[action-review contract](../../server/src/capabilities/reviews/README.md), and
[connected tools guide](../guides/connected-agent-tools.md) describe these
paths and their explicit local-deployment and recovery limits.
