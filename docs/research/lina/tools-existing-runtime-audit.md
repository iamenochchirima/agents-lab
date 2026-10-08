# Lina Tools and connections: existing runtime audit

Research date: 2026-10-07. Verified repository HEAD: `95ff83fc537111b18c68d74bbcf2f337f3f8c630`.

This is a source inspection of the current working tree, including existing uncommitted Lina design work. It is not a production readiness assessment or a claim that external account connections have been exercised. No executable code was changed and no tests were run for this audit. Existing test coverage is identified separately from observed source behavior.

## What already exists

The repository has three distinct surfaces. They should not be described as one runtime:

1. [Server capability layer](../../../server/src/capabilities/README.md): reusable tool, connection, policy, plugin-manifest and skill contracts composed by platform variants.
2. [Studio reference assembly](../../../studio/assemblies/reference-agent/README.md): a real but controlled modular execution fixture, with deterministic model responses, arithmetic and a simulated computer page. It has no external network, filesystem or subprocess capability.
3. [Lina architecture](../../../apps/web/src/features/lina/README.md): proposed architecture and scripted graph playback. Its Tools region is still empty; the execution handoff does not perform tool operations.

| Area | Implemented source | Reuse potential and limit |
| --- | --- | --- |
| Tool registration | Server `ToolRegistry` and Studio injected registrations | Useful explicit boundaries; two different contracts, not an already unified Lina registry |
| Run grants and policy | Server capability catalog and resolver | Server-owned profiles and bounded admission evidence; not a general user account connection manager |
| Direct API execution | `DirectApiClient`, injected `DirectApiAdapter`, local HTTP fixture runtime | Real bounded HTTP request boundary; only provider-shaped fixture tools are configured |
| MCP | `McpTransport`, `HttpMcpServer`, local MCP runtime and read tool | Local configured HTTP endpoint, discovery and invocation; no remote MCP account authentication |
| Connector OAuth | `OAuthFlow`, `HttpOAuthProvider`, secret-store adapters | Real lifecycle code with fixture provider; missing interactive/provider-specific composition |
| Plugins | `PluginManifestValidator` | Metadata validation only; no executable loader, installation, hooks or marketplace |
| Skills | `SkillLoader`, built-in `SkillCatalog` | Bounded allowlisted context packages; no authority grants or executable skill runtime |
| Parallel batches | Single-call dispatch APIs | No scheduler in the inspected shared capability modules or Studio reference control; Lina concurrent playback absent |

## Registration, authority and adapters

[ToolRegistry](../../../server/src/capabilities/tools/registry.ts) registers implementations separately from enabled names. `definitions()` projects enabled definitions; `resolve()` refuses disabled names (lines 24–85). `validateCall()` bounds raw arguments and delegates validation to the registered implementation, and `execute()` revalidates arguments (lines 87–163). This is hand-written implementation validation, not automatic evaluation of arbitrary JSON Schema.

`authorize()` is a separate call. It denies `external` risk in this slice and requires explicitly approved names for writes (lines 114–129). `execute()` does not itself invoke `authorize()`. A future assembly must enforce authorization ordering, rather than assuming an accepted argument object grants permission.

[CapabilityCatalog](../../../server/src/capabilities/catalog.ts) owns profiles and resolves grants/policy plus selected skills before admission. The browser selects a profile; it cannot define its own grant. MCP selection records include endpoint reference, server name, protocol version, remote tool name and a local tool version. The default capability definitions represent calculator and local read/write/MCP fixtures, not installed arbitrary integrations.

[Studio Tool Use](../../../studio/modules/tool-use/src/contract.ts) exposes `definitions`, `validate` and `dispatch`, with an injected `ToolExecutor`. Its [documentation](../../../studio/modules/tool-use/README.md) explicitly leaves Safety authorization and environment access outside the module. The [reference assembly constructor](../../../studio/assemblies/reference-agent/src/index.ts) selects calculator and computer-click registrations (lines 183–219); the [kernel](../../../studio/agent-kernel/src/text-turn.ts) validates and dispatches calls and composes the scoped environment/Safety adapter. This offers a useful separation to carry forward, but its types and statuses differ from the server registry.

For Lina, reuse responsibility boundaries first. Decide deliberately whether one contract is adopted or adapters bridge them. Do not silently merge `timed-out` versus `timed_out`, JSON receipts versus textual content, or per-run capability grants versus module-local registrations.

## MCP: real local boundary, incomplete general connector

[HttpMcpConnectionRuntime](../../../server/src/capabilities/integrations/mcp/runtime.ts) accepts only `conn_local_mcp_fixture`, requires the server-owned local selection, constructs a fresh server/transport, discovers tools and invokes the matching tool (lines 21–76). Its default endpoint comes exclusively from `AGENTLAB_LOCAL_FIXTURE_URL` plus `/mcp` (lines 106–114). No model argument can choose an endpoint.

