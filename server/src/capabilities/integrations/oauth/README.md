# OAuth integrations

`OAuthFlow` implements the connection lifecycle boundary: one-time state, authorization
code plus S256 PKCE, exact redirect validation, token exchange, serialized refresh, and
revocation. Provider calls accept cancellation signals. A refresh is shared across callers;
one cancelled waiter stops waiting, while the underlying refresh is aborted only when no
other waiter remains. `SecretStore` owns token material. The in-memory store is only a
deterministic fixture; production deployments must provide an encrypted store with rotation
and access auditing.
