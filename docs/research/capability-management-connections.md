# Connection management and credential storage research

Research date: 2026-10-08. This note supports the frontend capability-manager plan. It records documented behavior and inspected source separately from proposed Lab decisions. No connection-management implementation is included.

## What established agents do

### Claude Code

Claude Code configures HTTP connections by URL and stdio connections by command and arguments. It supports bearer headers and environment references. Definitions have local, project and user scopes; shared project definitions require workspace trust. Its MCP menu exposes connection status and authentication actions. Plugin packages can supply MCP definitions. These are client features rather than requirements imposed on every MCP server. [Official MCP guide](https://code.claude.com/docs/en/mcp)

Its HTTP OAuth flow opens a browser, refreshes tokens automatically and exposes a clear-authentication action. Automatic setup supports client ID metadata documents and dynamic client registration. A pre-registered client remains available when automatic setup fails. Client secrets use masked input and are stored separately from configuration in the macOS keychain or a credentials file. Scopes can be pinned. The guide does not establish that every credentials-file implementation encrypts its contents, so this research makes no such claim. [Authentication and pre-configured clients](https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers)

### Codex

Codex uses command, arguments and environment entries for stdio; Streamable HTTP uses a URL and can source bearer tokens or headers from environment variables. Configuration distinguishes enabled tools, disabled tools and per-server approval defaults. MCP OAuth storage has explicit `auto`, `file` and `keyring` modes. These configurable modes are more precise than a generic promise of secure storage. [Official configuration reference](https://developers.openai.com/codex/config-reference/)

Current source resolves a credential store for one client lifecycle. Reads, refreshes, saves and deletion stay on that store. A failure in the selected keyring does not silently fall back to a file containing a potentially stale refresh token. The source also shows store locking. This is a useful lesson for the Lab: backend selection and token refresh concurrency are part of credential correctness. Source on `main` is mutable and is not a pinned release claim. [Resolved OAuth store source](https://github.com/openai/codex/blob/main/codex-rs/rmcp-client/src/oauth/resolved_store.rs)

### OpenCode

OpenCode distinguishes local command-based servers and remote URL-based servers. Remote authentication supports custom headers, environment substitution, browser OAuth, dynamic registration and pre-registered clients. It exposes status, authenticate and logout commands. OAuth credentials live outside project configuration. [Official MCP guide](https://opencode.ai/docs/mcp-servers/)

Inspected source stores tokens, registered client information and OAuth state in `mcp-auth.json`, writes JSON with mode `0600`, and locks mutations. `getForUrl` prevents a named server from reusing credentials after its URL changes. The inspected module does not encrypt JSON. File permissions and separation from configuration are useful, but they do not establish encryption at rest. This is a source observation on the current `dev` branch, not a claim about every version or deployment. [MCP auth storage source](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/mcp/auth.ts)

## Protocol constraints on a seamless connection flow

The MCP 2025-11-25 authorization specification applies OAuth to HTTP transports. Stdio servers should obtain credentials from their environment instead. HTTP clients discover protected-resource metadata and authorization-server metadata, use resource indicators, and protect authorization codes with PKCE. [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

Registration preference is pre-registered information, then client ID metadata documents when supported, then dynamic registration when supported, then a user-entered client configuration. Client ID metadata documents require an HTTPS-hosted document whose identity matches its URL. A local-only Lab installation therefore needs a hosted metadata identity, provider pre-registration or a provider that supports dynamic registration. A URL alone cannot guarantee successful OAuth with every provider. [Client registration approaches](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-registration-approaches)

Account authorization and tool approval are separate. A token grants access at the provider; an agent profile decides which discovered tools are exposed and which invocations require approval. Provider scopes do not automatically express per-tool Lab permission choices. This distinction follows from the protocol's transport-level authorization and the inspected clients' separate tool policies.

## What the Lab already implements

These observations come from the repository, rather than the external sources above.

| Boundary | Existing behavior | Gap for frontend management |
| --- | --- | --- |
| `capabilities/integrations/connections.ts` | Anonymous sources, environment-backed static headers, pre-registered OAuth, redacted status, connect/refresh/revoke, resource/scope binding and authority revisions | Definitions load at bootstrap; no durable frontend create/update/delete path; static credentials and client secrets cannot be saved through a credential reference |
| `capabilities/integrations/oauth/flow.ts` | One-use state, ten-minute expiry, S256 PKCE, issuer checks, token exchange, shared refresh, token rotation and revocation | Refresh coordination is within one process; pending authorization disappears on restart; generic secret types are absent |
| `capabilities/integrations/oauth/encrypted-file-store.ts` | AES-256-GCM, deployment-supplied 32-byte key, bounded records, owner-only directories/files and atomic replacement | Token-shaped records only; no key identifier/rotation migration, owner/resource authenticated encryption binding, or durable secret-access audit |
| `control-plane/bootstrap/server.ts` | Durable local lifecycle records and encrypted OAuth store when the deployment key exists; OAuth visibly unavailable otherwise | Frontend-created secrets need the same fail-closed setup; no plaintext fallback should appear |
| Connection ownership | Deployment-controlled owner label | This is not provider-account verification, product authentication or multi-tenant authorization |

The existing OAuth README explicitly limits automatic setup to configured-client discovery. Client ID metadata documents and dynamic registration are absent. Metadata discovery also omits the path-inserted OpenID fallback required for issuers with paths. Preserve the existing lifecycle protections while extending interoperability.

## Proposed Lab decisions

These are recommendations for the implementation plan, not claims about current code.

1. Keep connection metadata and secret material separate. Persist display name, endpoint, transport, auth mode, owner, requested scopes and immutable revisions in the capability registry. Persist only opaque secret references there. Never place token values in packages, profiles, run snapshots or model messages.
2. Extend the secret-store boundary to typed records for static headers/PATs, OAuth client credentials, OAuth token grants and managed-process environment secrets. Retain the encrypted-file adapter for the local Lab. Define an adapter for a hosted secret manager without adding that infrastructure to local setup.
3. Accept a secret once through a write-only backend request. Return configured state and optional user-supplied label. The edit form replaces or removes a value; it never receives the original secret. Avoid browser storage, request-body logging, URL parameters and error messages containing secrets.
4. Bind encrypted records to the owner, connection ID, resource identity and secret type through authenticated encryption data. Include a key version. Supply the root key outside the data directory, fail closed when it is unavailable, and document rotation and backup recovery. Re-encrypting records must not silently change their authority identity.
5. Keep credential resolution at the shared capability host, immediately before dispatch. Native platform workers receive admitted tool descriptors and connection revisions rather than bearer values. Tokens must not reach the model's tool arguments or durable platform histories.
6. Pin endpoint/account/scope authority separately from routine token rotation. A changed endpoint or grant invalidates previously admitted bindings. Existing runs retain configuration evidence, but revoked authority cannot continue dispatching through an old snapshot.
7. Give the connection state machine distinct states for missing credentials, pending consent, connected, expired, reconnect required, unavailable and revoked. A failed refresh must stop retrying invalid grants and expose reconnect. Disconnect closes local dispatch immediately, deletes local secrets and reports whether remote revocation succeeded.
8. Keep refresh single-flight in one API process. Declare one control-plane credential writer initially. Multiple API replicas require a durable lock or compare-and-swap before they can safely share rotating refresh tokens; atomic file replacement alone is insufficient.
9. Implement protected-resource and issuer discovery with bounded responses, explicit HTTPS policy and the required fallback order. Prefer pre-registration, add DCR when advertised, and support CIMD only with an actual published HTTPS client document. Show provider-specific setup when automatic registration is impossible.
10. Start with an explicit trusted local workspace owner. Frontend management endpoints need a defined local administrator access boundary and origin protection. Hosted multi-user deployment requires authenticated owner checks before reading, mutating or using any connection. A plugin cannot grant itself an account or credential.
11. Managed stdio belongs to a process host. Inject only configured environment secrets into that process, use explicit commands/arguments and lifecycle controls, and prevent broad inheritance of the API environment. Installing a plugin containing a command does not itself authorize starting arbitrary code.

## Minimal validation needed for these decisions

- Save a static credential, reconnect after an API restart and execute one real Memos tool. Verify metadata/API responses, run evidence and logs omit the value.
- Run the OAuth fixture through consent, refresh-token rotation and disconnect. Verify invalid state/issuer and invalid refresh produce explicit reconnect or rejection, with no usable revoked binding.
- Change endpoint or grant while retaining an admitted run. Confirm authority checks block changed access while the original run record remains inspectable.
- Exercise a missing encryption key and an unreadable encrypted record. Both must show an unavailable connection without plaintext fallback.
- When managed stdio lands, verify one process launch, environment allowlisting, cancellation and teardown. Do not add transport claims before that host exists.

## Limits of this research

This is an interoperability and architecture review. No real OAuth account was connected during this research, and no token material was read. Client documentation changes over time; mutable source links describe what was inspected on the research date. The comparisons establish common patterns, not a requirement to copy any one product's credential storage or permissions model.
