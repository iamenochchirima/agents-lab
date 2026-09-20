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