[McpTransport](../../../server/src/capabilities/integrations/mcp/local-transport.ts) enforces an exact endpoint allowlist and selection consistency, a maximum of 64 tool manifests, safe request IDs, argument byte limits, result limits and per-attempt deadlines. It propagates a child abort signal and retries only an explicitly classified pre-dispatch error (lines 40–149). Discovery does not authorize a call.

The actual local MCP tool has a strict key validator and explicit immutable binding: [mcp-fixture.ts](../../../server/src/capabilities/tools/mcp-fixture.ts). This validates that one fixture tool. The general transport validates manifest name/version/size, not arbitrary invocation arguments against the discovered schema (transport lines 240–246). General imported tools therefore still need a schema-validation boundary.

[HttpMcpServer](../../../server/src/capabilities/integrations/mcp/http-server.ts) translates JSON-RPC `tools/list` and `tools/call` into the local contract. Important limitations for reuse:

- Its options and `headers()` contain no credential resolver or `Authorization` header (lines 6–11, 154–164). It is not connected to `OAuthFlow` or `SecretStore`.
- There is no stdio process transport, MCP server pool, persistent connection lifecycle, discovery pagination, list-change subscription, reconnect policy or endpoint-specific account manager in these files.
- It keeps structured JSON objects or text. Images, audio and resource content are not preserved as general MCP content blocks (lines 65–92).
- HTTP responses are buffered before the byte limit is checked. SSE parsing reads the buffered body and selects the first nonempty data event; it is not a general streaming/progress client. JSON-RPC response IDs are not checked against the request ID (lines 126–152, 176–205).
- The file and README claim support for `2026-07-28` protocol metadata and a changed handshake, alongside the local `2025-06-18` fixture. This audit reports the code branch, not protocol compliance. Verify these claims against the current official specification before reuse.
- Server identity is constructed from configured binding metadata; the local equality checks do not independently authenticate a remote server.

The current runtime re-discovers for each request. Catalog stability, schema drift and approval invalidation remain design work. Remote MCP tool versions default to `1.0.0` unless `_meta.agentlabVersion` exists; this local convention is not proof of an upstream standardized tool version.

## OAuth and secret ownership

[OAuthFlow](../../../server/src/capabilities/integrations/oauth/flow.ts) creates random one-time state and S256 PKCE, exchanges a code, stores tokens, shares refresh work per connection reference and revokes/deletes credentials (lines 39–115). Refresh cancellation accounts for concurrent waiters. [EncryptedFileSecretStore](../../../server/src/capabilities/integrations/oauth/encrypted-file-store.ts) encrypts token records with AES-256-GCM, uses owner-only directories/files and atomic replacement; the deployment supplies the key (lines 29–111). These are concrete reusable pieces.

However, the current flow is not complete account onboarding:

- Pending state stores verifier, redirect URI and scopes, but not the owning connection, user or expiry (flow lines 40–51). The error message says “expired”; no expiry check is implemented.
- `complete(ref, state, code)` writes to the caller-supplied reference, without binding it to the reference passed to `begin()` (lines 62–69). An authenticated callback owner must be established before extending this API.
- `begin()` checks URL syntax and HTTP(S), not an allowlist of registered redirect URIs or configured authorization authorities. There is no client ID, client-auth strategy or protected-resource/audience parameter in this flow.
- `HttpOAuthProvider.authorize()` makes a server-side GET expecting a test code. Its [README](../../../server/src/capabilities/integrations/oauth/README.md) explicitly requires a browser redirect for interactive providers; this method must not be presented as login for a real account.
- Token exchange/refresh/revocation are HTTP adapters with configurable endpoints, but not provider registration, MCP authorization discovery, scope negotiation or a callback route.
- Serialized refresh is process-local. Multi-process token rotation, refresh/revoke races, access auditing and managed secret-store integration are not supplied by these classes.

The connector credential boundary must remain server-owned. The model and run evidence receive an opaque connection reference and safe status; adapters resolve credentials at dispatch. Model-provider authentication is a separate boundary: for example, the [Temporal OpenRouter adapter](../../../server/src/platforms/temporal/variants/baseline/models/openrouter.ts) uses the model provider key and does not configure an MCP or SaaS connector. A working model login does not imply a connected external account.

## Execution and outcome gaps to retain in the design

[DirectApiClient](../../../server/src/capabilities/integrations/direct-api/client.ts) retries configured HTTP failures only for reads and records attempts, provider IDs and classified outcomes (lines 40–77). A timed-out write or explicit `DispatchUnknownError` becomes unknown. The fixture HTTP runtime supplies an idempotency key for writes and classifies lost write acknowledgements.

Inspection reveals limits that the new architecture should explicitly resolve:

