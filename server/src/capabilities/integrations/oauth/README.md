# OAuth integrations

`OAuthFlow` implements the connection lifecycle boundary: one-time state, authorization
code plus S256 PKCE, exact redirect validation, token exchange, serialized refresh, and
revocation. Provider calls accept cancellation signals. A refresh is shared across callers;
one cancelled waiter stops waiting, while the underlying refresh is aborted only when no
other waiter remains. `SecretStore` owns token material. The in-memory store is only a
deterministic fixture; production deployments must provide an encrypted store with rotation
and access auditing.

`HttpOAuthProvider` is the provider adapter used by local protocol acceptance. It sends
authorization-code, refresh, and revocation requests over HTTP and bounds token responses.
Its `authorize` method is intentionally suitable for the deterministic fixture, which
returns a test code; an interactive provider must use a browser redirect and must not
silently turn an authorization URL into a server-side login flow. The local fixture is
not a real account provider and does not replace provider-specific OAuth review.
