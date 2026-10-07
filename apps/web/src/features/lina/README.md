# Lina architecture workspace

Open `/studio/lina` from **Lina architecture** in Studio. Lina is the user's agent
design, separate from the source explorers and the laboratory's executable reference
assembly. The page loads the maintained Input and Turn Execution design. Agreed decisions and open
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
delivery and restart reconciliation retain their separate boundaries.
**Fit** shows the overview. Loading the design fits the full map. Selecting a component in the index centers it at
a readable zoom of at least 85%. Mouse-wheel or trackpad gestures over the canvas zoom around
the pointer from 5% to 200%. Drag empty canvas space to pan. Drag a node to reposition that component. Drag either block header to move
all that block's nodes together, preserving connections and other components. Group moves
are draft edits until saved.
Shift-wheel and scrollbars also move the canvas. The zoom
buttons preserve the viewport center. Connections show proposed routing, including bypass branches.
**Reset input layout** restores the preset input nodes to their original relative
arrangement beside other components. It changes positions only, preserving notes,
statuses, connections, and custom nodes. **Undo layout reset** restores the previous
positions. Turn Execution positions are unchanged by Reset input layout. Reset and undo are draft edits until saved. Reset affects nodes already in the document. Reviewed graph updates add missing
components when the design reloads.
The preset is design data and does not execute Lina or the source agents.

Empty regions reserve Context, Memory, Tools, Model Interface, Planning, Safety
and permissions, Execution Environment, Computer Use, Output and delivery,
Observability, and State/persistence/recovery. Use **Planned blocks** in the
sidebar to center one. These regions contain no nodes or connections and are
not simulated. Their placement is computed beside the current graph; they are
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

## Follow a message

### Run a turn simulation

Click **Run**, choose CLI, WhatsApp, or Telegram, an execution case, maximum rounds, and
**Automatic** or **Manual** playback, then **Run simulation**. Manual starts paused
at the adapter and waits for **Next**. Automatic advances through Input and
Turn Execution, with its
current node marked in teal and its route highlighted on the graph. **Pause**
stops playback; **Next** pauses and advances one step; **Resume** continues.
**Reset** preserves the channel, execution case and round limit, clears the trail and returns
to the same adapter, paused. A new Run replaces the previous
simulation. Switching to the illustrative walkthrough pauses the simulation.

This first version uses one ordinary input with admitted access, a new message
identity, no attachments, and an idle conversation. Telegram uses an activated
group/topic. CLI does not batch. These are fixed simulation assumptions, not
runtime guarantees. Execution handoff is an intermediate visit. All seven cases
finish at **Release turn**:

| Case | Scripted execution |
| --- | --- |
| Direct answer | One model response, control checkpoint, settlement and release. |
| Tool round | One successful tool batch, another model round, then answer, settlement and release. |
| Model retry | One recoverable provider failure, one retry within the same logical round, then answer and release. |
| Tool error and correction | Error returned to the model, corrected tool call succeeds, then an answer. Needs three rounds. |
| Terminal tool failure | Tool outcome stops the turn, settles failed and releases ownership. |
| Non-retryable model failure | Model failure settles failed without retry, then releases ownership. |
| Loop limit reached | Explicit continuation repeats until the round gate refuses another model call. |

The limit gate permits at most the configured number of logical model rounds.
Provider retry uses another attempt within the same round, with one retry in this
fixture. The progress strip shows rounds, model attempts and the current decision.
Playback completion reports completed, failed or exhausted separately. An early
limit can stop the correction case before it produces an answer. This policy is
an explicit simulator choice, not a claim that every source agent counts alike.

Repeated visits remain distinct steps, so Next can follow each round or retry.
The current transition and traversed route stay visible even with **Selected node
only** enabled. A missing required node or connection blocks playback.
Simulation state stays in page memory, clears on reload, and never changes the
saved architecture or connects to a real channel, model or tool. Output and
owner-release edges describe handoffs; playback does not deliver an answer or
drain the conversation queue.

The graph also shows explicit no-tool continuation, pre-launch control/budget
checks, preparation and tool failure exits, and uncertain-work reconciliation.
Release requires the settlement contract to be satisfied. These are proposed
design branches. Continuation, known tool outcomes, terminal failures and the round gate have playable cases; uncertain-work reconciliation remains deferred. See the
[completeness audit](../../../../../docs/research/lina/turn-execution-completeness-audit.md).

Interactive steering, cancellation, waiting approvals, parallel tool batches,
child work and restart recovery are deferred. Their boundary connections are
shown for design inspection, without simulated operational support.

`inputSimulation.ts` owns deterministic progression; `LinaSimulation.tsx` owns
the modal and controls; `LinaPage.tsx` schedules playback and renders the route.
Automatic playback and Next use the same advance operation, once per viewing
step. The one-second pace is not an agent latency measurement.

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
Run simulation follows the new Turn Execution block with fixed model/tool outcomes;
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
pnpm --filter @agent-harness-lab/studio-api exec tsx --test ../web/tests/linaContracts.test.ts ../web/tests/linaArchitecture.test.ts ../web/tests/linaSimulation.test.ts
pnpm --filter @agent-harness-lab/web typecheck
```

## Technical design document

The [Lina input architecture](../../../../../docs/research/lina/input-design.md)
records agreed input decisions and proposed control behavior for review. The
[Turn Execution research](../../../../../docs/research/lina/turn-execution-research.md)
informs the next block's responsibilities. `executionBlock.ts` defines its eleven
proposed nodes and branch connections. Conversation admission establishes turn
identity and ownership authority; Start turn consumes them without a second
admission. Settle turn records the outcome and hands produced output to delivery;
Release turn emits owner-release information back to Conversation queue. Answer
production, settlement, release and successful delivery are separate events.
These are design contracts and scripted paths, not an implemented Lina runtime
or finalized execution policies.

Maintained Input and Turn Execution documentation refreshes on page load while
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
