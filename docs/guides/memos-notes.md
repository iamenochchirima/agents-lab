# Connect a real notes app through MCP

This guide connects the upstream Memos notes application to the four baseline
agents through the existing MCP adapter. Once enabled and available, the notes
tools are included automatically in normal platform chats. Memos owns its account,
notes and persistent database. The Lab owns tool admission, action review and
run evidence. This connection gives models no native filesystem tools.

## Start Memos

From the repository root, install Podman if it is not already available, then run:

```sh
podman volume create lab-memos-data
podman run -d --name agentlab-memos \
  -p 127.0.0.1:5230:5230 \
  -v lab-memos-data:/var/opt/memos \
  docker.io/neosmemo/memos:0.31.0
```

The image version is pinned. The named volume survives container replacement;
removing it deletes the app's saved data. The service is bound to the local
machine. Open `http://localhost:5230`, create the initial administrator account,
then create a separate ordinary `lab-agent` account for Lab tools. Sign into that
account and create a personal access token in its account settings.

Save the complete Authorization value in the ignored `server/.env.memos` file:

```dotenv
AGENTLAB_MEMOS_AUTHORIZATION='Bearer <the-lab-agent-personal-access-token>'
```

Keep this file private. The token represents the Memos account and grants access
to the resources that account can use. This example does not provide per-agent
or per-session accounts. Use a dedicated test account and keep personal notes out
of it. A desktop connector's credentials do not automatically authorize the Lab
backend. The local stack launcher reads this one setting and passes it only to
the Lab API process; the worker and web process do not inherit the token.

## Configure the Lab

`server/capability-packages/customer-support.json` includes the `memos-notes`
package, `conn_memos_local` connection and `notes-agent` profile. Its endpoint is
`http://127.0.0.1:5230/mcp`. Start the full local stack, or the API by itself, to
load the token from `server/.env.memos` and the credential-store key from the
ignored `server/.env.capabilities` file:

```sh
./scripts/run_local_stack.sh
# Or, when the other services are already running:
./scripts/run_local_stack.sh server
```

An explicitly supplied `AGENTLAB_MEMOS_AUTHORIZATION` environment value takes
precedence over the file. The launcher reads only the documented credential-key
settings from `.env.capabilities`; explicitly supplied environment values take
precedence. Keep the encryption key stable: replacing it makes existing saved
connection credentials unreadable. Both the Memos token and encryption key are
passed only to the API process. If either required value is missing, the saved
credential or connection remains unavailable and its tools are not admitted.

For an already running control plane, preserve its port, run roots, native
endpoints and other settings when restarting. New connection definitions require
an API restart. Changing the tool connection needs no edits or restarts to the
native agent loops. Workers still need their normal capability-host endpoint and
shared private host-key file.

Inspect `/api/connections` and `/api/capabilities` on the configured API port.
An unavailable provider or missing token is reported as unavailable; startup does
not invent a working connection. Once the connection is available, open a new chat
on any baseline platform. The platform's regular agent receives the Memos tools
alongside other enabled shared tools; no notes-specific chat setup is needed.

| Tool | Purpose | Review |
| --- | --- | --- |
| `memo_list_memos` | Find accessible notes | None |
| `memo_get_memo` | Read one note | None |
| `memo_create_memo` | Save a new note | Exact invocation |
| `memo_update_memo` | Change an existing note | Exact invocation |
| `memo_delete_memo` | Delete one note | Exact invocation |

An explicit `notes-agent` profile remains available in controlled run and
comparison flows that need only these five tools. Normal platform chats receive
the enabled shared inventory, including the Memos tools, document or support tools,
and skill-discovery tools as configured. Each tool's schema and description are
discovered from its provider and frozen when a run is admitted. Authentication is
resolved server-side; the model does not receive the token. No Lab session header
is injected because Memos account permissions own the resource boundary.

## Verify the connection before agent trials

A direct smoke check should discover the tools, create one clearly marked test
note, read it, update it, read back the changed content, delete it, and confirm it
is absent. Retain the created resource name so verification and cleanup address
only that note. Capture the provider acknowledgements and independent read-back
results without saving credentials. The shipped direct check runs this sequence:

```sh
set -a
. server/.env.memos
set +a
pnpm --filter @agent-harness-lab/lab-server exec tsx scripts/check-memos.ts
```

It writes credential-free evidence under `lab/runs/memos-check-*/result.json`.
Each execution uses a unique memo ID and performs no model calls. It does not
retry writes or delete unrelated notes. If interrupted, inspect the recorded
memo ID in Memos before cleanup.

On 2026-10-08, Memos 0.31.0 passed discovery, create, private read-back, content
update, filtered lookup and deletion absence through the shared HTTP MCP client.
The dedicated token expires after 30 days. This observation covers direct
provider connectivity only.

This establishes app connectivity and CRUD behavior. It does not establish that
a model chooses the right tool, preserves unrelated content, responds correctly
to a correction, or observes an action denial. Those require separate agent
trials using the connected profile and prompts reviewed before execution. Do not
count a direct provider call as an agent run or an eval pass.

For agent trials, inspect proposed write arguments before approving them. Check
the saved note after each mutation and ensure deletion targets the note created
for that trial. A successful final message is insufficient evidence by itself.

## Failure and compatibility limits

The MCP adapter supports Streamable HTTP, including the stateless Memos endpoint.
It does not launch stdio servers or connect to legacy SSE-only endpoints. A
different notes app needs its own trusted configuration and supported transport;
its schemas and authentication cannot be assumed to match Memos.

Generated input schemas retain their full declarations under a separate bounded
budget of 32 KiB, 4,096 JSON values and nesting depth 16. The ordinary
grant/policy record budget and tool argument/result limits remain unchanged.
Oversized schemas are rejected rather than silently reduced.

Writes require exact invocation review through the existing Lab review lifecycle.
The package declares no provider-specific pre-write rejection codes. A lost
acknowledgement or ambiguous write error remains an unknown outcome. Inspect
Memos before deciding on recovery; do not automatically repeat the mutation.
The Lab's persisted call receipts do not establish provider idempotency or
exactly-once delivery. Token revocation and account permissions remain under
Memos control.

For the shared adapter boundaries, see [capability packages](capability-packages.md)
and [connected-tool compatibility](connected-tool-compatibility.md). Upstream
application sources and setup are available in the
[Memos repository](https://github.com/usememos/memos/tree/v0.31.0).
