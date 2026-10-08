# Lina architecture workspace

Open `/studio/lina` from **Lina architecture** in Studio. Lina is the user's agent
design, separate from the source explorers and the laboratory's executable reference
assembly. The page loads the maintained Input, Turn Execution, Context, Tools, Model Interface, Safety, State, Memory, Subagents, Planning and Execution Environment design. Agreed decisions and open
proposals are labelled separately.

Architecture components and connections are maintained through our design work.
The page provides navigation and layout controls, with no manual component
creation, deletion, or connection editor. Selecting a node opens concise
architecture documentation: responsibilities, inputs, outputs, decisions, and
source mappings. Bullets describe concrete contracts and separate open questions.

**Study** holds source references and observations from Hermes, OpenClaw, Pi, and
Waku. **Design** holds decisions and open questions. **Experiments** holds proposed
alternatives and controls. Design statuses do not indicate runtime implementation.

The nodes contain responsibility, input/output, agreement, open-question, and
source-explorer mapping notes. Execution handoff connects Input to Turn Execution;
delivery and restart reconciliation retain their separate boundaries. Active-work
reconciliation belongs to Turn Execution, preserving its existing node ID when
older saved designs refresh. Its move preserves user annotations; other saved
positions and custom content remain intact.
**Fit** shows the overview. Loading the design fits the full map. Selecting a component in the index centers it at
a readable zoom of at least 85%. Mouse-wheel or trackpad gestures over the canvas zoom around
the pointer from 5% to 200%. Drag empty canvas space to pan. Drag a node to reposition that component. Drag any block header to move
all that block's nodes together, preserving connections and other components. Group moves
are draft edits until saved.
Shift-wheel and scrollbars also move the canvas. The zoom
buttons preserve the viewport center. Connections show proposed routing, including bypass branches.
**Arrange blocks** places Input left of Turn Execution, Context below Execution,
Tools to its right, and Model beside Context near Tools. Whole blocks move without
changing their internal layout, notes or connections. Empty future regions sit near
their expected consumers. The requested arrangement applies once to older browser
drafts, preserving previous positions for Undo. It remains a draft until Save design.
You can drag groups afterward; Reload keeps those choices.

**Reset input layout** restores the preset input nodes to their original relative
arrangement beside other components. It changes positions only, preserving notes,
statuses, connections, and custom nodes. **Undo layout reset** restores the previous
positions. Turn Execution positions are unchanged by Reset input layout. Reset and undo are draft edits until saved. Reset affects nodes already in the document. Reviewed graph updates add missing
components when the design reloads.
The preset is design data and does not execute Lina or the source agents.

Empty regions reserve Computer Use, Output and delivery,
and Observability. Use **Planned blocks** in the
sidebar to center one. These regions contain no nodes or connections and are
not simulated. Computer Use is deferred. Their placement is computed beside the current graph; they are
canvas guides rather than saved or draggable components.

The **Components** and **Inspector** controls independently collapse or restore
the sidebars. Selecting a node automatically opens its inspector with its notes.
The component list remains collapsed if hidden. The canvas uses the released space. Panel preferences are stored
in the browser separately from the architecture document.

## Node contracts

Every maintained node has a **Contract** tab with an input schema, selectable
input examples, branch output schemas/examples, coordinator context and state
rules. Connections show their transferred output variants. Schemas and examples
are provisional design references, separate from current playback and saved
layout. They do not enforce a real agent runtime.

Schemas and examples use a syntax-colored JSON tree. Expand the arrows beside
objects and arrays to inspect nested fields; each section folds independently.
The root starts open and nested sections start closed. Tab to an arrow and press
Enter or Space to toggle it. Selecting another example resets its tree.

The review covers multiple input forms across CLI, WhatsApp and downstream
nodes, including explicit controls, prompt answers, queue wakes, restart records,
model failures and tool outcomes. Telegram additionally has an event-router
node for DMs, groups/topics, channel posts, edits and callbacks. Channel-post and
edit policies are represented but withheld until their authority/routing rules
are decided. WhatsApp delivery observations go directly to delivery without
creating new agent work. Safe checkpoint resumes bypass fresh Start turn.

