# Managed capability acceptance

Status: partial acceptance evidence; narrower read-only native platform trials are in
progress. Evidence inspected on 2026-10-08, Africa/Johannesburg. This report is not
a claim that all platforms or all capability-management requirements have passed.

## Question and hypothesis

Can profiles created through the platform frontend use saved credentials,
installed procedural skills and connected MCP tools in a real native agent run,
with inspectable provider effects and invocation review?

The hypothesis is that the shared management/catalog/host boundary makes these
capabilities available without adding provider-specific branches to native agent
loops. A second, narrower workload checks whether a native agent can read a real
managed stdio MCP server and report counts consistent with its persistence. A
third workload checks connected notes listing plus loading a procedural resource
without approving any mutation. These have distinct acceptance criteria.

This is implementation acceptance. It measures the named workflows with explicit
model prompts and local services, not unconstrained task competence, production
reliability, statistical platform rankings or universal MCP compatibility. The
instructions deliberately explain the provider's argument shapes, so a pass does
not establish that a model can infer those shapes from tool schemas alone.

## Variables and controls

The changed variable is the native baseline: Mastra, LangGraph, Temporal or
Restate. Each run receives a new session; the notes workload also receives a
unique disposable marker. The observer submits tasks and decisions through the
ordinary run API. The native platform owns model reasoning and tool execution.

| Control | Notes CRUD | Stdio graph read |
| --- | --- | --- |
| Frontend-created profile | `notes-acceptance` | `memory-acceptance` |
| External provider | Real Memos `0.31.0`, loopback HTTP MCP | `@modelcontextprotocol/server-memory` `2026.8.31`, managed stdio |
| Installed procedure | `notes-check-skills:notes-check`, explicitly preloaded | None required |
| Model in the inspected passing records | `cohere/north-mini-code:free` (LangGraph); `nvidia/nemotron-3.5-lightning:free` (Temporal) | `cohere/north-mini-code:free` |
| Model admission | Fresh zero-price catalog validation; free routing checked in retained events | Same |
| Agent limits | 30 model rounds, 30 logical tool calls | Same |
| Observer deadline in inspected records | 240 seconds | 180 seconds |
| Mutation authority | Review each exact create/update/delete proposal | Read-only profile and workload |
| Independent verification | Memos REST reads, with a dedicated test-account credential | Read-only provider persistence snapshot before and after |
| Failure injection | None in normal live trials; a separate create-denial mode exists | None |

The observer records model catalog metadata, routing, profile IDs, limits,
timestamps, source revision, prompts, run IDs and provider snapshots. Native run
records carry admitted capability/model configuration and framework events.
Temperature/seed are not assigned by this observer; deterministic model
reproduction is not claimed. Provider availability, rate limiting and remote
model behavior remain uncontrolled influences. The inspected positive notes
results use different models, so they do not control model quality across
platforms and cannot support a comparative platform score.

The passing records below identify source revision
`3af2987497eb5ccd83641e5cc7d3b3464129b4ba`. The notes record explicitly marks a
dirty working tree. These results therefore describe the inspected execution
state and evidence, not a final clean-commit release validation. The stdio
record additionally retains the installed package-lock SHA-256 and provider
package/version. Its observed Node executable is observer metadata; verify the
admitted package command when identifying the provider's actual executable.

## Show prompts before running

Show the intended task and mutation scope to the user before starting the driver.
The executable saves its exact generated prompt, including the unique marker,
into each platform's retained evidence. This README describes the same controls
without inventing a shared marker or reusing a previous note.

The notes task is:

> Use the preloaded notes-check skill. Create exactly one private disposable note
> with a new `cm-<26 hex characters>` ID and the specified Markdown content:
> title `Lab notes acceptance <marker>`, owner Alex, meeting 10:00, and tag
> `#lab-managed-acceptance`. Await review for each write. Read back the created
> note. Change only the meeting to 14:00, preserve the other text and private
> visibility, and read it back again. Delete only that exact note, then list by
> the marker to verify absence. Never mutate unrelated notes.

The actual generated prompt specifies Memos's shapes explicitly: create uses
`memoId` plus `body.content`/`body.visibility`; update uses the plain memo ID,
`body.content` and top-level `updateMask: "content"`; get/delete use the plain ID
instead of the returned `memos/<id>` resource name. The driver records this
scaffolding as part of the task, not as hidden model-independent repair.

The stdio task's exact prompt is:

> Read the actual connected memory graph using the available read_graph tool.
> Count its entities and relations from the returned graph. Do not guess, mutate
> the graph, or use filesystem access. Return a JSON object with exactly nodeCount
> and relationCount; both must be integer counts from the tool result.

The newer read-only notes task is:

> Use the preloaded notes-check skill. First read its
> `references/procedure.md` resource. Then list only private memos containing
> `#lab-managed-acceptance`, with page size 10. Do not create, update or delete
> anything. Return exactly `observedCount` and `memoIds`, based on the returned
> page, not a guessed total across pages. Preserve the returned `memos/<id>`
> resource names. If the page is empty, return zero and an empty list.

Its recorded prompt specifies the resource arguments and filter exactly. The
workload retains `notes-acceptance`, the same explicit preloaded skill, fresh
free-model validation and 30-round/30-call limits. Any reviewed mutation proposal
is denied and the observation cancelled. A pass requires actual skill-resource
loading and later model-context evidence, connected listing matching the same
independently read bounded provider page, unchanged provider data, accurate final
count/IDs, no mutation receipts and no approved review. It measures the listed
page and connected read path, not full CRUD or pagination completeness.

## Procedure and review boundary

1. Start the local control plane and native platform services/workers using the
   current shared capability host policy and consistent run/context directories.
2. In the frontend, connect the real Memos test account, save its credential,
   discover/select tools, import/inspect the notes skill and create
   `notes-acceptance`. Memos writes retain invocation review. Configure the pinned
   memory provider as a managed stdio package and create `memory-acceptance` with
   its `mcp-memory-2026_read_graph` tool.
3. Show the task prompts, then perform a fresh free-model catalog check. No paid
   fallback is allowed. Run one workload/platform at a time when diagnosing
   setup, model or provider failures.
4. For every pending Memos write, the observer independently reads the exact
   marker and compares the proposed arguments with the expected operation.
   Approve creation only when the note is absent and the exact private content
   and ID match. Approve update only after acknowledged creation and matching
   original provider content. Approve deletion only after acknowledged update
   and independent readback of the exact updated private note.
5. Allow the optional `force` delete argument only when absent or explicitly
   `false`. Deny unrelated IDs, extra mutation fields, changed visibility or
   unexpected operations. A wrong proposal remains visible in evidence.
6. Inspect ordered native tool receipts, review records and independent
   application readbacks. Require all workload assertions for a pass.
7. On interruption/deadline, cancel and inspect the native run. Preserve partial
   receipts and snapshots. Do not silently restart a dispatched write or delete
   a leftover note with a direct provider operation.

The observer never performs provider mutations. Independent readback uses a
server-side test credential; it is not another agent tool grant. Stdio verification
reads infrastructure-owned provider persistence directly, while the agent reads
only through MCP. This does not add native filesystem access to the agent.

If an acknowledged test note remains after interruption, the separate
`--cleanup-existing` mode requires one exact retained marker and one native
platform. It reads/verifies that disposable note and submits one reviewed delete.
This is explicit cleanup with retained evidence, not an automatic write replay.

## Reproduction commands

Run from the repository root after configuring the frontend profiles and showing
the prompts. Secrets belong in the local deployment environment, never CLI
arguments, committed configuration or evidence. The script loads the local server
environment and requires `AGENTLAB_MEMOS_AUTHORIZATION` for independent Memos
readback. The provider endpoint defaults to `http://127.0.0.1:5230/mcp`.

```sh
pnpm --filter @agent-harness-lab/lab-server exec tsx \
  scripts/check-managed-capabilities.ts \
  --api http://127.0.0.1:4322 --platforms langgraph \
  --model cohere/north-mini-code:free --deadline-ms 240000
```

For the real managed stdio provider, supply its persistence path for independent
read-only verification:

```sh
pnpm --filter @agent-harness-lab/lab-server exec tsx \
  scripts/check-managed-capabilities.ts --stdio \
  --api http://127.0.0.1:4322 --platforms mastra \
  --model cohere/north-mini-code:free --deadline-ms 180000 \
  --memory-file /absolute/path/to/managed-memory-provider.jsonl
```

Run the narrower notes read workload after showing its prompt:

```sh
pnpm --filter @agent-harness-lab/lab-server exec tsx \
  scripts/check-managed-capabilities.ts --read-only-notes \
  --api http://127.0.0.1:4322 --platforms mastra,restate \
  --model nvidia/nemotron-3.5-lightning:free --deadline-ms 240000
```

`--deny-create` exercises deliberate creation denial; the agent must stop without
completing a mutation. The inspected LangGraph denial pass below verifies this
separate control. The exact currently free model
must pass fresh catalog admission before a command can run; its recorded ID does
not promise future availability or zero pricing.

See [capability management](../../../docs/guides/capability-management.md) for
credential/session setup and imports, and
[Memos notes](../../../docs/guides/memos-notes.md) for the real app deployment.

## Inspected evidence

