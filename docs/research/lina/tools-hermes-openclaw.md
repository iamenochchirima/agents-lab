# Tools, connections and extensions in Hermes and OpenClaw

Reviewed 2026-10-07. Source audit for Lina's future real harness and its Studio design simulation. This is research, not an implementation plan or a claim that Lina already supports these capabilities.

## Evidence boundary

| System | Inspected revision | Scope |
| --- | --- | --- |
| Hermes | `0e21933114c911075782d5744cee5403996d38ae` | Local sibling checkout of the official NousResearch repository; MCP, connector gateway, plugin manager, skills and tool executor |
| OpenClaw | `912685f442286233fbbd40762482d98598299497` | Local sibling checkout of the official OpenClaw repository; native MCP runtime, requester identity, plugin registration, skills, native channel adapters and agent core |
| Official documentation | Accessed 2026-10-07 | Versionless pages are corroborating/current documentation, not evidence of exactly what an older release supported |

These revisions are newer than the revisions in the earlier Context studies. Findings here must not be silently attributed to those earlier revisions. No upstream tests, live server connections, OAuth exchanges, tool executions or performance measurements were performed. Source-level assertions describe the inspected paths, not end-to-end interoperability guarantees.

MCP has distinct protocol eras. Hermes explicitly negotiates between legacy initialization and modern `server/discover`; OpenClaw's inspected bundle path calls the SDK connection lifecycle. Neither agent's initialization patterns should be presented as the universal current MCP specification. The main Tools research should separately select the protocol version and SDK for Lina.

## Main findings

1. Tool execution and capability availability are separate lifecycles. Both agents keep discovery/configuration, credential resolution, registration, model-facing schemas, policy and execution distinct in code.
2. Parallel capability is established, but admission is explicit. Hermes uses safe parallel segments and barriers; OpenClaw has batch-level sequential admission. Both default externally registered MCP servers to sequential unless server configuration opts in. Hermes additionally serializes its inspected same-server MCP RPC handler.
3. Authentication is not one generic token. Hermes distinguishes MCP-native OAuth, configured headers/process environment and first-party managed connector gateway credentials. OpenClaw distinguishes shared and requester-scoped MCP OAuth, auth profiles and plugin-resolved connections. Native channel account authentication is another boundary.
4. Plugins are packages capable of contributing more than tools. Skills are discoverable instructions/resources with loading and environment rules; they are not automatically a tool implementation.
5. Reconnecting a connection is not equivalent to safely replaying a call. The inspected implementations already contain safeguards against replaying uncertain side effects.

## Hermes

### Registration and availability

Built-in tool modules self-register a schema, handler, toolset and availability check. `discover_builtin_tools` scans candidate modules for registration statements before importing them. The registry supports scoped overlays, rather than one process-wide namespace being sufficient for multiplexed profiles. Plugin registration tracks ownership so unloading can remove contributions or restore displaced entries. Explicit permission is required for a plugin to override a built-in tool. [Registry][h-registry], [plugin tool registration][h-plugins]

MCP discovery loads server configurations, connects or registers cached schemas, filters names, normalizes model-facing JSON schemas and installs dispatch handlers. Registration records original server/tool provenance, read-only hints and consuming-profile trust. Provider-safe names are separate from raw MCP names. Portable plugins retain the server names declared in `mcp.json`; collisions are refused rather than silently relabeled as a different integration. [MCP discovery][h-discovery], [MCP registration][h-registration], [schema conversion][h-schema], [portable manifests][h-manifest]

A schema-cache entry can make a tool discoverable before its server starts. First invocation performs the lazy connection; live discovery removes cached tools the server no longer serves. This is availability projection, not proof that a tool is executable or authenticated. [Lazy discovery][h-discovery], [schema cache][h-cache]

The connection ledger is keyed by `(owner_scope, server_name)` in profile-multiplexed deployments. Two profiles with a `github` server and different credentials do not automatically share a connection. A profile can adopt another live connection only when route and credentials match; consuming-profile trust and parallel admission remain profile-specific. [Connection scope][h-scope], [registration trust][h-registration], [parallel scope policy][h-discovery]

### MCP transports, protocol and lifecycle

The inspected transport implements local stdio, Streamable HTTP and legacy SSE. Local execution owns command, arguments, working directory, environment, stderr and child-process cleanup. HTTP accepts configured headers, TLS verification and optional client certificates. Cross-origin redirect handling has an explicit stricter mode for configured plugin headers. Streamable HTTP can fall back to SSE after a recognizable incompatibility, and the established fallback is remembered for reconnects. [Transport][h-transport], [process configuration][h-config]