See [node contracts and examples](../../../../../docs/research/lina/node-contracts.md)
for the contract vocabulary, corrected gaps and remaining policy decisions.

## Context block

**Prepare round** enters **Bind context scope** before loading versioned sources, ordering instructions,
selecting conversation history, adding task material and preparing permitted tool context.
**Shape observations** retains canonical rich results and artifact references while
producing the model projection. Selected connector resources/prompts return through
Context load; declared projection hooks run before budgeting.
The candidate goes through **Check context budget**, optional **Prune context** or
**Compact history**, then non-mutating **Validate model context** and **Publish
context snapshot**. Publication returns to Prepare round to recheck launch
permission before Call model. New logical rounds repeat Context preparation;
provider retries reuse their prepared snapshot.

Context is a proposed design and scripted simulation. Original history/tool
records remain distinct from selected model-visible context. Schemas and examples
include source provenance, protected groups, tool-call/result IDs, estimated
budgets, selection manifests and summary failures. They do not read real memory,
summarize with a real model, or publish real provider requests. Simulated subagents reuse the same contracts
with separate agent/history/task identities.

The Run modal's **Context case** chooses the first preparation path:

| Context case | Scripted behavior |
| --- | --- |
| Fits budget | Validate and publish directly |
| Prune context | Mask older observations, retain original references and linked calls/results, then recheck |
| Compact history | Use a labeled fixture summary, retain protected/recent history, then recheck |
| Compaction fails | Settle failed and release without a main-model call |
| Protected context too large | Refuse preparation and release without a main-model call |
| Invalid context | Reject an unmatched tool result and release without a main-model call |
| Catalog changes before launch | Reprepare the changed snapshot without resetting model counters |
| Context projection hook | Apply one declared hook and recheck the budget |
| Selected connector resource/prompt | Acquire the selected fixture source and return to Context load |
| Foreign scope refused | Refuse before source loading or model invocation |

Subsequent preparations in the same simulation use the fits-budget fixture.
A context failure takes precedence over the chosen model/tool execution case.
Preparation/reduction counts describe simulation visits, not token usage or model
performance. Node and connection contracts remain reference examples, separate
from the current playback state.

Older saved designs gain the Context block below Turn Execution without resetting
user positions, statuses, experiments or custom connections. The Context header
moves its nodes as a group. **Save design** acknowledges those graph/layout changes
through the existing API; simulation state is transient.

See [Context research](../../../../../docs/research/lina/context-research.md) for
source comparisons, boundaries and proposed mechanism experiments.

## Model Interface block

The four maintained nodes are **Resolve model binding**, **Encode provider
request**, **Invoke and collect response**, and **Normalize model outcome**.
The Model slice brought the maintained design to 91 nodes and 221 connections, including 21
Model connections. The former empty Model region is replaced by these nodes;
older saved designs gain them while retaining custom content and existing layout.
The Model header moves its nodes together.

Context load requests model metadata before budgeting. Metadata resolution
returns to the same preparation without launching inference. Call model then
delegates invocation through the current binding and accepted snapshot. Encode
preserves the calculator schema, tool names and complete call/result history;
the first request has no invented earlier tool result. Changed bindings or output
budgets return through bounded Context preparation. Actual simulated launches
consume provider attempts, and the first launch of a logical round consumes that
round. Retry stays in the same round and uses a distinct attempt.

Expand **Model settings** in the Run modal to choose **Model protocol** and
**Model case**. The four local profiles illustrate Chat Completions, Responses,
Messages and Gemini GenerateContent. They use fake models, credentials, limits,
usage and protocol records. Gemini Interactions and gateway routing remain
researched extensions, not additional live integrations.

Model cases include interleaved calls, text plus calls, missing/partial usage,
refusal, empty content, truncation, malformed or duplicate calls, missing/unknown
finish evidence, failures before or after a preview, HTTP 200 with an error,
unsupported requirements, changed profiles and credential readiness. Draft
buffers remain unlaunchable until Normalize accepts the complete response.
Ordinary tool calls then follow the existing parallel Tools path.

The Model work disclosure shows active attempt identity, draft buffers, the
encoded fixture request, normalized outcome/usage and prior attempts as colored,
collapsible JSON. Preview text from a failed attempt remains nonfinal. Usage
availability distinguishes reported fixture counts, partial observations and
unknown values; these are not performance measurements.

