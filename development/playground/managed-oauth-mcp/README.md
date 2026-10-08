# Managed OAuth MCP acceptance fixture

This walkthrough exercises one real HTTP integration through the Lab's shared
connection manager, encrypted credential store and MCP adapter. It is a fake-data
development provider. It has no real account, automatically approves fixture
authorization and makes no model calls. It is not a production authorization
server or evidence that an external account connection works.

## Run

Start the optional provider from the repository root:

```sh
node development/playground/managed-oauth-mcp/provider.mjs
```

It binds to loopback `127.0.0.1:9198`. Keep that terminal running. To use another
port, set `AGENTLAB_OAUTH_PROBE_PORT` on both provider and checker.

In a second terminal, run the actual HTTP acceptance:

```sh
pnpm --filter @agent-harness-lab/lab-server exec tsx ../development/playground/managed-oauth-mcp/check.ts
```

The checker creates temporary managed state and a random deployment key, completes
the PKCE flow, discovers and calls one read-only tool, rotates a refresh token,
rejects reuse of the previous refresh token, then revokes the grant. It removes
its temporary state and prints a result without tokens, codes or keys. Controlled
expiry of its encrypted token record exercises refresh immediately, without a
30-second wait. This is a connection acceptance walkthrough rather than a model
eval or published benchmark.

## Frontend setup

In a platform's capability manager, add a connection with:

| Field | Value |
| --- | --- |
| Name | Fake OAuth probe |
| Server URL | `http://127.0.0.1:9198/mcp` |
| Authentication | OAuth |
| Existing client ID | `lab-check` |
| Allowed issuer | `http://127.0.0.1:9198` |
| Scope | `probe.read` |
| Redirect URL | The frontend's default callback for this connection |

Save it and authorize. The browser receives an immediate redirect because only
fake fixture data is involved. Discover tools afterward. The tool `oauth_probe`
returns `oauth-fixture-connected`. Choose its permissions explicitly; provider
annotations do not grant runtime authority.

The preregistered public client accepts callbacks on loopback ports 5173 and
4322 only, under `/api/management/connections/<conn_ref>/callback`. Use the exact
redirect displayed by the frontend. No client secret is needed. Access tokens
expire after 30 seconds; refresh tokens rotate and are usable for one hour. The
Refresh action exercises provider refresh after expiry.

## What is measured

The provider serves a Bearer challenge, RFC 9728 protected-resource metadata and
RFC 8414 authorization-server metadata. It advertises S256 PKCE, the public-client
token method, the supported scope and an issuer in its authorization response.
Authorization codes are one-use, short-lived and bound to the client, exact
redirect, PKCE challenge and resource. Tokens are opaque random values; access is
bound to this MCP resource. Refresh rotates its token and invalidates the previous
access token. Revocation clears the fixture's associated grant.

The MCP endpoint supports the Lab's sessionless protocol and a basic legacy
initialize exchange. Instructions and model decisions are outside this check.
Provider state is ephemeral; stopping it invalidates all fixture tokens. Inspect
the implementation to understand these controls, and use the real provider's
identity, consent and registration process for an external account.
