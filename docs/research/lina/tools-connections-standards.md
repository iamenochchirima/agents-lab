# MCP, connector authentication and skill standards for Lina

Reviewed 2026-10-07. Primary-source research and proposed implementation contracts.
No live sign-in, external tool execution or interoperability test was performed.
This report accompanies [the architecture proposal](tools-architecture-research.md).

## Protocol versions must be explicit

The official versioning page identifies `2026-07-28` as current. This revision
uses per-request protocol metadata, optional `server/discover`, and supported-version
errors. `2025-11-25` and earlier use `initialize` and a session handshake. A
client supporting both needs transport-specific era detection. A recognized
modern protocol error does not mean the endpoint is legacy.
Sources: [current version](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning),
[version negotiation and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning).

Lina should record the supported and negotiated versions in adapter state, not
make `initialize` a universal graph node. Use a node named **Establish protocol
compatibility**, whose inspector shows the actual era-specific steps. The
[official TypeScript SDK protocol guide](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions)
documents separate modern and legacy behavior. Choose and pin an SDK release
only after checking its real runtime/dependency compatibility with the selected
Lina implementation language. This research does not add a dependency.

| Concern | Legacy through 2025-11-25 | Current 2026-07-28 |
| --- | --- | --- |
| Compatibility | Initialize and negotiated session capabilities | Per-request metadata; optional discovery probe |
| HTTP delivery | Session-aware POST, optional GET stream | POST with JSON or request-scoped SSE |
| Server asks for input | Server-initiated requests | Input-required result and multi-round-trip continuation |
| Change notifications | Negotiated notification stream | Subscription listen request |
| HTTP cancellation | Protocol cancellation support depends on transport | Closing request SSE is cancellation |