Model readiness uses the shared credential lane with a Model-tagged owner.
Matching **Account ready**, **Deny** or **Expire** resumes or refuses the original
metadata or invocation intent. A different account is rejected. Stop can cancel
resolution, readiness or encoding before a request launches. During streaming it
accounts for the exact active attempt; the delayed-settlement case requires
**Confirm local settlement**. Local cancellation does not claim remote processing
or billing stopped. Late events cannot revive the stopped turn.

See the [Model research](../../../../../docs/research/lina/model-interface-research.md)
and [implementation checklist](../../../../../development/implementation-plans/studio/completed/lina-model-interface.md).
There is no provider client, real credential exchange or production tokenizer in
this design slice.

## Follow a message

### Run a turn simulation

Click **Run** and configure the channel, execution case, Context case, round limit,
playback pace and graph following. Tool cases also expose **Tool batch** settings;
**Model settings** holds protocol and response-case choices.
No actual message text is needed. **Manual · Next button** starts paused at the
adapter; **Automatic** uses the same event reducer at a one-second viewing pace.
**Graph following** can center the current event or leave navigation to you.

**Pause** pauses playback; **Next** advances one event; **Resume** continues.
**Stop turn** signals cancellation after admission. It prevents new launches,
accounts for active calls and retains uncertain writes until evidence arrives.
Pausing does not cancel work. **Reset** clears transient state and returns to the
selected adapter paused. A new Run replaces the previous simulation.

The fixture starts with an ordinary admitted message, an idle conversation and
no attachments. Telegram uses an activated group/topic. The execution cases are
direct answer, tool round, model retry, tool error and correction, terminal tool
failure, non-retryable model failure and loop limit. Provider retry consumes a
new attempt in the same logical round; adapter retry retains its call identity
and consumes its own attempt budget. Context refresh does not reset either.

Tool playback traverses the detailed resolve, hook, validate, permission,
schedule, dispatch, collect and publish nodes. The batch choices are:

| Tool batch | Visible behavior |
| --- | --- |
| Independent parallel calls | Two calls overlap; the second finishes first; canonical results retain call order |
| Conflicting ordered calls | The next call starts after the conflicting call settles |
| Known error and success | Preserve both outcomes before the next model round |
| Approval wait | Keep the pending call and completed sibling; Approve, Deny or Expire resolves it |
| Account authorization wait | Resume the original binding after Account ready; reject a different account |
| Tool input continuation | Resume the same operation/attempt without dispatching it again |
| Unknown write outcome | Wait at reconciliation; require effect or no-effect evidence before continuation |
| Bounded read retry | Readmit the original safe call with a new attempt; retain its settled sibling |
| Argument hook | Apply the mutation before schema validation and permission checking |

Wait controls appear when needed. **Try mismatched response** demonstrates a
rejected response without releasing the retained operation. Next and Resume stay
disabled until the wait is resolved. Active call IDs and statuses appear on the
graph; the work disclosure lists attempts and known results. Stopping an uncertain
write keeps reconciliation active and settles cancelled only after evidence,
without restarting the ordinary reasoning loop.

The trail preserves repeated visits, side notifications and individual result
events. Missing required nodes/connections block playback. Both playback modes
produce equal semantic state for the same fixture decisions. The progress strip
shows logical rounds, provider attempts and fixture preparation/reduction counts;
it does not measure latency or model performance.

This is deterministic design simulation. It runs no real channels, models,
adapters, credentials or plugins and never saves run state to the architecture.
Restart recovery, real persistence, child orchestration and unrestricted steering
remain contracts/future work. Output and owner release describe handoffs rather
than actual delivery or queue draining. Node examples remain reference fixtures,
separate from the live simulator's internal state.

`inputSimulation.ts` owns graph fixture events and the reducer; `modelFixtures.ts`
owns fake encoding, per-attempt stream assembly and structural normalization.
`LinaSimulation.tsx`
owns configuration and controls; `LinaPage.tsx` schedules and renders playback.

### Inspect the graph and illustrative paths