`_negotiate_session` has three protocol modes:

- `auto`: try legacy `initialize`, then modern `discover` only when the error indicates a modern-only endpoint and the SDK exposes the method.
- `stateless`/`modern`/`2026-07-28`: try `discover`, then the legacy handshake on an ordinary error.
- `legacy`/`handshake`: use initialization only.

Timeouts do not trigger the other negotiation method. The HTTP header is seeded from the handshake version when attempting legacy negotiation, rather than incorrectly using the latest modern protocol version. There is also an endpoint compatibility workaround that can complete a successful wire handshake at the version offered by the client. This is agent-specific compatibility behavior, not a recommendation to weaken protocol negotiation. [Negotiation and transport][h-transport], [version constants][h-mcp]

The server task owns connect, serve, reconnect, park/retry and shutdown. HTTP keepalive is enabled by default; stdio keepalive is explicitly configured. Keepalive can use `list_tools` when ping is unsupported. Failed sessions can be parked with tools deregistered, followed by a timed or explicitly triggered revival. Circuit-breaker/error state, in-flight calls, child liveness, idle recycling and scoped teardown exist separately from the model loop. [Server lifecycle][h-server-run], [call recovery][h-handlers]

### Authentication

For remote MCP, `_build_oauth_auth` uses Hermes' OAuth provider when configured. OAuth state lives under the selected profile's `HERMES_HOME/mcp-tokens/`, with token and client-information files created at restrictive permissions and atomic writes. Browser callback, manual/headless interaction and a device-flow path exist. Interactive authorization is suppressed in inappropriate noninteractive contexts rather than assuming a running tool call can always open a browser. [OAuth storage and interaction][h-oauth], [OAuth provider][h-oauth-provider], [device flow][h-device]

Refresh is fenced across processes with a per-store file lock held through the token endpoint request. The provider rereads peer-updated credentials and fails closed if ownership cannot be established. This addresses refresh-token rotation: two processes must not spend the same single-use refresh token. Issuer binding and provider-specific metadata/redirect compatibility handling are explicit. These paths need independent Lina decisions; their existence does not establish generic provider interoperability or encrypted-at-rest storage. [Refresh fence/storage][h-oauth], [provider refresh logic][h-oauth-provider]

Configured HTTP headers and stdio environment values are distinct credential delivery mechanisms. They should be resolved at their owning transport scope, not copied into the model's JSON schema. MCP-native OAuth authenticates Hermes to the MCP endpoint; authentication from that MCP server to Google/GitHub/etc. may be separately owned by the server.

Hermes also has a first-party managed connector path. `PortalConnectorClient` lists connector catalogs, tools, accounts and policies using a Nous portal access token. `ToolGatewayClient` supports search, schema acquisition, account status, connection starts and execution. Gateway bearer attachment is restricted to exact configured managed origins, preventing an arbitrary MCP/vendor URL from inheriting a first-party token. This is a hosted connector broker architecture, not an ordinary direct MCP connection. [Portal client][h-portal], [gateway client][h-gateway], [origin-bound bearer][h-managed-auth]

The gateway execution client generates one dispatch-local idempotency key and reuses it for a permitted execute retry. Connection/authorization starts are not retried because the gateway cannot deduplicate those starts. The external service's actual deduplication guarantee is not proven by the client header. A persistent connection operation models target transitions, user/runtime actors, changed sequence and settlement independently of a tool result. [Gateway retry semantics][h-gateway], [connection operation][h-operation]

### Plugin and skill lifecycles

Hermes supports native plugin manifests (`plugin.yaml`, including v2 fields) and portable `plugin.json` packages. Declared version/API/dependencies/configuration are not equivalent to enforcement: the manifest parser deliberately warns and continues for newer/unknown manifest fields; dependency admission is a separate path. A manifest alone is not a trust grant. [Manifest parsing][h-manifest], [dependency admission][h-admission]

Plugin context APIs register tools, hooks, provider implementations, skills, MCP declarations, platforms and other contributions. Registration ownership and unload callbacks are tracked. Timed-out loads mark their registration context abandoned, preventing a late worker from publishing new registrations after the load is rejected. Tools override capability consent is checked separately. [Plugin manager and context][h-plugins]

