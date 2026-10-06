# Lina architecture workspace

Open `/studio/lina` from **Lina architecture** in Studio. Lina is the user's agent
design, separate from the source explorers and the laboratory's executable reference
assembly. The page starts with an empty map; no architecture or study findings are
presented as settled decisions.

Architecture components and connections are maintained through our design work.
The page provides navigation and layout controls, with no manual component
creation, deletion, or connection editor. Selecting a node opens concise
architecture documentation: responsibilities, inputs, outputs, decisions, and
source mappings. Bullets describe concrete contracts and separate open questions.

**Study** holds source references and observations from Hermes, OpenClaw, Pi, and
Waku. **Design** holds decisions and open questions. **Experiments** holds proposed
alternatives and controls. Design statuses do not indicate runtime implementation.

The 22 nodes contain responsibility, input/output, agreement, open-question, and
source-explorer mapping notes. Execution and delivery are boundary nodes.
**Fit** shows the overview. Selecting a component in the index centers it at
the current zoom. Mouse-wheel or trackpad gestures over the canvas zoom around
the pointer from 5% to 200%. Drag empty canvas space to pan. Drag a node to reposition that component. Drag the input block header to move
all its nodes together, preserving connections and other components. Group moves
are draft edits until saved.
Shift-wheel and scrollbars also move the canvas. The zoom
buttons preserve the viewport center. Connections show proposed routing, including bypass branches.
**Reset input layout** restores the preset input nodes to their original relative
arrangement beside other components. It changes positions only, preserving notes,
statuses, connections, and custom nodes. **Undo layout reset** restores the previous
positions. Reset and undo are draft edits until saved. Missing preset nodes are
not recreated.
The preset is design data and does not execute Lina or the source agents.

The **Components** and **Inspector** controls independently collapse or restore
the sidebars. Selecting a node automatically opens its inspector with its notes.
The component list remains collapsed if hidden. The canvas uses the released space. Panel preferences are stored
in the browser separately from the architecture document.

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

Maintained input-node documentation refreshes on page load while preserving
positions, statuses, connections, and experiment notes. Only empty, unconnected
legacy nodes titled New component are removed. Refreshed documentation becomes
a browser draft until saved to the database.