Selecting a node emphasizes its incoming and outgoing arrows on the graph and
shows their labels. Unrelated arrows remain faint. **Selected node only** hides
unrelated connections. Click an arrow to inspect its label and endpoints; click
an endpoint to follow that component. Component documentation remains in the
inspector, without a separate list of request paths. Navigation does not edit
the saved design.

**Follow a message** steps through illustrative input scenarios. **Next step**
follows the selected scenario; route buttons explore another outgoing connection.
**Back**, the visited-step list, and **Restart** navigate the walkthrough. The map
highlights visited nodes and connections and opens the current node's documentation.

These paths describe Lina's design, not recorded execution. Queue, steering,
interruption, recovery, and delivery retain their unresolved contracts. Acceptance
can emit a receipt and dispatch work; these connections are separate consequences.
The illustrative walkthrough still ends at the Input boundary. The separate
Run simulation follows Turn Execution, Context, Model Interface and detailed Tools paths;
it does not expand these alternate walkthrough scenarios.
Walkthrough navigation changes no saved architecture data.

## Persistence and recovery

**Save design** commits the complete document through the Studio API to the existing
local SQLite database. Edits remain a browser draft until acknowledged; the status
makes this distinction visible. A browser draft is written before accepting each
edit. Navigating away or reloading restores it. Clearing browser data loses pending
changes but not database saves. **Export** downloads the current design, including
unsaved edits, as JSON for a separate backup. Import from an exported backup is not
yet implemented.

The API uses optimistic revisions. Stale writes return 409 instead of overwriting
newer database work. Download your draft before choosing **Load database copy
(discard draft)** when resolving a conflict. Pending local drafts are scoped to the
configured API URL. Multiple tabs can still overwrite their shared browser draft;
use one editing tab at a time. There is no live subscription to another editor's
changes. Local SQLite does not protect against losing the computer; hosted storage
is not configured. See [Studio API](../../../../../apps/studio-api/README.md).

The version-1 document contains nodes with identity, position, area, status,
and design notes, plus labeled edges. Stable IDs keep relationships attached when titles change.
No dependencies or executable harness changes are introduced by this page.

Validation includes focused route and saved-design refresh tests, TypeScript
compilation, production build and live browser checks of both playback modes,
loop highlighting, group dragging and isolated SQLite save/reload. These verify
simulation and design navigation; no agent/model/tool execution is performed.

Run the focused checks with the workspace's existing TypeScript runner:

```sh
pnpm --filter @agent-harness-lab/studio-api exec tsx --test ../web/tests/linaContracts.test.ts ../web/tests/linaArchitecture.test.ts ../web/tests/linaSimulation.test.ts ../web/tests/linaToolsContracts.test.ts ../web/tests/linaRevisitContracts.test.ts ../web/tests/linaRevisitSimulation.test.ts ../web/tests/linaModelContracts.test.ts ../web/tests/linaModelFixtures.test.ts ../web/tests/linaModelSimulation.test.ts
pnpm --filter @agent-harness-lab/web typecheck
```

## Technical design document

The [Lina input architecture](../../../../../docs/research/lina/input-design.md)
records agreed input decisions and proposed control behavior for review. The
[Turn Execution research](../../../../../docs/research/lina/turn-execution-research.md)
informs the next block's responsibilities. `executionBlock.ts` defines its fourteen
proposed nodes and branch connections. Conversation admission establishes turn
identity and ownership authority; Start turn consumes them without a second
admission. Settle turn records the outcome and hands produced output to delivery;
Release turn emits owner-release information back to Conversation queue. Answer
production, settlement, release and successful delivery are separate events.
These are design contracts and scripted paths, not an implemented Lina runtime
or finalized execution policies.

Maintained Input, Turn Execution, Context, Tools, Model, Safety and State documentation refreshes on page load while
retaining user-arranged positions, statuses, experiment notes and custom nodes.
Maintained connections refresh in their own namespaces; unrelated connections
remain intact. Older designs gain missing execution nodes below Input without
overlapping existing nodes. Nodes use
300 × 144 canvas units, with room between branches and connection labels. Routes
avoid other node boxes where a clear candidate lane is available. Reset restores
the Input preset only. Only empty, unconnected legacy nodes titled New component are removed.
Refreshed documentation and layout become a browser draft until saved. An older
draft adopts the current database revision only if refreshed documents match
exactly; distinct edits still require conflict resolution.