1. The generic direct-API catch path can retry an unclassified exception even for writes. Unknown classification relies on adapters correctly signaling an ambiguous dispatch. Do not advertise a universal “writes never replay” guarantee from the comment alone.
2. Cancellation is a lifecycle status, not proof of effect rollback. A dispatched write can remain uncertain after cancellation. The same distinction needs to survive MCP and Tool Use normalization.
3. MCP invocation timeout is `timed_out`, and certain malformed/oversized post-dispatch responses become `failed`; these statuses alone do not establish whether a side effect occurred.
4. The MCP runtime's `unavailable()` helper hardcodes top-level `status: failed`, even when its attempt status is cancelled (runtime lines 121–150). Preserve and reconcile terminal status consistently in a future adapter.
5. Server `ToolRegistry.execute()` signals timeout but directly awaits the implementation. A non-cooperative implementation can keep the wait alive; Studio Tool Use has a separate raced wait and explicitly treats in-flight uncertain failures conservatively.
6. Call argument validation, execution permission, retry eligibility and effect certainty are separate facts. A safe schema or MCP discovery result does not establish the others.

The [Studio reference control loop](../../../studio/modules/control/src/single-turn.ts) awaits calls in a `for` loop (lines 90–112), records each result, and stops on rejected/uncertain outcomes. The inspected shared tool registries dispatch one call at a time and provide no batch scheduling contract. These observations do not claim every platform variant is sequential. Lina's [Execute tool batch node](../../../apps/web/src/features/lina/executionBlock.ts) already describes bounded parallel independent calls as a required proposed baseline; its text also acknowledges that playback still scripts single-call outcomes. [Prepare tool context](../../../apps/web/src/features/lina/contextBlock.ts) requires matching catalog definitions and call IDs, but uses design fixtures rather than the server catalog.

## Plugins and skills

[PluginManifestValidator](../../../server/src/capabilities/plugins/manifest.ts) validates trusted IDs, exact declared capabilities, permissions and resource limits. Its source kind is currently `local_builtin`. The comment at lines 135–140 explicitly excludes dynamic import, subprocess and plugin execution. A manifest's `maxConcurrentCalls` is metadata validation, not an implemented scheduler. A plugin runtime will need a loader lifecycle and a registration API, plus clear ownership of hooks, tools, connectors and skill contributions.

[SkillLoader](../../../server/src/capabilities/skills/loader.ts) supports explicit package allowlists, size limits, digests and selection by IDs/tags/phrases. Filesystem packages use `root/<id>/<version>/skill.json` plus `SKILL.md`; unallowlisted directories are skipped before parsing (lines 98–128). Loaded context is labeled untrusted with no authority or grants. The default [SkillCatalog](../../../server/src/capabilities/skills/catalog.ts) contains one built-in research-summary package and profiles select skills before admission. External skill roots, on-demand skill tools and progressive resource loading are not connected into a general harness. Do not equate this loader with the broader ecosystem's script-capable skill packages.

## Grounded direction for Lina

Separate capability setup from invocation while retaining one executable catalog:

- Connections/integrations own endpoint configuration, account ownership, credential lifecycle, transport instances and safe availability.
- Extensions own trusted plugin loading and contribution registration. Skills contribute instruction/resource packages to Context; executable helpers still need tool/environment authorization.
- Tools own resolution against a versioned catalog, runtime argument validation, permission handoff, bounded parallel scheduling, dispatch, per-call outcomes and publication.
- Execution Environment/adapters perform actual operations. Safety owns permission decisions. Context projects permitted definitions and selected results. Turn Execution owns the model loop and whether to continue.
- Run evidence captures selected identities, catalog/schema digests, safe connection references, grants, call IDs, attempt IDs and effect certainty. Secrets and raw authorization headers never enter graph contracts, model context or evidence.

Reusable source should inform those boundaries, but does not remove the need to design general MCP authentication, external provider adapters, plugin activation, dynamic capability changes or parallel scheduling. Those are real implementation gaps, not optional performance experiments.

## Existing verification evidence to consult

The inspected [integration unit tests](../../../server/tests/capabilities/integrations.test.ts) cover local MCP allowlisting, deadlines, cancellation and pre-dispatch retry classification; direct API bounded retry/unknown writes; and OAuth PKCE, state reuse and shared refresh. [Secret-store tests](../../../server/tests/capabilities/oauth-secret-store.test.ts) cover encrypted persistence and invalid references. [Plugin tests](../../../server/tests/capabilities/plugins.test.ts) and [skill tests](../../../server/tests/capabilities/skills.test.ts) exercise their respective boundaries. [Platform MCP integration checks](../../../server/integration-tests/platform-mcp-matrix.test.ts) and the [Temporal restart check](../../../server/integration-tests/temporal-mcp-restart.test.ts) are local fixture evidence.

These tests were read, not executed in this audit. They do not establish remote OAuth interoperability, general MCP spec conformance, production provider behavior or concurrent Lina execution.