| Workflow | Native baseline | Observed verdict | Run |
| --- | --- | --- | --- |
| Reviewed private Memos CRUD | LangGraph | Pass: all nine recorded assertions true | `7a7c65a2-a2ba-4f7c-abed-176bbde6fe3b` |
| Reviewed private Memos CRUD | Temporal | Pass: all nine recorded assertions true | `483b4393-2534-4c11-b2c9-4ec1eb404086` |
| Managed stdio graph read | Mastra | Pass: all seven recorded assertions true | `b55b8b4d-fffb-4e71-96a3-8eacaa2fa622` |
| Deliberate Memos creation denial | LangGraph | Pass: all six recorded assertions true | `04d255b8-bb5b-4523-8da1-20b0403044f1` |
| Skill resource + connected notes list | Mastra | Pass after documented observer correction: eleven assertions true | `f3bd9c99-7ae9-474d-ab31-4483ec23be91` |
| Skill resource + connected notes list | Restate | Pass after documented observer correction: eleven assertions true | `e86d88f4-948d-4d19-b79f-e564f41a5eb5` |

The [LangGraph result](../../runs/capability-manager-acceptance/managed-480de376-39cc-4ccf-b6f6-80ac869310a5/langgraph.result.json)
records ordered create/read/update/read/delete receipts, three approved exact
reviews, independent updated-content/private-visibility verification, provider
absence after deletion, the model's post-delete list check, explicit skill
preloading and verified free routing. The marker was
`cm-fa04864794484a4db499f807ab`.

The [Temporal CRUD result](../../runs/capability-manager-acceptance/managed-a6d297c4-74ba-498a-a7c9-af4062400744/temporal.result.json)
independently passes the same nine notes assertions with
`nvidia/nemotron-3.5-lightning:free` and marker
`cm-50046e0051ed41fd8d614cb583`. Its observer deadline was 240 seconds.

The [LangGraph denial result](../../runs/capability-manager-acceptance/managed-ab7ec65c-dc8e-47f3-bb82-f4ae9fdb9e33/langgraph.result.json)
records one denied creation, no approved mutation, no completed mutation,
independent provider absence, preloaded skill and verified free routing. It uses
`cohere/north-mini-code:free` with a 180-second observer deadline. This is a denial
control, not a CRUD completion pass.

The [Mastra stdio result](../../runs/capability-manager-acceptance/stdio-3846c237-8b82-41e9-83bc-9241c368fc03/mastra.result.json)
records a real MCP graph read matching the provider snapshot, unchanged
persistence, matching model counts and no other tools. The graph was empty: zero
entities and zero relations. This pass proves the narrow read path on that state;
it does not test non-empty graph interpretation, memory CRUD or persistence writes.

The [notes aggregate](../../runs/capability-manager-acceptance/managed-480de376-39cc-4ccf-b6f6-80ac869310a5/summary.json)
also retains non-passing Mastra, Temporal and Restate outcomes from that invocation.
A false routing assertion on a run that never reached model observation means
missing verification, not evidence of paid model use. Later platform trials must
be inspected separately and appended without replacing these earlier outcomes.

These generated evidence paths are local, ignored run artifacts. A fresh clone
must execute the methodology to create its own records; the source README does
not fabricate downloadable run data.

## Frontend and restart evidence

The separate [management lifecycle record](../../runs/capability-manager-acceptance/management-lifecycle.json)
records frontend installation of `notes-bundle@1.0.0` with dependency
`notes-check@1.0.0`, its tool/skill packages and `bundle-acceptance` profile.
Following an API restart without the Memos startup credential,
`notes-acceptance`, `memory-acceptance` and `bundle-acceptance` were available.
Process inspection reported only whether the Memos startup credential was
present; secret values were not captured. This supports saved configuration/credential continuity for that local
restart, not arbitrary backup recovery or a distributed deployment guarantee.

The same record identifies frontend OAuth authorization, discovery of
`oauth_probe`, refresh, refresh after backend restart and subsequent frontend
revocation. The revoked summary reported `revoked` and credential `not available`.
This uses the fake-data local OAuth probe at loopback port 9198, not a production
identity provider or a real external account.

A repeatable connection-only walkthrough is documented in the
[managed OAuth MCP fixture](../../../development/playground/managed-oauth-mcp/README.md):

```sh
node development/playground/managed-oauth-mcp/provider.mjs
```

With that provider running, use a second terminal:

```sh
pnpm --filter @agent-harness-lab/lab-server exec tsx \
  ../development/playground/managed-oauth-mcp/check.ts
```

It checks PKCE, connected tool execution, refresh-token rotation, rejection of
retired refresh credentials and revocation with temporary managed state. It makes
no model calls and therefore measures connection lifecycle independently of the
native-agent workloads.

## Failure interpretation and remaining work