The compact-spacing update applies once per browser, including older drafts.
Previous positions remain available through **Undo layout reset**, and the prior
draft is backed up in browser storage before applying the update. Later manual
moves remain intact. **Reload design** fetches the database again while preserving
pending drafts. Conflicting design edits still require explicit resolution; reload
does not silently discard them.

## Audited route corrections

The graph includes group activation and ignored traffic, explicit input failure
outcomes, queued work and wake events, preaccept claim recovery, and separate
restart paths for unstarted work, interrupted execution, and saved answers.
Explicit Queue actions bypass batching; ordinary messages can select a busy
policy at admission. New lifecycle details remain proposed where the technical
document records an open decision. Maintained graph updates preserve existing
node positions and experiment notes while adding missing nodes and correcting
maintained connections.

## Tools setup and execution design

The Tools block has 33 proposed nodes in five visual lanes: connections,
credentials, plugins and registry, skills, and per-batch execution. Select a node
to inspect its responsibilities, outgoing paths, JSON schemas and examples.
Setup paths begin from configured lifecycle events or on demand; they do not
repeat plugin loading or authorization on every model round.

The credential lane shows reference resolution, protected retrieval, validity,
authorization, persistence, coordinated refresh and removal. Examples expose
account/issuer/resource binding, private operation references and safe status.
They never expose actual access tokens, refresh tokens or authorization codes.
No selected credential-store backend or successful real authentication is implied.

Discovered MCP/native capabilities, plugin contributions and built-ins enter a
versioned registry. Context receives a catalog projection and activated skill
instructions/resources. The detailed execution path connects Execute tool batch
to resolution, validation, permissions, bounded scheduling, dispatch, collection,
publication and the existing outcome/reconciliation gates. Call IDs, catalog and
account bindings remain explicit through the handoffs.

Detailed tool playback follows these routes with retained operations and fixture
results. Resource and prompt acquisition belong to Tools; Context owns their
selection, trust and inclusion. Plugin contributions are staged until activation
publishes an active generation. Catalog schemas, binding identity, skill provenance
and rich artifacts survive the handoffs. Argument hooks precede validation and
permissions; adapter retries require known effect semantics. Unknown writes are
reconciled without automatic replay. Real adapters, plugin execution, credential
storage and external sign-in remain unimplemented.

Saved designs gain this block on design refresh while retaining positions,
statuses, user experiment notes and custom graph content. Drag the Tools header
to move all its nodes together. The former empty Tools region disappears.

See the [research](../../../../../docs/research/lina/tools-architecture-research.md)
and [node setup checklist](../../../../../development/implementation-plans/studio/completed/lina-tools-nodes.md).


## Safety and permissions

Five Safety nodes resolve policy, evaluate the final operation, register review,
manage scoped permission grants, and authorize the queued launch. The Safety slice added five nodes and 31 connections. Safety is placed beside Tools and is added
to older editable drafts without replacing user notes or custom connections.

In **Run → Safety settings**, choose a permission case. Selecting a Safety case
that needs tools selects a Tool round. Run in Automatic or Manual mode; both stop
for an explicit review choice. Choose Allow once, Allow for this session, Always
allow this scope, or Deny. The displayed review scope shows the operation, target,
account and exact fixture matcher. When several requests wait, **Pending response**
selects which one to answer. Expire and mismatched-response controls exercise the
other branches. Inspect permission evidence and fixture grants through collapsible
JSON details.

Grants can carry into another run in the same page session. Review creates a new
fixture grant; matching reuse, mandatory review, session end and revocation are
selectable cases. Persistent-grant failure and unknown acknowledgment cases are
exercised by choosing Always allow this scope. Unknown storage is inspected using
the original transaction identity before refusing an uncommitted operation.
Changed binding/policy cases demonstrate refusal at final dispatch, after earlier
admission. Reset restores the original run fixture inputs.

These controls operate on deterministic in-memory fixtures. "Always" models a
persisted grant acknowledgment; it does not store a real account permission or
survive browser reload. Authentication, permission and effect certainty remain
separate. Live durable storage, Environment enforcement and child agent processes remain
unimplemented; Studio models their lifecycle with fixtures. See the [research](../../../../../docs/research/lina/safety-permissions-research.md)
and [implementation checklist](../../../../../development/implementation-plans/studio/completed/lina-safety-permissions.md).


