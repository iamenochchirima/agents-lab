# Run an agent with connected tools

Temporal, Restate, LangGraph, Mastra and Vercel Workflows baselines use configured MCP/HTTP tools
through their own native agent loops. Tools come from trusted package declarations;
skills describe procedures and load on demand. An optional document provider owns
file storage. Core agents have no native filesystem workspace.

The [compatibility matrix](connected-tool-compatibility.md) lists the exact HTTP,
MCP, authentication, approval and retained-evidence subset, with verified limits.
The [readiness checkpoint](connected-tool-readiness.md) separates native checks,
real-model task observations and remaining frontend verification.

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

When the frontend uses a separate API address, set `VITE_AGENTLAB_API_URL` to that
API and set the API's `AGENTLAB_API_ORIGIN` to the exact frontend origin. For
example, a page at `http://localhost:5173` needs that origin even if its API is
`http://127.0.0.1:4322`. The default `http://127.0.0.1:5173` is a different origin.
Restart the API after changing its origin configuration.

## Chat with the shared tools

Open Chat on the platform you want to use. New chats automatically receive tools and
skills from enabled, available packages, including the configured support service.
There is no profile or skill selection step. Use **Plugins** to check connections,
refresh discovery, or manage which tools and approval rules are enabled. Unsupported
transports or missing credentials remain unavailable.

Ask the agent to inspect the fictional customer/order and adjustment policy, load
the customer-support skill, propose a permitted adjustment and verify the saved state.
The agent chooses its calls. When it proposes an action requiring review, Chat places an approval card
inside the assistant turn that proposed it. The card shows the tool, bounded
redacted arguments and recorded source details when available; review controls
are not in the configuration sidebar. Multiple proposals have separate cards. No effect occurs while review is pending.
An expired proposal needs fresh review; old decisions cannot authorize its new revision.
Exact-call cards keep their identity when renewed. If a focused decision button is
removed by an update, focus moves to its card without requesting a scroll. Polling
does not take focus from another control or an inactive page. Actual focus/scroll
behavior still needs the frontend observation listed in the readiness checkpoint.
If delivery of an already-retained decision fails, use **Retry retained decision**
or **Continue reviewed action** with the same decision identity. **Request fresh
review** renews an expired proposal without another model choice or effect. A
cancelled or terminal run cannot authorize another dispatch from its old card.

Reopening a saved Chat run restores the conversation's retained turns and review
cards. **Load earlier turns** retrieves older pages. Each run restores its admitted
tools, skills and run options from its manifest; a subsequent turn captures the
current shared catalog. Current connection availability is managed from **Plugins**; retained
authority and provider receipts remain part of the run evidence.

If an external document provider is enabled, its tools are also included in normal
platform Chat. File operations execute in that provider; the Lab does not expose a
native agent filesystem. Reports and follow-up corrections stay in provider-owned
storage.

## Manually verify action review

This walkthrough checks the actual browser controls. API fixtures and component
checks do not establish that the browser interaction works. Use the fictional
development service above and record the selected platform, model and run IDs.

1. Open a baseline platform's Chat, start **New chat**, and select an approved
   currently available free tool model. Under **Run options**,
   choose **Free model capability trial** to enforce server-owned price ceilings
   and disable paid fallback. Confirm that
   the shared **Tools** list includes the support actions. If needed, open **Plugins**
   to inspect the connection and refresh discovery before submitting a task.
2. Choose an unused lowercase namespace beginning `cap-ui-approve-`, followed by
   a short unique suffix. Substitute it for `NAMESPACE` in this prompt:

   ```text
   Use the customer-support skill. In namespace NAMESPACE, inspect Avery's
   eligibility, order-cedar and the late-delivery adjustment policy. Propose
   exactly 500 cents for late_delivery using support_adjust and the current
   order revision. Await review before applying it. Read the saved order
   afterward and report the verified amount and revision.
   ```

3. When **Action review** appears, confirm `support_adjust`, the same namespace,
   `order-cedar`, `amountCents: 500`, `reason: late_delivery`, and
   `expectedRevision: 1`. Capture the pending screen and run ID. Independently
   open `http://127.0.0.1:9196/support/order?namespace=NAMESPACE`, replacing the
   placeholder. Before approval it must show `adjustmentCents: 0`, `revision: 1`
   and an empty `adjustments` list.
