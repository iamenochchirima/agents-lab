# OAuth integrations

`OAuthFlow` implements the connection lifecycle boundary: one-time state, authorization
code plus S256 PKCE, exact redirect validation, token exchange, serialized refresh, and
revocation. Provider calls accept cancellation signals. A refresh is shared across callers;
one cancelled waiter stops waiting, while the underlying refresh is aborted only when no
other waiter remains. `SecretStore` owns token material. The in-memory store is only a
deterministic fixture; production deployments must provide an encrypted store with rotation
and access auditing.

`EncryptedFileSecretStore` is a local/server implementation of `SecretStore`. It encrypts
each bounded token record with AES-256-GCM, writes files with owner-only permissions, and
atomically replaces records. The deployment supplies the 32-byte key; the store never writes
that key. Hosted deployments should replace this adapter with a managed secret store and
retain access auditing and rotation outside run evidence.

`HttpOAuthProvider` is the provider adapter used by local protocol acceptance. It sends
authorization-code, refresh, and revocation requests over HTTP and bounds token responses.
Its `authorize` method is intentionally suitable for the deterministic fixture, which
returns a test code; an interactive provider must use a browser redirect and must not
silently turn an authorization URL into a server-side login flow. The local fixture is
not a real account provider and does not replace provider-specific OAuth review.

## Connected source lifecycle

`integrations/connections.ts` owns trusted local connection definitions. It supports
anonymous sources, service-account headers referenced through environment variables,
and browser authorization for pre-registered OAuth clients. Safe summaries contain
the configured owner/resource/scopes and connection state, never credentials. The
owner is a deployment-controlled identity label; this adapter does not independently
verify a provider-specific user account or implement product login/multi-tenancy.

A source calls `binding(ref)` to freeze the authority revision and obtain a late
`resolveHeaders(signal)` function. Static values are reread on invocation; OAuth
access tokens refresh through `OAuthFlow`. Token/client-secret rotation does not
change authority identity. Configured identity or permissions changes, revocation
and reconnect advance the authority revision, so retained bindings cannot silently
use a different grant. `stateRoot` persists local revocation and its generation
across control-plane restarts. Without that option, lifecycle state is process-local.
Lifecycle mutation requests serialize per connection. Configuration generations are
persisted when the manager loads each definition, so changing configuration and
later restoring it cannot revive a previously admitted authority revision.

OAuth startup does not require contacting the provider. The bootstrap should pass
`EncryptedFileSecretStore` only with an explicitly configured deployment key. If
the key is absent, `oauthUnavailableReason` keeps OAuth sources visibly unavailable
while other sources and the control plane remain usable. The memory-store fallback
is intended for deterministic tests, not persistent production grants. Source
discovery separately reports actual endpoint availability; credential presence is
not a claim that the service is reachable.

Configured OAuth requires a client ID and exact redirect URI. Authorization state
is one-use, connection-bound, bounded and expires after ten minutes. Issuer
validation is applied before sending the authorization code; metadata-advertised
issuer responses are required. Authorization and token requests include the target
resource. The token adapter accepts Bearer tokens, bounds responses incrementally,
and prevents endpoint redirects from forwarding credentials. Omitted refresh
tokens/scopes retain the existing grant; returned refresh-token rotation replaces
the old value. Scope expansion is rejected, and a reduced grant cannot dispatch
a tool requiring removed scopes. Revocation closes local dispatch permission even
when remote revocation acknowledgement is unavailable. Local stored grants are
deleted even if metadata discovery prevents contacting the revocation endpoint.

Optional `auth.discovery` uses bounded MCP protected-resource metadata and an
allowlist of authorization issuers. A single unauthenticated resource GET inspects
401 Bearer challenges, with an 8 KiB header limit, and follows advertised
`resource_metadata` before falling back to the configured/well-known metadata URL.
The probe body is cancelled; it never consumes an unbounded event stream. Challenged
scopes must fit the trusted configured grant: wider scopes produce
`authorization_required` and reject authorization and dispatch instead of silently
expanding permissions. HTTPS resources cannot advertise HTTP metadata. It validates resource and issuer identities,
supports OAuth authorization-server metadata with OpenID metadata fallback, and
requires advertised S256 PKCE. Supported token client authentication is public
client `none` or confidential client `client_secret_post`; unsupported advertised
methods fail explicitly. Client ID metadata registration and dynamic client
registration are not implemented. This is a configured-client discovery subset,
not universal MCP authorization conformance. Remote URLs require HTTPS; loopback
HTTP is permitted for development.

Browser redirect/callback routes belong to the control plane. The fixture-only
`HttpOAuthProvider.authorize` method is never a substitute for that browser path.
OAuth state is intentionally process-local: after an API restart during onboarding,
the user reconnects. Stored grants and local revocation remain durable when their
deployment stores are configured.