## State, persistence and recovery

Four State nodes serve existing block owners through correlated requests and
returns. State is placed below Input beside its execution dependencies. The
State slice brought the graph to 100 nodes and 313 connections. The maintained
graph, including Memory and Subagents, now has 120 nodes and 477 connections,
with 120 provisional contracts.
Saved drafts gain the new block without replacing notes, custom content or
existing positions. The layout refresh groups related blocks and can be undone.

In **Run → State and recovery settings**, choose one of fourteen recovery cases.
The fresh case shows commits, bounded reads and explicitly requested checkpoints.
Other cases model duplicate input, lost commit acknowledgment, restart before
launch, completed parallel siblings, restored approvals, unknown tool effects,
Stop, incomplete checkpoints, incompatible schema, missing artifacts, competing
owners, unavailable storage and uncertain reply delivery. Cases requiring tools
set the relevant execution, tool and Safety settings. Auto and Next share the
same event reducer. Reset starts from the original selected fixture inputs.

The **State evidence** disclosure shows the current phase and outcome. Its nested
JSON includes fixture records, stable transactions, revisions, ownership and
checkpoint manifests. An acknowledged commit returns to the exact requester.
Launch intent and outcome commits are separate. Checkpoints preserve counters,
settled sibling results and pending operation identities. Recovery does not
increment model-attempt counters by itself.

Approval recovery restores independently selectable waits with their reviewed
scope. Session grants expire across modeled restart; persistent grants remain
subject to current review and binding checks. A result already recorded for a
parallel sibling is not executed again. Unknown tool effects pause for Effect
confirmed or No effect confirmed under their original reconciliation owner.
Uncertain delivery pauses separately and preserves the saved reply and delivery
identity. A confirmed absence of delivery keeps the owed reply; it does not
pretend it was delivered or automatically resend it. Stop remains latched after
restart. Invalid recovery evidence withholds launches.

All records and restarts are deterministic in-memory fixtures. No process is
actually crashed, no database execution checkpoint is written, and no external
action is sent. The architecture editor's SQLite storage is separate. Live backend
transactions, crash recovery and remote effect guarantees need their own runtime
implementation and tests. See the [research](../../../../../docs/research/lina/state-persistence-research.md)
and [slice checklist](../../../../../development/implementation-plans/studio/completed/lina-state-persistence.md).


## Memory

Twelve Memory nodes form recall, mutation and maintenance branches beside Context.
They connect to the existing Context, Tools, Model, Safety, Execution and State
owners through 87 requester-specific relationships. Saved designs retain notes,
positions and custom edges when the maintained block is added.

In **Run → Memory settings**, select one of 21 cases. Context prefetch and explicit
memory search follow separate return paths. Other cases cover disabled/unavailable
memory, scope access, remembering, correction, unresolved conflict, duplicate or
uncertain commits, index lag, consolidation, forgetting and cancellation. Automatic
and **Next** playback use the same events. **Graph following** can follow each event
or leave the graph available for manual exploration.

**Memory evidence** shows the current decision; its nested JSON includes fixture
records, revisions, source lineage, index visibility, pending work and cleanup
coverage. A State acknowledgment precedes publication; a committed record may
still await indexing. Corrections retire an earlier record while preserving its
historical validity. Forgetting immediately excludes targets and derivatives from
recall, invalidates cached selection and cancels pending work that could recreate
them. Purge coverage reports unfinished replicas explicitly.

The child-publication case pauses for parent review. **Publish to shared memory**
admits only the matched candidate; **Keep private** or **Expire review** leaves
shared storage unchanged. This models the publication boundary reused by child-instance simulation;
it does not launch live child processes. Stop cannot resume an uncommitted candidate.
Automatic extraction requires eligible observed evidence; a final assistant answer
alone is not admitted as knowledge. Auxiliary extraction/consolidation requests
have their own Model purpose and do not count as main-loop attempts.