4. Click **Approve action**. The run must continue, retain the reviewed tool
   result and verify the saved order. Refresh the independent order view: it
   must show `adjustmentCents: 500`, `revision: 2` and one adjustment. Inspect
   the tool outcome and source receipt in Chat; retain a completion screenshot.
5. Start **New chat** with a different unused `cap-ui-deny-` namespace. Use the
   same prompt, adding: "If review is denied, do not propose another adjustment;
   explain the denial." Click **Deny** on the exact pending action. The run
   must continue with denied-call feedback. The independent order view must
   remain at zero adjustment, revision 1 and no adjustment entries. Retain the
   denial screen and run ID.

Report a missing proposal, failed control, unexpected effect or model/provider
error as the observed result. Do not substitute an assistant's claim for the
independent order view. This checks browser approval and denial, not all native
recovery boundaries or general model reliability.

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
A review-preparation failure is a pre-dispatch failure: that proposed call was not
sent to its source. A call that timed out after dispatch may instead have changed
provider state. An **Outcome unknown** card requires receipt inspection and
independent provider reconciliation before a fresh write; an **Approved** card
alone is not evidence that an effect happened. Denial returns feedback to the model
and does not dispatch the declined call.

Same-call receipt replay and provider idempotency do not establish exactly-once
external effects across independently generated actions.

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
The same instructions apply to all five priority baselines. Metadata remains visible before
activation; the model still chooses whether to call the loader, and acceptance
records that decision. The driver never preloads a skill to make the check pass.
Existing sessions preserve their original system instruction and record it in each
run manifest. Start a new conversation to use a changed baseline instruction.


## Platform execution and evidence limits

| Baseline | Native execution and review waiter |
| --- | --- |
| Temporal | Workflow orchestration, source Activities and workflow signals |
| Restate | Journaled actions and a call/revision-specific durable promise |
| LangGraph | Graph nodes, SQLite checkpoints and `Command(resume=...)` |
| Mastra | SDK agent loop and persisted suspended snapshots in LibSQL |
| Vercel Workflows | Workflow-owned model/tool loop, durable steps and revision-specific hooks in local World |

These implementations share admitted schemas, policy, reviews and the capability
host; they do not share a replacement agent loop. Vercel publishes pending-review
progress after its hook registers, and retains admission and decision delivery
identities across service restart. A native Workflow may complete by returning a
failed agent result; the Lab keeps both statuses instead of presenting a successful
task. Native fixture checks and provider-shaped controls are separate from live
model decisions and real-account execution. Current live acceptance must be read
from each trial's evidence, not inferred from this implementation table.

Inngest, DBOS, Hatchet and Trigger.dev, plus hosted deployments, are not validated
for connected-tool parity in this phase. A reachable health endpoint does not
establish tool exposure, approval continuation or effect recovery.

Live trials use the exact approved free model after a fresh raw catalog price check.
The `agent-harness-live` and `agent-capabilities-live` experiments apply zero price
ceilings, required provider parameters, no provider fallback and 512/2048 output
tokens respectively. Rejection happens before model transport if these controls
cannot be retained. Interactive model choices outside these experiments are
independent; the free driver never silently substitutes a paid model.

## Recorded browser acceptance

On 2026-10-08, actual LangGraph Chat controls were checked with `support-agent`,
`nvidia/nemotron-3.5-lightning:free` and **Free model capability trial**. Run
`f910b60e-d529-43aa-8e62-3efcbc14dd13` waited with zero effects, resumed after
**Approve action**, applied exactly one 500-cent adjustment at revision 2 and
reread the order. Run `853181b6-d7e9-4fa4-b2d4-64ca8c201891` resumed after
**Deny**, received `INVOCATION_DENIED` feedback and completed without another
proposal or source mutation. Independent before/after provider JSON and screenshots
are retained in `lab/runs/.review-proof/browser-final/`; both runs have normal
execution records. Saved-run reload and provider-receipt display were also checked.

This verifies those UI controls, not reliable model adherence to every procedure.
Both runs skipped skill activation; the denial answer treated explicit refusal as
missing approval. Earlier strict workflow results remain unchanged. See the
[capability experiment](../../lab/experiments/agent-capabilities-live/README.md)
for graded outcomes and comparison limits.
