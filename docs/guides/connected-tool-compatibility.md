# Connected tool compatibility

This matrix describes the implementation inspected on 2026-10-08. Supported means
the Lab implements the stated subset; it does not establish compatibility with
every third-party service. Local fixtures exercise the adapter contracts. Scripted
native runs measure orchestration, while real-model runs measure actual decisions.

## Platforms and authority

| Area | Implemented contract | Verification and limits |
| --- | --- | --- |
| Mastra, LangGraph, Temporal and Restate `baseline` | Native model loops invoke the shared capability host; automatic, upfront tool-grant and exact invocation review are distinct modes | Retained scripted native review reports exercise pause, renewal, resume and waiting-run reconstruction. Other variants are not covered by this claim. |
| Catalog admission | Schemas, limits, source digest and safe connection authority are frozen for the run | Catalog/host checks cover invalid arguments, denied grants and changed source rejection. Refresh changes future catalogs; changed authority requires readmission. |
| Invocation review | Version-1 protected proposal records bind call, arguments, turn, catalog/source, connection identity, revision and expiry; decisions cannot expand grants | Review checks exercise duplicate/conflicting decisions, expiry, renewal and cancellation. Native recovery reports cover the pending-review boundary, not every crash point during inference or external effects. |
| Local ownership | Connection `owner` is a trusted deployment configuration label; mutation/callback APIs require loopback callers | This is not authenticated tenant identity or verified provider account identity. A reverse proxy needs an explicit trust design; do not expose administrative routes as a public login system. |
| Frontend | Connection states and connect/refresh/revoke, actual argument review, approve/deny, review renewal and retained-decision continuation | Typecheck/bundle and focused identity checks passed. An actual browser approve/deny walkthrough remains unverified. Chat shows rejection, acknowledgement, invalid result and uncertain-effect labels; expandable tool entries show certainty evidence, response validity, provider request IDs, returned data and source receipt links. |

## HTTP API bindings

| Capability | Supported subset | Limit |
| --- | --- | --- |
| Requests | Configured GET, POST, PUT, PATCH and DELETE on one configured origin | No arbitrary model-chosen endpoint or OpenAPI import. |
| Argument mapping | Destination-to-top-level-argument mappings for encoded path segments, query, permitted headers and body | Response selectors support bounded explicit JSON property paths; no general expression engine. Credential/transport headers cannot be overwritten by model bindings. |
| Encoding | JSON and URL-encoded form; omitted bindings preserve legacy GET-query/JSON-body behavior | Multipart and bounded artifact-reference upload/download are not implemented. Model host-file paths provide no upload authority. |
| Responses | Bounded text or JSON, optional mapped output schema and configured request-ID header (default `x-request-id`) | Response mapping selects JSON property paths. No automatic pagination traversal. |
| Pagination | One GET page per call, explicit cursor argument/query binding and next-cursor response selector | Cursors are bounded to 2048 characters; mapped result is `{value,nextCursor}`. The model decides whether to call again. |
| Idempotency | Optional configured provider header receives a hash of stable run/turn/call identity | The provider must implement the header's semantics. Independently generated calls have different keys; no exactly-once business-action guarantee. |
| Execution | One generic adapter attempt, deadline and propagated cancellation | A read may be explicitly called again. An unresolved dispatched write is not retried. |

The [HTTP adapter contract](../../server/src/capabilities/integrations/direct-api/README.md)
includes a configuration example. The parameter/form/idempotency fixture exercises
encoded values and rotating credentials without editing platform loops. A separate
one-page fixture checks cursor bounds, response mapping and provider request IDs.

## MCP HTTP tools

| Capability | Supported subset | Limit |
| --- | --- | --- |
| Protocol selection | Explicit `2026-07-28` sessionless requests; `2025-06-18` and `2025-11-25` initialize/initialized compatibility | Other revisions fail configuration. This is a configured tools client, not full MCP conformance. |
| Operations | `tools/list` with bounded pagination and `tools/call` | Resource/prompt discovery or retrieval, sampling, elicitation, task extensions, stdio and arbitrary process/plugin installation are not implemented. Embedded tool-result resources are distinct from a resources client. |
| Declarations | Input/output schemas, case-sensitive remote names, configured model aliases, missing-description fallback and drift revalidation before call | Alias collisions and repeated/excessive cursors reject discovery. Remote annotations cannot grant permissions. |
| HTTP replies | Bounded JSON and incrementally decoded SSE; only the correlated final result/error completes a call | SSE returns before stream EOF. Progress consumes the byte budget and is retained separately in source-attempt diagnostics (32 notifications, 512-character messages, omitted count); unrelated envelopes cannot complete the call. No independent long-lived server notification stream or stream replay. |
| Current metadata | Protocol/client metadata, method/name routing headers and valid `x-mcp-header` primitive properties with encoded values | Unsafe, duplicate and unsupported composition/array annotations exclude the declaration. Unsupported interactive results fail explicitly. |
| Session cleanup | Legacy session headers retained within each owned client; best-effort bounded DELETE on close | Fresh client per hosted invocation. Lost cleanup acknowledgement does not establish remote session expiry. |
| Results | Bounded content blocks and structured content retained in canonical results/receipts | Native model projection supports text, JSON and textual resources. Retained image/audio blocks do not imply native multimedia model input. |