All memory stores, models, restarts and observations here are deterministic design
fixtures. They do not implement a live retrieval engine, memory database, remote
purge or extraction model, and provide no memory-quality measurements. See the
[accepted research](../../../../../docs/research/lina/memory-research.md) and
[completed slice checklist](../../../../../development/implementation-plans/studio/completed/lina-memory-block.md).

## Subagents / multi-agent orchestration

Eight lifecycle nodes connect delegation admission, child task preparation, launch,
coordination, selective joins, cancellation, reconciliation and result return.
Children reuse the existing Execution, Context, Model, Tools, Safety, Memory and
State graph under separate agent/session/task/turn identities. Their terminal and
owner-release events return to coordination rather than external user delivery or
the parent conversation queue. A child can request another child; configured depth,
concurrency and total task-tree limits govern admission.

**Run → Subagent settings** provides delegation cases and policy settings.
The fixture inventory covers one/parallel/nested children, admission limits and
queued capacity, selected/fork/task-only context, worker profiles, child approval
and Memory review, background work, explicitly detached ownership, persistent
follow-up, steering, selective joins, partial failure, cancellation, uncertain
launch, restart, duplicate/stale/late events and result delivery. **Auto** and
**Next** use the same instance-tagged event stream. The agent-instance selector
inspects Main or a child while graph following can stay automatic or manual.

Private child Memory starts in an empty agent store; parent/user private seed data
is excluded. Shared reads are explicit and do not enable shared writes. The specialist
preset activates a fixture source-review skill and a scoped connector dependency.
Task-only Context carries a new task packet, selected Context adds scoped source
evidence, and fork Context copies actual parent user evidence and complete observed
call/result groups. Pending calls and provider continuation remain with their owner.

Foreground versus background describes whether the parent waits. Attached versus
detached describes who owns the child lifecycle: parent Stop cascades attached
work, while detached work requires an admitted independent owner and explicit
closure. Persistent sessions retain private history, but follow-up assignments
have new task/turn identities. Selected joins preserve siblings; wait expiry does
not prove child completion. Unknown launch and result-delivery acknowledgments
inspect original identities rather than creating another child. Child text remains
an observation, with artifacts and trace references, rather than new parent policy.

These are deterministic design fixtures, including child runs through the existing
simulated harness. They do not spawn live agent processes or implement a durable
scheduler, remote delegation, sandbox enforcement or multi-agent performance
measurements. Peer teams and user-facing handoffs remain separate future patterns.
The [accepted specification](../../../../../docs/research/lina/subagents-research.md)
and [implementation checklist](../../../../../development/implementation-plans/studio/completed/lina-subagents-block.md)
record capability coverage and verification status.

## Planning and task management

Planning has eight maintained nodes beside Turn Execution. Open **Run → Planning
settings** to choose a case, task strategy, execution mode, maximum replans and
ready-work limit. **Plan only** produces a plan without operational execution.
**Review plan first** pauses for an explicit simulated response before work; this
response does not create Safety grants. Playback and graph following remain
independent settings. **Next** and Auto use the same event reducer.

The cases cover dependencies, parallel ready work, actual child executions,
failed prerequisites, insufficient evidence, user changes, revisions, invalid
references/cycles, duplicate/conflicting updates, unknown acknowledgements,
compaction, recovery, partial results and child-local plans. Planning evidence
and task records appear in collapsible JSON inspectors. Encoded fixture requests
include the current scoped task projection as data, preserving instruction
authority. A model assertion is labelled separately from fixture evidence checks.

Planning records and checkpoints reuse the simulated State journal. Parent and
child plans have separate agent scopes. Stop uses actual model/tool/child owners
and preserves unresolved effects and accepted earlier evidence. This remains a
design simulator, with fixed task/model outcomes and temporary fixture storage.
It does not invoke a live planner, establish real durability or measure planning
quality. See the [research](../../../../../docs/research/lina/planning-research.md)
and [implementation checklist](../../../../../development/implementation-plans/studio/completed/lina-planning-block.md).


## Execution Environment

Twelve nodes connect workspace acquisition, readiness, files, processes, evidence,
artifact custody and release. The maintained graph has 140 nodes and 643
connections. Open **Run → Execution Environment settings** to choose one of 26
entries, including **No workspace operation** (the default). Enabled cases expose:

- Execution target: current PC, Docker sandbox or remote sandbox.
- Workspace access: copied workspace, read-only mount or writable workspace.
- Child sharing: shared workspace or separate per-agent workspace.
- Network: inherited, none or restricted.
- Lifetime: retain or release after the run.
- Command deadline and bounded output size.

Selecting a case resets its settings to the declared defaults and case overrides.
Local defaults use writable shared workspace access, inherited network, retained
environment, a 30-second command deadline and 4,096 output bytes. These numbers
configure fixtures; they are not universal operational recommendations. Backend
capability evidence distinguishes requested restrictions from actual enforcement.
Local placement does not claim a filesystem or network sandbox.

Auto and Next use the existing reducer; graph following remains independently
configurable. Reconciliation pauses for a matched environment response. Expand
**Environment evidence** to inspect original operation IDs, generations,
workspace/process records and artifact custody as collapsible JSON.

The cases include local file round-trip, Docker reuse/copy/read-only behavior,
missing software/backend, resource limits, background/input/output/deadline,
uncertain launch/termination/cleanup, stale bindings, child sharing/isolation,
restart/resume limits, staging/export failure and pure/external bypass. Stop
controls exact owned work; lease release does not silently destroy borrowed
projects or sibling-owned processes. Workspace paths do not become retained
artifacts until custody is acknowledged. State journals/checkpoints retain scoped
fixture identities, and recovery inspects the original operation before reuse.

This is architectural simulation: no host files, commands, containers, credentials,
network settings or live processes are changed. Whole-agent container/VM deployment
is independent of tool placement. External services and MCP tools retain their
declared execution location. Browser provisioning is a future capability; Computer
Use interaction remains deferred. See the [research](../../../../../docs/research/lina/environment-research.md)
and [implementation checklist](../../../../../development/implementation-plans/studio/completed/lina-execution-environment.md).

## Output and delivery design slice

`outputBlock.ts` defines thirteen responsibility nodes and their owner handoffs.
`contracts/outputRecords.ts` and `contracts/outputDelivery.ts` supply provisional
JSON schemas, examples and outcomes. `outputFixtures.ts` prepares canonical
content, tracks recipient/part/attempt identities and runs controlled adapter
outcomes. `outputState.ts` records fixture outbox custody and restores the latest
channel ledger independently of an older execution checkpoint.

The default main reply now traverses Output. The Run modal exposes delivery cases,
final-only or preview presentation, completion evidence, unknown-send policy,
retry budget, fixture part limits and CLI presentation. Auto and Next use the same
reducers. Graph following remains independent of playback. Stop becomes Stop delivery after
execution ownership has been released; it cancels future transport work while
retaining uncertain effects for reconciliation. Tool clarification prompts preserve
the original input wait and use an answer schema rather than approval choices.
Open Delivery evidence
to inspect recipients, parts, attempts, native observations and retained artifacts.
No fixture sends an actual external message.

Required output transfers to retained delivery ownership before execution release.
Prompt custody does not terminate the reviewed turn or grant permission. Preview
acceptance does not fulfill required final output. Each recipient and ordered part
has its own evidence; safe retry preserves accepted siblings. Unknown sends retain
original identity for matched reconciliation, and Stop cannot undo external
acceptance. Restoring a turn never regenerates a saved answer merely to repair its
delivery.

CLI, Telegram and WhatsApp have separate declared fixture capabilities. CLI JSONL
and RPC output preserve machine records and keep diagnostics on stderr. Delivery
and read facts are available in the WhatsApp fixture; unsupported thresholds remain
explicitly unresolved on CLI/Telegram. The simulation's text/media limits are
teaching controls, not assertions of current provider/account limits. Live native
API versions, credentials, durable queues and remote guarantees remain future
harness work.

Internal child results return to their parent, while admitted external announcements
and notifications use the shared output path. Tool-requested messages record
confirmed target-specific evidence; equivalent final text may be suppressed without
losing distinct new content. Media requires retained authorized bytes, with original
upload intent and uncertain-upload recovery kept separate from message delivery.

See the [research and comparison](../../../../../docs/research/lina/output-research.md)
and the [implementation checklist](../../../../../development/implementation-plans/studio/completed/lina-output-delivery.md).
