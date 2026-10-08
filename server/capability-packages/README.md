# Capability package examples

`example.json` is trusted configuration containing procedural skills and the
`business-agent` profile. Startup does not require a document service or create
an agent filesystem. Skill resources and internal evidence still use Lab-owned
storage; this is distinct from providing filesystem tools to models.

Supported package sources are `skills`, `mcp` and `http`. Native `workspace`
packages fail with an explicit migration error. Adding another connected tool
through these adapters requires configuration, not edits to native agent loops.
Profiles select package IDs and retain each tool's version and risk class.
Skills expose discovery, loading and reference reading. They grant no authority
and do not automatically execute scripts or install plugins.

## Optional external document provider

`acceptance.json` connects the separate document provider at port 9197 through
MCP. It retains the historical `task-workspace_*` tool aliases and the
`workspace-agent` profile so retained results remain interpretable. The provider
owns template copies, persistent session directories, path confinement and
write restrictions. The capability host owns only the connected call.

Start the provider with an explicit development credential:

```sh
export AGENTLAB_DOCUMENT_PROVIDER_TOKEN=fictional-local-fixture-token
export AGENTLAB_DOCUMENT_PROVIDER_AUTHORIZATION="Bearer $AGENTLAB_DOCUMENT_PROVIDER_TOKEN"
pnpm --filter @agent-harness-lab/lab-server dev:document-service
```

Pass `AGENTLAB_DOCUMENT_PROVIDER_AUTHORIZATION` to the control plane loading
`acceptance.json`. The complete Authorization value is resolved server-side.
`trustedContext: "session"` makes the adapter inject `X-AgentLab-Session-Id`
from the admitted session. No model argument can select another session or root.
The provider is a trusted local development service, not a multi-tenant product.
Never expose its bearer credential to a model or browser.

Its five operations list, read, search, write and patch real files. Writes are
limited to `artifacts/`; replacing a file requires its current digest. The
provider keeps files under `lab/runs/.document-provider/<session-id>`. Follow-up
turns share their admitted session; different sessions have separate copies.
Path checks are application confinement, not an OS sandbox.

The controlled release service at port 9196 is also required for service acceptance.
Generated provider storage and run artifacts do not belong in source control.

## Reviewed customer-support workflow

`customer-support.json` adds the `support-agent` profile. Customer, order and
policy reads use MCP; the HTTP adjustment requires review of each invocation.
Its declared rejection statuses correspond to the fixture's pre-write checks.
Successful replies confirm the fixture's persisted effect. Idempotency-Key binds
replay to the same arguments at the service, separately from host call receipts.

The accompanying skill instructs the agent to read the policy and current
revision, propose the requested amount rather than the policy maximum, and
verify the saved order. Start both local services, load this configuration and
run `eval:capabilities -- --tasks support,workspace` for the reviewed business
workflow and optional connected-document workflow. The driver has an explicit
fictional trial review policy. It is not production authorization.

## Real Memos notes app

`customer-support.json` also includes `memos-notes` and the independent
`notes-agent` profile. It selects five upstream Memos MCP tools for listing,
reading, creating, updating and deleting notes. Writes require exact invocation
review. The `conn_memos_local` connection reads `AGENTLAB_MEMOS_AUTHORIZATION`
server-side; Memos owns account access and storage. No session header or native
filesystem is provided. See the [Memos setup and verification guide](../../docs/guides/memos-notes.md).

## Optional script execution service

`execution.json` connects a separate procedure provider and the `adjustment-summary`
skill. Its script is an inert resource until the agent submits it to the admitted
`procedures_execute` tool. The connected provider executes a pinned bounded
read/arithmetic/report procedure against saved business data. Script identity and
resource digest are verified; the skill cannot authorize itself or execute locally.
See [provider startup and limits](../src/capabilities/integrations/procedure-service/README.md).

Document write/patch selections explicitly configure the provider's documented
pre-write rejection codes. This lets a model correct a no-match patch or stale
digest after inspecting feedback. Generic MCP write errors still require
reconciliation. The trusted contract is part of the frozen source digest and
changes future admissions only; it does not rewrite historical trial outcomes.