The [MCP adapter contract](../../server/src/capabilities/integrations/mcp/README.md)
describes dispatch and result semantics. Local checks cover paginated discovery,
schema drift, rich failed feedback, header encoding and an SSE result on a stream
that deliberately remains open, including bounded/redacted progress evidence.

## Authentication and lifecycle

| Mode | Supported contract | Limit |
| --- | --- | --- |
| Anonymous | Explicit configured connection without credential headers | Availability still depends on real source discovery. |
| Static service credentials | Header-to-environment references resolved before discovery/invocation | Static Bearer configuration is not OAuth onboarding. Credential rotation preserves authority; legacy captured headers remain supported but secret changes alter their source digest. |
| Configured OAuth | Pre-registered client ID, exact configured redirect, PKCE S256, resource indicator, one-use expiring callback state and issuer validation | Public `none` and confidential `client_secret_post` token authentication only. No dynamic registration or Client ID Metadata Document registration. |
| MCP OAuth discovery | Single unauthenticated resource GET; bounded 401 Bearer `resource_metadata`/`scope`; exact protected-resource identity; allowlisted issuer; OAuth metadata with OpenID fallback | Challenged scopes beyond configured permission reject authorization with `authorization_required`; no automatic grant expansion. Requires an already configured client ID. No third-party provider browser acceptance established. |
| Token refresh | Single-flight refresh, omission-preserving refresh token/scopes and rotation; recheck authority before dispatch | Tokens do not enter model descriptors or safe summaries. OAuth state during onboarding is process-local; restart requires a new authorization request. |
| Persistence/revoke | Deployment encrypted secret store plus persisted lifecycle generations; revoke closes local dispatch and deletes local grants even if metadata/remote revocation fails | Missing encryption key makes OAuth unavailable while startup continues. Remote revocation is best effort. Tests use memory secrets; production bootstrap does not fall back to memory grants. |
| Source availability | Offline optional packages remain unavailable; explicit refresh re-discovers and replaces future catalog contributions | Credential presence is not service health. Frozen admissions do not acquire changed tools/scopes automatically. |

Remote connection/auth metadata endpoints require HTTPS; loopback HTTP is allowed
for development. HTTPS protected resources cannot downgrade advertised metadata to
HTTP. See the [connection/OAuth contract](../../server/src/capabilities/integrations/oauth/README.md).

## Effects, evidence and retained older runs

Execution status, business-effect certainty and presentation validity are separate
fields. Reads report no mutation. A valid write reply establishes acknowledgement;
only an explicit provider contract establishes confirmation or no-effect rejection.
HTTP errors without that contract, lost/cancelled write replies, MCP write errors
and invalid acknowledged write output stop continuation as unknown. Reconciliation
uses a separate inspection/read action; no automatic repair is claimed.

Before dispatch, the host exclusively creates a version-1 call receipt. Concurrent
or repeated calls with identical identity share/replay the result; changed arguments
under that identity reject. A retained pending receipt or a lost durable
acknowledgement remains unknown after reconstruction and is never redispatched.
Completed receipts retain sanitized full source attempts/replies. This deduplicates
a call ID, not independently proposed business actions.

Catalogs, receipts and review records currently use schema version 1. New connection,
approval, effect and presentation fields are optional for historical catalogs/results.
Absent approval mode retains legacy upfront policy, and missing effect metadata
does not become inferred confirmation. A manifest without a tool catalog uses the
original built-in projection. Existing hosted manifests still require matching
frozen source identity to execute: source changes fail closed, rather than silently
migrating old authority. Native workspace configuration is rejected with an explicit
external-provider migration message; historical workspace evidence remains readable.

Focused catalog, host, review, connected-source and connection fixtures exercise
these boundaries. They do not prove arbitrary crash recovery, universal provider
compatibility or production readiness. Native file access is optional through a
separate document provider; no shared VM or native filesystem capability is required.