Earlier trials remain under `lab/runs/capability-manager-acceptance/`. Investigated
failure categories include provider rate limiting (HTTP 429), model proposals
with incorrect provider argument shapes, an observer bug rejecting the harmless
explicit `force: false` deletion argument, stale worker policy/configuration, and
invalid bundle/schema validation that was subsequently corrected. Distinguish
provider/model outcomes from observer/setup defects when interpreting each
record. Correcting a checker does not retroactively turn an old verdict into a
pass; fresh executions supply the revised evidence.

The inspected pass set is deliberately small and partial. Read-only notes trials
for the remaining native platforms and current-head verification remain to be
reported where required. The pending read-only trials must not be described as
full CRUD acceptance for Mastra or Restate. UI setup evidence and focused deterministic
tests establish separate management behaviors; they do not substitute for real
native execution evidence. No reliability percentage, performance comparison or
claim of comprehensive agent eval satisfaction follows from these scoped passes.

## Corrected read-only observer evidence

The [Mastra correction](../../runs/capability-manager-acceptance/read-only-b2d08dc7-1bdb-47e9-9fe5-fbf5d8d44d37/mastra.regraded.json)
and [Restate correction](../../runs/capability-manager-acceptance/read-only-b2d08dc7-1bdb-47e9-9fe5-fbf5d8d44d37/restate.regraded.json)
pass eleven assertions using `cohere/north-mini-code:free`, a 180-second deadline
and source commit `f64bc6b` with the recorded dirty-worktree flag. Both agents
read the actual skill resource and queried Memos. Each returned zero notes/IDs,
matching the independent private tagged page after cleanup. These are narrow
empty-page reads, not CRUD passes on those platforms. The models initially
submitted malformed read filters, received provider errors and corrected them;
those receipts remain in the original records. No mutation was approved.

The first grader required an internal “Previously read skill resource” heading.
Native requests actually carried the same resource in a correlated tool-role
message. The correction checks the completed receipt, later event order, exact
tool-call ID, package/name/path/digest/content/encoding and `untrusted`/`none`
metadata in the actual model request. This measures delivery without requiring
a runtime-specific presentation label. Original failed `.result.json` files
remain untouched. Correction records retain original hashes/assertions/verdicts,
configuration hash, grader source hashes/revision, time and reason. Offline
regrading made no model calls or provider changes:

```sh
pnpm --filter @agent-harness-lab/lab-server exec tsx \
  scripts/check-managed-capabilities.ts --regrade-read-only \
  /absolute/path/to/lab/runs/capability-manager-acceptance/read-only-<uuid>
```

## Cleanup and final validation

All five acknowledged leftover disposable notes were removed through separate
reviewed native LangGraph tasks. The observer required retained creation proof,
exact private content/identity, a completed read, one authorized delete and
independent/listed absence. Passing cleanup runs were:

- `2074f11b-160a-4aa5-8d8e-5e6c1d9522ab`
- `2ff768ad-6a05-4dff-a0e2-0d579951b7dd`
- `44a5cba5-3544-4659-bd1e-6d4225fa90f4`
- `7511067a-f4db-4f0a-a45b-b1fd61a5d9ae`
- `15aa8b1c-0b22-42fe-a119-af181ddb6411`

An initial `force:true` cleanup proposal was denied. A separately recorded task
clarified that force must be omitted or false; it was not an uncertain-write
replay. No known disposable notes remain and no direct provider writes were used.
An earlier interrupted LangGraph run `a14c13b5-b4ac-4d4a-9bf4-8ba953cdf0ce` remains
`reconciliation_required`; it is retained uncertainty, not a successful run.

Scoped management, credentials, imports, OAuth, transport, host/catalog,
administration/network and free-policy checks passed. The corrected grader's
two tests reject mismatched call/digest/authority and pre-receipt model requests.
Final server typecheck and web production build passed, including generation of
93 curated documents. Browser verification covered import/profile composition,
credential presence, OAuth handoff/refresh/revocation, Memos refresh and profile
selection after restart. A modal stacking defect was fixed and visually checked.
Screenshots: [connections](../../runs/capability-manager-acceptance/frontend-connections.png)
and [selected profile](../../runs/capability-manager-acceptance/frontend-profile.png).
No native agent filesystem capability was introduced. Secret files, installed
provider state and generated run records remain ignored; unrelated Studio/Lina
work was preserved. Broad load/fuzz/chaos testing and hosted multi-user deployment
were deliberately outside this functional acceptance.

For stdio, the pinned upstream memory package was installed on the backend
before its executable/arguments were configured in the frontend. The configured
Lab package revision and upstream npm version are separate recorded identities.
Browser-driven arbitrary executable/package installation was not measured or
implemented; the process host is a lifecycle boundary, not an OS sandbox.