Third-party Python plugins run in-process by default. Optional `plugins.isolation: host` uses a separate plugin-host process per profile. The host supports serialized facades/provider proxies, but native platform adapters and approval transports require live process-bound objects and are refused there. Bundled plugins remain in-process. A process boundary provides crash/interpreter separation; it is not evidence of a filesystem/network security sandbox. [Plugin isolation][h-isolation]

Skills are directories with `SKILL.md` and optional scripts/references/assets. `skills_list` exposes short metadata; `skill_view` loads full instructions and linked files. Catalog eligibility considers platform, environment and installed apps; plugin skills enter the same discovery surface. Explicit loading and catalog visibility differ: the code comments state that explicit skill lookup does not simply enforce every list-time platform/disabled gate. Skills can have setup/readiness and secret-capture behavior, so loading is more than reading a name. Scripts still execute through the permitted tools/environment; a skill is not itself an authenticated remote adapter. [Skills catalog and loading][h-skills], [skill serving][h-skill-plugin], [skill readiness][h-skill-setup]

### Call execution, parallelism and outcomes

Hermes splits model-issued batches into ordered parallel/sequential segments. Known stateless reads, selected tools and path-scoped filesystem operations can run in parallel; interactive tools, unknown tools and malformed arguments are barriers. Overlapping paths involving a writer close the current parallel segment, while read/read overlap is allowed. Bridge calls are peeled to their underlying tool for admission, avoiding a generic `tool_call` wrapper erasing metadata. [Batch planner][h-planner], [main dispatch][h-run]

MCP parallel admission requires the server's `supports_parallel_tool_calls` setting. However, the inspected MCP handler holds `server._rpc_lock` during the RPC, and the server creates that as an `asyncio.Lock`. Same-server RPCs therefore serialize in this handler even if the outer planner admits parallel worker slots; calls to distinct server tasks can overlap. Measure adapter-level behavior before claiming same-server throughput improvement. [MCP parallel admission][h-discovery], [handler lock][h-handlers], [server lock construction][h-mcp]

The concurrent executor uses bounded workers, emits call progress, handles timeouts/interrupts and appends results in the original call order. It attempts cleanup and gives running tasks a grace period; Python threads cannot simply be force-killed by a timeout. Completion of a batch must not be equated with proving every external effect stopped. [Executor][h-executor]

An untrusted-server write-capable MCP call is approval-gated before any transport work, including lazy process startup. Unknown read-only status is treated as effect-capable. Compatibility default server trust is `full`; that is an observed default, not a blanket recommendation for Lina. Read-only annotations come from server metadata, so Lina must decide the trust basis for relying on them. [Registration trust rules][h-registration], [call-time trust gate][h-handlers]

Recovery distinguishes pre-dispatch stdio death from death while a call is in flight. The former can respawn and retry once; the latter reconnects without replay and reports uncertainty. Session-expiry replay is restricted to read-only calls; authentication failures are handled as pre-dispatch rejection. Caller timeout/interrupt cancellation remains distinct from reconnect teardown. [Call recovery][h-handlers]

Results are converted from MCP content/structured content into the agent's representation; image results can become native multimodal envelopes where supported. Utility tools expose MCP resources and prompts. This projection is a different responsibility from raw transport, canonical execution evidence and later context retention. [Result projection and utilities][h-handlers], [tool-result messages][h-planner]

## OpenClaw

### Connection configuration and authentication

The inspected native MCP configuration supports stdio, SSE and Streamable HTTP, separate connection/request timeouts, tool filters, configured headers/env, OAuth and TLS/mTLS settings. A valid command-bearing definition takes stdio precedence. `supportsParallelToolCalls` defaults false. Startup environment keys that can hijack interpreters/loaders are blocked. These are native bundle-runtime capabilities; external CLI backends can own their own MCP adapters and differ. [Configuration schema][o-config], [transport resolution][o-transport-config], [transport construction][o-transport]

MCP-native OAuth uses SDK provider interfaces backed by canonical SQLite state. Client metadata declares authorization-code/refresh grants and a public client; optional client metadata URL and scope are configurable. State is one browser round-trip value, while tokens/client information/discovery/PKCE/pending authorization data are stored separately. Saved refresh tokens are bound to their discovered authorization server. Provider refresh and login/logout use state leases and transactional ownership assertions; network work is aborted if its owning lease is lost. [OAuth provider][o-oauth-provider], [OAuth store][o-oauth-store], [OAuth flow and leases][o-oauth]

