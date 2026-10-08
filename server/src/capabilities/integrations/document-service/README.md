# Optional document provider

This separate process provides five MCP tools for text documents. It owns the
real filesystem, template capture, per-session persistent directories and write
permissions. Native agents call it through the same connected MCP adapter used
for business services. The default `business-agent` profile has no dependency
on this service and no native file tools.

Start from the repository root with a server-owned development token:

```sh
export AGENTLAB_DOCUMENT_PROVIDER_TOKEN=fictional-local-fixture-token
export AGENTLAB_DOCUMENT_PROVIDER_AUTHORIZATION="Bearer $AGENTLAB_DOCUMENT_PROVIDER_TOKEN"
pnpm --filter @agent-harness-lab/lab-server dev:document-service
```

The provider binds loopback port 9197. `acceptance.json` selects its five MCP
operations with explicit read/write risk classes. `headersEnv` resolves the
complete bearer header. The source's `trustedContext: "session"` setting injects
`X-AgentLab-Session-Id` from the host-admitted context. The public input schemas
contain relative document paths and edit content, never roots or session IDs.
The provider trusts the authenticated capability host to bind session scope.
This is a local development deployment, not multi-tenant account authentication.

`files.ts` contains provider-owned storage operations. Templates reject symlinks,
special files and oversized inventories. Session directories are published
atomically and retain a template revision marker. Following turns reuse the
same directory; different sessions have independent copies. The default
storage root is `lab/runs/.document-provider/`, configured only when starting the
service. Writes are restricted to `artifacts/`. Existing outputs require the
current digest and patching requires exactly one match.

This confinement is not a VM or operating-system sandbox. The provider cannot
run scripts, launch a shell, install software or expose arbitrary server files.
Skill/config/evidence storage in the Lab is separate from this tool provider.

If the provider is unavailable, the connected source must report unavailability.
There is no native filesystem fallback. Legacy `source: "workspace"` package
configuration fails with an explicit migration error; retained historical run
records stay unchanged. Independent acceptance reads actual provider storage
to establish report effects rather than trusting the assistant's final answer.

## Documented pre-write rejection contract

The provider returns `isError: true` and `structuredContent.error.code` for these
specific checks before changing the requested document:

| Code | Rejection |
| --- | --- |
| `DOCUMENT_INVALID_ARGUMENTS` | Published input schema does not match |
| `DOCUMENT_PATH_REJECTED` | Relative path escapes the scope or encounters a link |
| `DOCUMENT_WRITE_SCOPE` | Target is outside configured writable directories |
| `DOCUMENT_CONTENT_LIMIT` | New content exceeds the bounded write limit |
| `DOCUMENT_DIGEST_CONFLICT` | Current file does not match the observed digest |
| `DOCUMENT_PATCH_MATCH` | Patch text is absent or matches more than once |

These codes establish that the requested file edit did not occur. Provider session
initialization and internal execution receipts remain separate environment/evidence
state. Digest and content checks run before parent-directory creation. After write
preparation starts, I/O/path-race errors remain unclassified. Lost replies, failed
rename acknowledgements and arbitrary MCP errors never receive a no-effect code.

Trusted MCP tool configuration may opt into `effectContract.rejectionErrorCodes`.
The adapter checks the structured code only when `isError` is true and the exact
code was configured. It does not trust tool annotations, an arbitrary provider
`effect` claim, a message containing a code, or model arguments. Undeclared write
errors remain unknown and require reconciliation. Declared rejections become
identified feedback, allowing the agent to inspect and correct a bad patch safely.

The contract participates in the frozen source digest. Updating configuration
applies to future admissions; it does not upgrade existing run permissions or
rewrite failed model evidence. Restart a provider only after active trials finish.
