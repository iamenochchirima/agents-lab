# Integrations

Provider-neutral connection definitions for MCP, OAuth, and direct APIs.

The integration boundary is deliberately narrower than a provider SDK. It accepts an
opaque connection reference, bounded request input, a per-attempt request ID, and a
redacted result. Credentials are resolved by a `SecretStore` implementation and never
become part of a run manifest, browser response, or model context.

The local fixture is a deterministic provider-shaped HTTP service. The local stack starts
it as a separate process so Temporal activities, Restate handlers, Mastra tools, and the
Python LangGraph service cross the same request boundary. Unit tests may use the explicit
`LocalFixtureConnectionRuntime` in-process implementation, but production-shaped local
acceptance uses `HttpConnectionRuntime` and `AGENTLAB_LOCAL_FIXTURE_URL`. This proves
validation, cancellation, retry, idempotency, and unknown-outcome behaviour without
requiring Docker or an external account. A provider adapter must preserve those semantics
and add provider-specific evidence behind its platform-owned native boundary.

Connection references are opaque and use the `conn_` prefix. The local fixture reference is
`conn_local_fixture`; its HTTP service name and endpoint are not authorization references.

## Safety rules

- Remote MCP endpoints are allowlisted configuration, never model-provided URLs.
- MCP discovery is not authorization; selected tools are revalidated at invocation.
- Read-only API failures may use bounded retries. A dispatched write that times out is
  `unknown`, not an automatic retry.
- Every API and MCP attempt receives a child abort signal. A deadline aborts the
  underlying operation as well as the caller's wait; caller cancellation propagates
  to the provider boundary. A non-cooperative provider can still leave an external
  outcome unknown, so the result remains classified rather than retried blindly.
- OAuth authorization uses one-time state and S256 PKCE. The browser handles references
  and callback status, not tokens.
- Raw request bodies, authorization headers, and token values are not safe evidence.

Run admission records a `CapabilityResolutionRecorded` lifecycle event before dispatch. It
contains bounded grant and decision projections only; operational logs add the resolution
classification but never contain prompts, tokens, headers, or provider bodies.

The server-level rollback switch `AGENTLAB_CONNECTED_CAPABILITIES_ENABLED=false` marks
connected, write, and external profiles unavailable and rejects them before dispatch. It does
not disable pure inline tools or erase existing run evidence.

Local cleanup and rotation are separate from run evidence: stop the fixture or local stack,
remove only the configured connection-secret directory when its retention window expires, and
rotate a provider credential by replacing it in the configured secret store before reauthorizing
the opaque connection reference. Never rewrite an existing run's `config.json`,
`capabilities.json`, or lifecycle events during rotation.