`oauth.identity` separates `shared` from `per-requester`. Requester identity derives from message channel, agent account and sender ID, deliberately excluding conversation/session identity. Thus the same requester can use the same connection across conversations without sharing it with a different sender. Configured `authProfileId` uses another credential source with runtime refresh rather than assuming all OAuth credentials belong to the MCP-native store. [OAuth identity][o-identity], [auth-profile runtime][o-profile]

Plugins can register MCP connection resolvers. The resolver receives requester context and supplies URL/headers; these are credential material, not safe log/config/fingerprint fields. Static servers and requester-scoped servers are partitioned. A process-local keyed digest detects rotation without persisting credential preimages; active requester connections are periodically revalidated, so revocation is not necessarily instantaneous. The inspected revalidation window is five minutes, an implementation value rather than Lina's requirement. [Connection resolver][o-resolver]

The official transport documentation corroborates saved stdio/HTTP/OAuth shapes and notes that backend-owned transports forward relevant settings differently. It is versionless documentation and should not replace the pinned source audit. [Current official transport guide](https://docs.openclaw.ai/cli/mcp/transports)

### MCP runtime and catalog lifecycle

A per-server runtime owns the SDK client/transport, lazy catalog load, tool metadata validators, catalog invalidation, backoff and leases. Connecting has bounded initialization/discovery and cancellation; closing a client/transport is terminal for that pair. After close, subsequent use rebuilds the connection. Dynamic tool-list notifications invalidate the catalog, and discovery refreshes filtered definitions. Paginated lists have explicit deadlines and bounds. [Server runtime][o-runtime], [connect/dispose lifecycle][o-lifecycle], [pagination][o-pagination]

Repeated request/protocol failures pause a server rather than letting one broken endpoint consume the whole turn. Expired stateful HTTP sessions and repeated timeouts retire the session and trigger rebuilding for later requests. The inspected guarded request path throws the failing call's error; it does not blindly replay the call on the fresh session. OAuth HTTP handling separately permits a challenge/refresh retry. These are distinct recovery categories. [Guarded requests][o-runtime], [OAuth fetch][o-oauth-fetch]

Raw tool/server names map to stable provider-safe callable names with collision handling and preserved provenance. Per-server include/exclude filters and session deny rules apply before exposure. A catalog-only projection cannot execute; executable tools carry the runtime callback. Output schemas validate structured result content, including the case of a successful tool advertising an output schema but returning no structured content. [Materialization][o-materialize], [metadata validators][o-metadata]

MCP resources/prompts become generated utility tools where allowed. The result projector converts text/images/resource references and structured output at the model boundary. Raw `_meta` is not simply passed through to model/code-mode consumers. Audio is represented as descriptive text in the inspected agent content projection. This is a model capability constraint, not proof that the transport cannot receive audio. [Content projection][o-content], [utility materialization][o-materialize]

### Plugins, native adapters and skills

Plugin discovery builds candidates from manifests and configured load paths, then records provenance and admission/configuration/SDK compatibility separately. The loader warns about an open allowlist capable of loading non-bundled plugins. Registration APIs bind plugin identity to contributions, including tools, channels, services, hooks and requester-scoped MCP connection resolvers. Enabled configuration, plugin manifest, installation provenance and tool permissions are separate questions. Native plugin code is not automatically sandboxed because it was registered through an API. [Discovery][o-discovery], [provenance][o-provenance], [registration API][o-api], [network/channel registrars][o-network]

Native messaging channels have account/config/auth/secrets/setup/security/pairing/gateway/outbound/lifecycle adapter surfaces. Telegram resolves its configured account and bot token through channel-specific code. This is channel integration authentication; the human sender's authorization to use an agent or a requester-scoped business connection is a separate decision. Not every connector should be forced into an MCP server, and sharing a service name does not justify sharing its account credentials. [Channel contract][o-channel], [Telegram channel][o-telegram]

Skills load from workspace roots and library selections, with snapshot provenance, eligibility and configured filtering. Runtime environment overrides expose requested keys, block loader/host-execution keys, preserve externally managed values and acquire/release active override ownership. Skills metadata can describe a required primary environment/API key, but that is not an OAuth flow or a permission to publish the key to context. [Skill run loading][o-skills], [skill environment lifecycle][o-skill-env]

Plugin `before_tool_call` can change parameters or block calls; `after_tool_call` observes outcomes; `tool_result_persist` is a separate persistence hook. Consequently validation and permissions cannot be assumed complete before the last argument-changing hook. OpenClaw's scoped execution validator is attached to the individual call through asynchronous context so concurrent calls do not inherit one another's validation. [Hooks][o-hooks], [execution validation boundary][o-validation]

### Parallel execution and failure semantics

Materialized MCP tools advertise `executionMode: parallel` only when server configuration opts in, otherwise `sequential`. The inspected embedded agent core decides a batch is sequential if the run config requires it or **any resolved tool in that batch** requires sequential mode. This is more conservative than Hermes' segmented planner. On the parallel path, started calls settle together and tool result messages are committed in ordered slots. An admission failure cannot settle the batch ahead of its already running prefix. [MCP execution metadata][o-materialize], [agent-core batch execution][o-loop]

This establishes support for parallel execution, not a universal conflict inference algorithm. The reviewed OpenClaw path does not provide Hermes' filesystem path-overlap planner; backend-specific tools, execution modes and policy hooks govern admission. Lina should explicitly describe its own conflict metadata rather than claim that the model or generic JSON schema proves independence.

MCP invocation propagates a per-call abort signal and validates successful output against the registered output schema. Runtime disposal tries graceful termination and forced process-group cleanup, reporting `uncertain` when cleanup cannot be established. That uncertainty concerns resource cleanup; it is not a durable ledger proving whether an external write occurred. [Runtime calls][o-runtime], [lifecycle cleanup][o-lifecycle]

## Implications for Lina's real architecture

These are recommendations inferred from the evidence, not already implemented Lina behavior.

| Responsibility | Implementation boundary Lina needs | Grounding |
| --- | --- | --- |
| Capability configuration | Nonsecret connection definition, package/source/version, enabled state and policy scope | Both agents separate configuration from executable catalogs |
| Credential resolution | Credential reference plus account/requester/tenant scope; resolve secret at adapter use, outside model context | Hermes profile scope; OpenClaw requester partition and resolvers |
| Authentication workflow | Explicit user interaction, callback/device/manual capabilities, pending state, refresh/revocation/logout | Both native OAuth implementations and hosted connector starts |
| Adapter lifecycle | Discover/connect, validate protocol/capabilities, health, refresh, retire/disconnect | Both MCP runtime implementations; native channel lifecycle |
| Tool registration | Canonical identity, raw and exposed names, original schema, provider projection, provenance and catalog revision | Names/schema/metadata registries in both agents |
| Skill loading | Metadata catalog, selected instruction/resources, readiness and scoped environment lifecycle | Both skill subsystems |
| Call policy | Validate final arguments after mutation, resolve current permissions, bind approved operation and identity | Hermes trust gate; OpenClaw hook/validation boundary |
| Scheduling | Parallel independent calls; explicit shared-resource/server limits and barriers | Both parallel paths, with materially different policies |
| Dispatch | Built-in, direct API, MCP and hosted-broker adapters implement common invocation/outcome semantics while retaining native detail | Hermes gateway/MCP split; OpenClaw channel/MCP split |
| Recovery | Differentiate not started, rejected, failed, timed out, cancelled and possible effect; reconnect independently of replay | Both inspected failure paths |
| Publication | Call IDs, raw evidence/artifacts, structured outcomes and a separate model-visible projection | Both result adapters and ordered transcripts |

A connection definition is not a tool call. Plugin installation is not plugin activation; activation is not permission to use every contribution. A skill appearing in the catalog is not a connected account. OAuth consent is not approval for a particular destructive operation. These distinctions need visible nodes/contracts even when several share the same block heading in Studio.

The seven-node execution proposal remains useful but is insufficient by itself. It needs an upstream capability availability flow, and explicit links to Credentials/Authentication, Safety/permissions, Context, Execution Environment and plugin/skill lifecycle owners. The final node grouping belongs to the main research synthesis, rather than being inferred from where either upstream repository happened to place a file.

## Required baseline versus experiments

| Category | Treatment |
| --- | --- |
| Per-call IDs, matching outcomes, schema validation, scope-bound credentials, lifecycle ownership, cancellation semantics | Correctness requirements; do not treat unsafe alternatives as neutral candidates |
| Parallel support with explicit independence/limits | Baseline capability; policy can vary by resource and adapter |
| OAuth refresh ownership, state/PKCE/issuer handling and token redaction | Authentication correctness, not a latency experiment that may drop the guarantees |
| Catalog selection, deferred discovery, eager/lazy connection, batching limits | Credible performance/usability variables, evaluated under the same permissions and discovery freshness |
| Hermes-style safe segments versus OpenClaw-style whole-batch sequential barrier | Genuine scheduler policy alternatives where both preserve defined conflicts; compare workload-dependent latency and correctness |
| Result representation and context retention | Compare model-visible projections while keeping full evidence and output validation |
| In-process versus process-host extensions | Deployment/trust choice first; experiments can measure startup/latency/crash containment within acceptable deployment requirements |

Useful failure fixtures include token expiration during concurrent calls; rotated refresh token with two workers; requester credential revocation; MCP schema change after model exposure; server disappearing before versus after dispatch; partial batch success; cancellation with an already running write; plugin unload with live calls; and a hook changing arguments after preliminary approval. They are proposed validation cases, not upstream tests we ran.

## Remaining uncertainties

- The exact SDK version selected for Lina and its supported MCP eras remain open. Hermes conditional SDK feature checks and compatibility paths mean source alone does not determine which behavior every installation gets.
- Neither audit establishes remote service deduplication, exactly-once writes, credential-store encryption or application-wide tenant isolation.
- An MCP `readOnlyHint` or parallel opt-in is metadata, not proof of effect safety. Lina must define trusted configuration/provenance and unknown defaults.
- The broker-side authentication, third-party token vault and provider-specific connector behavior behind Hermes' managed gateway are not present in the client paths audited here. Do not invent their storage/refresh guarantees.
- OpenClaw has multiple execution backends. The embedded runtime's scheduler and adapters should not be claimed for Codex/Claude/Gemini CLI backends without a separate adapter audit.
- The Hermes per-server RPC lock means outer concurrency is not sufficient evidence of same-server parallel RPC execution. This warrants source or runtime verification before copying that policy.

## Pinned source references

[h-registry]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/registry.py
[h-plugins]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/hermes_cli/plugins.py
[h-discovery]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_tool_discovery.py
[h-registration]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_tool_registration.py
[h-schema]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_tool_schema.py
[h-manifest]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/hermes_cli/plugins_manifest.py
[h-cache]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_schema_cache.py
[h-scope]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_tool_scope.py
[h-transport]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_tool_transport.py
[h-config]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_tool_config.py
[h-mcp]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_tool.py
[h-server-run]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_tool_server_run.py
[h-handlers]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_tool_handlers.py
[h-oauth]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_oauth.py
[h-oauth-provider]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_oauth_provider.py
[h-device]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/mcp_oauth_device.py
[h-portal]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/connectors/portal/client.py
[h-gateway]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/connectors/gateway/client.py
[h-managed-auth]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/managed_gateway_auth.py
[h-operation]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/connectors/operation.py
[h-admission]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/hermes_cli/plugins_admission.py
[h-isolation]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/hermes_cli/plugin_isolation.py
[h-skills]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/skills_tool.py
[h-skill-plugin]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/skills_tool_plugin.py
[h-skill-setup]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/tools/skills_tool_setup.py
[h-planner]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/agent/tool_dispatch_helpers.py
[h-run]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/run_agent.py
[h-executor]: https://github.com/NousResearch/hermes-agent/blob/0e21933114c911075782d5744cee5403996d38ae/agent/tool_executor.py
[o-config]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/config/zod-schema.mcp-server.ts
[o-transport-config]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-transport-config.ts
[o-transport]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-transport.ts
[o-oauth-provider]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-oauth-provider.ts
[o-oauth-store]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-oauth-store.ts
[o-oauth]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-oauth.ts
[o-identity]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-oauth-identity.ts
[o-profile]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-auth-profile.runtime.ts
[o-resolver]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-connection-resolver.ts
[o-runtime]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/agent-bundle-mcp-runtime.ts
[o-lifecycle]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-client-lifecycle.ts
[o-pagination]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-pagination.ts
[o-oauth-fetch]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-oauth-fetch.ts
[o-materialize]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/agent-bundle-mcp-materialize.ts
[o-metadata]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-tool-metadata.ts
[o-content]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/mcp-content.ts
[o-discovery]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/plugins/loader-discovery.ts
[o-provenance]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/plugins/loader-provenance.ts
[o-api]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/plugins/registry-api.ts
[o-network]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/plugins/registry-registrars-network.ts
[o-channel]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/channels/plugins/types.plugin.ts
[o-telegram]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/extensions/telegram/src/channel.ts
[o-skills]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/skills/runtime/embedded-run-entries.ts
[o-skill-env]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/skills/runtime/env-overrides.ts
[o-hooks]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/plugins/hooks.ts
[o-validation]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/src/agents/agent-tools.execution-validation.ts
[o-loop]: https://github.com/openclaw/openclaw/blob/912685f442286233fbbd40762482d98598299497/packages/agent-core/src/agent-loop.ts