Modern Streamable HTTP removes protocol sessions and the GET stream endpoint.
Every RPC is a separate POST, with matching request metadata headers and support
for JSON and SSE responses. Subscription streams are separate from a tool
request's progress stream. Modern streams do not support `Last-Event-ID`
resumption. Closing a tool SSE stream signals cancellation; it does not prove a
remote side effect was undone. Legacy behaviors must remain in the legacy adapter.
Sources: [current HTTP binding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http),
[legacy HTTP binding](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[subscription pattern](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions).

## Local process and remote HTTP authentication differ

MCP's authorization specification applies to HTTP transports. Authorization is
optional; a protected HTTP endpoint uses the defined OAuth flow. Stdio servers
should obtain credentials through their environment instead of that transport
OAuth flow. An MCP server can require downstream provider credentials separately
from the credential authenticating the client to the MCP server.
Source: [authorization roles and transport scope](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

Proposed Lina configuration should therefore distinguish:

- `stdio`: executable, arguments, working directory and explicitly selected
  environment-secret references. Starting a process runs installed code.
- `streamable-http`: endpoint, supported protocol versions and authentication
  mode. Public servers need no invented OAuth screen.
- Provider-specific static HTTP credentials: an explicit supported configuration,
  not an assumption that every MCP server implements OAuth discovery.
- Native provider API: its documented credential scheme through its own adapter.

Never inherit every host environment variable into every MCP child by default.
The graph can display credential references and readiness, never token values.

## Remote MCP OAuth lifecycle

### Discover and bind the authority

Protected resource metadata identifies the authorization servers. Clients use
`WWW-Authenticate` resource metadata when present and support well-known fallback
discovery, then OAuth authorization-server or OpenID metadata. Multiple issuers
need separate client-registration/token state. One issuer's credentials cannot
be reused against another issuer merely because both serve the same connection.
Source: [authorization discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery).

### Obtain a client identity

Use a pre-registered client when configured, otherwise advertised Client ID
Metadata Document support, then supported Dynamic Client Registration fallback.
Current MCP marks DCR deprecated for compatibility, not universally required.
CIMD needs a hosted HTTPS metadata document with a matching client ID and declared
redirect URIs. A desktop-only installation still needs a valid registration
strategy; a localhost callback does not host a public CIMD document.
Sources: [client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration),
[current authorization overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

### Authorize, validate callback and exchange

Use Authorization Code with PKCE and verify advertised PKCE support. Prefer S256.
Bind each authorization attempt to its connection, selected issuer, user/account,
redirect URI, requested resource and scopes, expiry, state and PKCE verifier.
Reject wrong, expired or reused state before exchanging the code. Validate the
returned issuer under the specification's advertised/present issuer rules.
Store the verifier privately. A callback must not select a different connection
using an unchecked caller-supplied identifier.
Sources: [PKCE, redirect and token requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations),
[issuer response validation](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization#authorization-response-validation),
[OAuth security best current practice](https://www.rfc-editor.org/rfc/rfc9700).

### Use, refresh, step up and disconnect

Include the target MCP resource in authorization and token requests. Send the
access token issued by the selected authorization server for the MCP resource in the Authorization header on each HTTP request, never
in a query string. Do not pass a downstream Google/GitHub token through as an MCP
client credential. Access and refresh tokens stay in protected storage. Refresh
tokens are not guaranteed. Insufficient scope can require bounded reauthorization
using accumulated requested scopes and the current challenge.
Sources: [resource binding and scope lifecycle](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization),
[token handling requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations).

For Lina, serialize refresh per credential generation so concurrent calls cannot
race rotating refresh tokens. Atomically replace a successful refreshed record.
An invalid refresh grant enters `reauthorization-required`. Disconnect blocks new
calls and removes local credentials; revoke remotely only where the provider
supports it. Already launched work still requires outcome accounting.

OAuth readiness and permission to execute a particular tool are different
checks. Neither tool metadata nor a skill's instructions can grant account access.

## Native connector authentication needs provider adapters

A connector is an integration with an external system, not a synonym for MCP.
The same service might have both a native API and an MCP endpoint. They can share
credential-store mechanics without sharing token audiences or protocol semantics.

Google's web-server OAuth flow illustrates user authorization, token exchange,
offline access and refresh handling. Its documentation warns that a refresh token
is not returned on every authorization response. GitHub Apps distinguish app JWTs,
installation tokens and user access tokens; these identities have different
permissions and lifetimes. A universal bearer-token record cannot erase those
distinctions.
Sources: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
[GitHub App authentication identities](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app).

Proposed connector adapters own endpoint translation, provider permissions,
credential acquisition hooks, pagination, rate-limit classification and supported
idempotency/reconciliation behavior. Shared infrastructure owns secret storage,
callback correlation, refresh locking and redaction. Provider-specific scopes,
installation IDs, account choice and token exchange remain provider-specific.

Incoming webhooks and polling feed Input. Outgoing actions can be Tools or Output
and delivery operations. A single connection can serve both; it should retain
one explicit account identity while each operation retains its own permission
and effect contract. Webhook signature checking is inbound authentication, not
OAuth authorization of an outgoing tool call.

## Capability discovery and calls

Current MCP tool lists support pagination, deterministic ordering, auth-dependent
visibility and cache metadata. Definitions include schemas; tool results can carry
structured and multimodal content. Catalog availability must be refreshed according
to negotiated capabilities and cache rules. List metadata alone cannot prove
local scheduling safety or authorize operations. Preserve wire metadata alongside
the normalized tool descriptor instead of dropping protocol-specific detail.
Source: [current tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

Modern input-required results carry correlated input requests and optional opaque
server request state. Clients must not interpret that state. Follow-up requests
continue the same logical operation with matching responses; this is distinct
from replay after an uncertain connection loss. Advertise roots, sampling or
elicitation only when their complete client handlers exist. Sampling has its own
model usage and permission boundary.
Source: [multi-round-trip requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr).

Proposed registry records need stable internal identity, model-visible alias,
connection and account scope, upstream name, schema revision, adapter reference,
availability, local effect/conflict policy and original protocol metadata.
Reject collisions rather than silently overriding. Preserve advertised versus
locally trusted effect annotations. Revalidate a changed definition before launch;
do not silently execute a different tool under the old model-visible alias.

## Skills use a separate discovery and activation lifecycle

Agent Skills defines a directory with `SKILL.md`, metadata and Markdown instructions,
plus optional scripts, references and assets. Progressive disclosure loads metadata
first, the instructions when activated, and resources when required. The optional
`allowed-tools` field is experimental across implementations.
Source: [Agent Skills specification](https://agentskills.io/specification).

Lina should inventory skills with source and revision, let Context include their
metadata, and record activation of the selected instructions. Reading a skill is
context preparation. Running its script is an execution operation with an ordinary
permission/environment boundary. A skill is not automatically a subagent or an
installed executable plugin. Its declared allowed tools must be interpreted under
explicit host policy; declarations cannot bypass the configured permission model.

## Proposed lifecycle acceptance cases

These are verification requirements for future implementation, not completed tests:

| Area | Required cases |
| --- | --- |
| Transport | Stdio process exit; malformed frame; JSON/SSE response; supported and unsupported protocol era |
| Discovery | Paginated list; empty list; duplicate alias; changed schema; auth-specific tool visibility |
| OAuth | Correct callback; state/issuer/account mismatch; expiry; replay; denied consent; missing registration strategy |
| Credential lifecycle | Expired access token; concurrent refresh; rotated refresh; invalid grant; scope step-up; disconnect |
| Execution | Independent overlap; conflict ordering; capacity limits; partial failure; progress versus settled result |
| Interruption | Not-started call skipped; known cancellation; remote uncertain effect; wait requiring correlated input |
| Isolation | Separate accounts/connections; no secret fields in model context, exported design or normal traces |

The studies establish architecture requirements and likely implementation choices.
They do not establish interoperability, account safety or measured speedups. Those
require real adapters exercised against safe local protocol servers and documented
provider test accounts after implementation is authorized.
