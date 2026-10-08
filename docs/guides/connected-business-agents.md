# Run a connected business agent

Mastra, LangGraph, Temporal and Restate baselines use configured MCP/HTTP tools
through their own native agent loops. Tools come from trusted package declarations;
skills describe procedures and load on demand. An optional document provider owns
file storage. Core agents have no native filesystem workspace.

The [compatibility matrix](connected-tool-compatibility.md) lists the exact HTTP,
MCP, authentication, approval and retained-evidence subset, with verified limits.

## Start the development services

Use the [local setup](local-development.md) for the selected platform's worker or
service and the API. Run the commands below from the repository root. The support
service uses fictional records and persists its own state; it sends no real refunds
or messages.

```sh
pnpm --filter @agent-harness-lab/lab-server run dev:capability-service
```

In another terminal, start the optional document provider with a development token:

```sh
AGENTLAB_DOCUMENT_PROVIDER_TOKEN=development-document-token \
  pnpm --filter @agent-harness-lab/lab-server run dev:document-service
```

Start the API with the matching provider credential and package configuration:

```sh
AGENTLAB_CAPABILITY_PACKAGES="$PWD/server/capability-packages/customer-support.json" \
AGENTLAB_DOCUMENT_PROVIDER_AUTHORIZATION='Bearer development-document-token' \
AGENTLAB_RUN_ROOT="$PWD/lab/runs" \
AGENTLAB_CONTEXT_ROOT="$PWD/lab/sessions" \
  pnpm --filter @agent-harness-lab/lab-server run dev
```

Use matching absolute run/context roots for the native workers. The capability host
URL and private key file must also match the API's configuration. The explicit roots
prevent different working directories from creating separate state collections.
Stop task-owned development services with their normal interrupt command.

## Select connections and review actions

In platform Chat, choose `support-agent`. The connection panel shows configured
identity and availability. Refresh retries discovery; reconnect creates new authority
after revoke. These are trusted local administrative operations, not a product login
system. Unsupported transports or missing credentials remain unavailable.

Ask the agent to inspect the fictional customer/order and adjustment policy, load
the customer-support skill, propose a permitted adjustment and verify the saved state.
The agent chooses its calls. When it proposes a write, Chat shows the exact business
arguments and waits for approval or denial. No effect occurs while review is pending.
An expired proposal needs fresh review; old decisions cannot authorize its new revision.
If delivery of an already-retained decision fails, continue that reviewed action with
the same decision identity rather than approving a new operation.

Choose `workspace-agent` for document work. File tools execute in the external
provider; they do not expose the Lab server's filesystem. Reports and follow-up
corrections stay in provider-owned session storage.

## Configure another service

A trusted package can reference a connection with `connectionRef`. The top-level
`connections` array defines its `conn_` reference, display name, provider, deployment
owner, resource, scopes and authentication mode. Anonymous, environment-referenced
static headers and configured OAuth are supported. See the
[connection contract](../../server/src/capabilities/integrations/oauth/README.md)
for OAuth settings, encrypted secret storage and discovery limits.

HTTP operations declare schema, method, path, argument bindings and approval mode.
MCP packages declare endpoint, protocol revision and permitted aliases. Add these
configurations and refresh the catalog; platform loops require no tool-name edits.
A refresh changes future admissions. Existing runs retain their admitted schema and
authority, and cannot silently use a changed account or source.

## Inspect results and run acceptance

Each run retains configuration, events, trajectory, metrics, result and source
receipts. Reviews live under `artifacts/action-reviews/`; tool receipts live under
`artifacts/capability-calls/`. Check actual provider state independently of the
assistant's answer. Chat's tool activity distinguishes a known no-change rejection from an acknowledged
write with an invalid result and an uncertain effect. Expand an entry to inspect
response validity, effect evidence, provider request IDs and returned data. Its
source receipt link opens the protected record, including retained source attempts
and replies. Unknown effects need reconciliation and stop continuation.
Same-call receipt replay and provider idempotency do not establish exactly-once
business effects across independently generated actions.

After the native lifecycle gate passes, use the two controlled workflows with a
currently verified free model and paid fallback disabled:

```sh
AGENTLAB_RUN_ROOT="$PWD/lab/runs" \
  pnpm --filter @agent-harness-lab/lab-server run eval:capabilities -- \
  --api http://127.0.0.1:4318 --tasks support,workspace
```

The driver retains the model's actual decisions and strict failures. Its automatic
review is restricted to the explicit fictional 500-cent policy; it is not production
authorization. Scripted native lifecycle checks are separate from model-quality
observations. See the [experiment](../../lab/experiments/agent-capabilities-live/README.md).

## Baseline instructions and retained sessions

New baseline sessions tell the model to activate a relevant procedural skill,
use admitted tools, verify saved results and respect action review/effect certainty.
The same instructions apply to all four baselines. Metadata remains visible before
activation; the model still chooses whether to call the loader, and acceptance
records that decision. The driver never preloads a skill to make the check pass.
Existing sessions preserve their original system instruction and record it in each
run manifest. Start a new conversation to use a changed baseline instruction.
