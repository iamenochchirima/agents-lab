# Integrations

Provider-neutral connection definitions for MCP, OAuth, and direct APIs.

The integration boundary is deliberately narrower than a provider SDK. It accepts an
opaque connection reference, bounded request input, a per-attempt request ID, and a
redacted result. Credentials are resolved by a `SecretStore` implementation and never
become part of a run manifest, browser response, or model context.

The local implementations in this directory are deterministic process-local seams for
platform conformance tests. They prove validation, cancellation, retry, idempotency, and
unknown-outcome behaviour without requiring Docker or an external account. A provider
adapter must preserve those semantics and add provider-specific evidence behind its
platform-owned native boundary.

## Safety rules

- Remote MCP endpoints are allowlisted configuration, never model-provided URLs.
- MCP discovery is not authorization; selected tools are revalidated at invocation.
- Read-only API failures may use bounded retries. A dispatched write that times out is
  `unknown`, not an automatic retry.
- OAuth authorization uses one-time state and S256 PKCE. The browser handles references
  and callback status, not tokens.
- Raw request bodies, authorization headers, and token values are not safe evidence.
