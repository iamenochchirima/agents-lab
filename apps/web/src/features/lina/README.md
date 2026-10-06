# Lina architecture workspace

Open `/studio/lina` from **Lina architecture** in Studio. Lina is the user's agent
design, separate from the source explorers and the laboratory's executable reference
assembly. The page loads the maintained input design. Agreed decisions and open
proposals are labelled separately.

Architecture components and connections are maintained through our design work.
The page provides navigation and layout controls, with no manual component
creation, deletion, or connection editor. Selecting a node opens concise
architecture documentation: responsibilities, inputs, outputs, decisions, and
source mappings. Bullets describe concrete contracts and separate open questions.

**Study** holds source references and observations from Hermes, OpenClaw, Pi, and
Waku. **Design** holds decisions and open questions. **Experiments** holds proposed
alternatives and controls. Design statuses do not indicate runtime implementation.

The input nodes contain responsibility, input/output, agreement, open-question, and
source-explorer mapping notes. Execution and delivery are boundary nodes.
**Fit** shows the overview. Loading the design fits the full map. Selecting a component in the index centers it at
a readable zoom of at least 85%. Mouse-wheel or trackpad gestures over the canvas zoom around
the pointer from 5% to 200%. Drag empty canvas space to pan. Drag a node to reposition that component. Drag the input block header to move
all its nodes together, preserving connections and other components. Group moves
are draft edits until saved.
Shift-wheel and scrollbars also move the canvas. The zoom
buttons preserve the viewport center. Connections show proposed routing, including bypass branches.
**Reset input layout** restores the preset input nodes to their original relative
arrangement beside other components. It changes positions only, preserving notes,
statuses, connections, and custom nodes. **Undo layout reset** restores the previous
positions. Reset and undo are draft edits until saved. Reset affects nodes already in the document. Reviewed graph updates add missing
components when the design reloads.
The preset is design data and does not execute Lina or the source agents.

The **Components** and **Inspector** controls independently collapse or restore
the sidebars. Selecting a node automatically opens its inspector with its notes.
The component list remains collapsed if hidden. The canvas uses the released space. Panel preferences are stored
in the browser separately from the architecture document.

## Follow a message

**Follow a message** steps through illustrative input scenarios. **Next step**
follows the selected scenario; route buttons explore another outgoing connection.
**Back**, the visited-step list, and **Restart** navigate the walkthrough. The map
highlights visited nodes and connections and opens the current node's documentation.

These paths describe Lina's design, not recorded execution. Queue, steering,
interruption, recovery, and delivery retain their unresolved contracts. Acceptance
can emit a receipt and dispatch work; these connections are separate consequences.
The execution handoff ends this block. Model calls, tools, and subagents need their
own design blocks before the walkthrough can describe a complete agent turn.
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

Validation: focused TypeScript compilation, source inspection and browser rendering.
No test suite or agent/model/tool execution is required or performed for this design
workspace change.

## Technical design document

The [Lina input architecture](../../../../../docs/research/lina/input-design.md)
records agreed input decisions and proposed control behavior for review. The execution rules
are draft specifications and do not describe runtime features of this page.

Maintained input-node documentation refreshes on page load while retaining
user-arranged positions. Statuses, connections, and experiment notes remain intact. Nodes use
300 × 144 canvas units, with room between branches and connection labels. Routes
avoid other node boxes where a clear candidate lane is available. Reset restores
this preset. Only empty, unconnected legacy nodes titled New component are removed.
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
