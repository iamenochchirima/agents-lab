# Lina turn execution and connected simulation

Created: 2026-10-07. Status: complete, verified 2026-10-07.

## Goal and scope

Add a visible Turn Execution block to `/studio/lina`, connect it to the current
Input architecture, and extend the existing simulation through both blocks.
A user chooses a channel, a small scripted execution case and Automatic or
Manual playback. The same request travels from its adapter through admission,
model/tool rounds and settlement to execution-owner release.

This is Lina's design simulator. Model responses, tool outcomes and recovery
are scripted. It does not send real requests, execute tools, produce benchmark
measurements or create lab Run records. Keep this first implementation practical;
no general workflow engine, infrastructure or production hardening is required.

The block below is the implementation baseline for this slice. Runtime policy
choices remain proposals where the research or Input design marks them open.
Adding a node does not mean Lina's actual runtime exists or its policy is agreed.

## Context and inspected baseline

- [Comparative research](../../../../docs/research/lina/turn-execution-research.md)
  and its four source studies inform the boundaries.
- [Input design](../../../../docs/research/lina/input-design.md) already specifies
  execution, delivery, controls, waiting replies, queue release and reconciliation
  handoffs. Preserve agreed decisions and distinguish proposed execution behavior.
- [Completed input simulation](../completed/lina-input-simulation.md) establishes
  Run, channel and playback settings, Pause/Resume, Next, Reset and graph following.
- [Lina workspace](../../../../apps/web/src/features/lina/README.md) describes
  graph inspection, layout, browser drafts and explicit architecture saving.
- [Graph data](../../../../apps/web/src/features/lina/inputBlock.ts) has an
  Execution handoff node and runtime-to-queue owner-release edge.
- [Simulation](../../../../apps/web/src/features/lina/inputSimulation.ts) stores
  a fixed route and step index; it currently completes at Execution handoff.
- [Page](../../../../apps/web/src/features/lina/LinaPage.tsx) refreshes maintained
  Input notes/edges and renders one Input block region. It must learn about the
  new maintained block without losing unrelated design data.
- [Controls](../../../../apps/web/src/features/lina/LinaSimulation.tsx) currently
  label the feature and completion as Input simulation.

At planning time, the working tree contains the preceding uncommitted research
notes and research index change. Preserve those and any subsequent unrelated work.

## Architecture and ownership

Conversation admission establishes turn identity and grants execution ownership.
Start turn consumes that admission and initializes execution. Do not add another
conversation queue or allocate a second turn ID inside the new block.

A turn is one admitted request. A round is one model response and its associated
tool work. A model attempt is one provider request attempt. For this slice,
scripted cases use these meanings without introducing a complete runtime schema.

| Maintained node | Responsibility and initial simulated behavior |
| --- | --- |
| Start turn | Consume admitted input, conversation/turn identity and execution authority; initialize limits and working state. |
| Prepare round | Request current context, including recorded results. Context/Memory internals remain outside this block. |
| Call model | Request a response from the Model component. Script a response or failure for the selected case. |
| Decide next action | Classify answer, tool requests, continuation or failure and choose the next path. |
| Execute tool batch | Hand calls to Tools and collect settled outcomes. Initially simulate one successful tool; tool validation, scheduling and approval internals remain future detail. |
| Apply pending controls | A defined checkpoint before the next round or terminal settlement. Initial cases contain no pending controls; do not claim interactive steer/stop support. |
| Recover | Decide whether a model failure can be retried and return to preparation. The scripted case permits one retry, without repeating tools. |
| Settle turn | Record terminal reason and reconcile required outstanding work. Initial successful cases have no uncertain work. |
| Release turn | Emit owner-release information to the shared service; playback ends here. Queue admission remains owned by the existing service/Input boundary. |

Use stable `lina-execution-*` node IDs and a separate maintained edge namespace.
Titles and node splits can change if implementation reveals a clearer layout;
retain these responsibilities and observable paths. Nodes carry concise
responsibilities, inputs, outputs, design notes, source references and relevant
experiment possibilities in the existing inspector format. Keep proposed nodes
labelled honestly, rather than marking them decided because simulation works.

## Graph connections

The ordinary path is:

```text
Existing input route → Conversation admission → Execution handoff
→ Start turn → Prepare round → Call model → Decide next action
```

Continue with labelled branches:

```text
Decide next action -- tools --> Execute tool batch → Apply pending controls
Apply pending controls -- continue --> Prepare round
Decide next action -- answer --> Apply pending controls
Apply pending controls -- finish --> Settle turn → Release turn
Decide next action -- recoverable failure --> Recover → Prepare round
Decide next action -- terminal failure / exhausted --> Settle turn
```

The direct-answer and tool-result decisions choose different transitions out of
the same control checkpoint. The diagram and scripted route must agree on every
transition. A label explains a branch; it does not need an extra documentation
card on the canvas.

Additional boundary relationships must be visible even where interaction is
deferred:

| Existing node | Connection to add or clarify |
| --- | --- |
| Turn control | Guidance/cancellation targeting the active execution. Connect to the control checkpoint with notes that active-work cancellation can be signalled before checkpoint consumption; exact policy remains proposed. |
| Pending-prompt resolver | Matched answers return to waiting execution. Show a labelled handoff to the owning execution coordinator; do not route answers through Start turn as fresh ordinary requests. No waiting case is implemented yet. |
| Conversation queue | Release turn emits owner release to this node, which already routes waiting work back to admission. Replace the old runtime-boundary release edge so it does not imply admission immediately releases ownership. |
| Recovery / execution reconciliation | Preserve routes for safe resume and uncertain outcomes, with their detailed execution entry unresolved. Distinguish restart recovery from the new node's in-turn model retry. Do not route uncertain work through Start turn as an automatic fresh execution. |
| Reply delivery handoff | Connect execution-produced output to the existing delivery boundary. It is a separate consequence from settlement/release; do not invent delivery → dispatch or assert successful user receipt. |

Retain Execution handoff as the explicit boundary between Input and Turn
Execution. Avoid moving existing Input nodes solely to change their ownership
labels. Review obsolete boundary descriptions and misleading edges as part of
this integration, preserving the underlying contracts.

## Initial simulation cases

Run modal settings:

- Channel: CLI, WhatsApp, Telegram, unchanged.
- Execution case: Direct answer, Tool round, Model retry. Direct answer is default.
- Playback: Automatic or Manual, unchanged.

No message text, tool arguments, model credentials or extra configuration panels.
Keep the existing baseline input assumptions: admitted access, new input identity,
no attachments and idle conversation. CLI bypasses actual batching; Telegram's
request is activated. These remain assumptions rather than operational guarantees.

| Case | Execution traversal after Start turn |
| --- | --- |
| Direct answer | Prepare → Model → Decide → Controls → Settle → Release |
| Tool round | Prepare → Model → Decide → Tools → Controls → Prepare → Model → Decide → Controls → Settle → Release |
| Model retry | Prepare → Model → Decide → Recover → Prepare → Model → Decide → Controls → Settle → Release |

The model retry is one recoverable provider failure followed by success. It
retains the logical turn and starts another attempt. The tool case contains one
successful tool batch followed by an answer. These fixtures must finish with
bounded, deterministic routes. Do not infer arbitrary behavior from free text.

A scripted sequence of node visits and labelled transitions is sufficient.
Repeated node IDs are valid visits; progress indexes the visit, not unique nodes.
Use the graph's actual edges to validate routes. If parallel edges make an
endpoint pair ambiguous, identify the chosen edge explicitly. Avoid creating a
second unconnected graph definition or a general state-machine framework.

## Playback and visual behavior

- One Run starts one continuous traversal from adapter to Release turn.
- Execution handoff is an intermediate step, never simulation completion.
- Automatic and Next call the same progression operation. The fixed viewing
  pace remains approximately one second and is not simulated agent latency.
- Manual starts paused at the adapter and does not advance until Next.
- Next pauses automatic playback and advances exactly one visit, including
  repeated model/prepare/control visits.
- Pause/Resume work within either block, across the handoff and during a loop.
- Reset keeps channel and execution case, clears the trail and returns paused
  to the adapter. A new Run replaces the previous simulation.
- The graph follows the current node across both regions, retaining current
  node/transition emphasis and traversed history without a wall of path text.
- Loop revisits need visible current-step emphasis even though those nodes
  already appear in the visited trail. Current-transition labels distinguish
  continue, tools, retry and finish where relevant.
- Selected-node connection filtering keeps active/traversed simulation edges
  visible. Inspection and playback stay independent.
- Completion says Turn simulation complete at Release turn, without claiming
  successful real model execution, delivery or a measured lab Run.
- Missing required nodes/edges block playback with a concise reason.
- Clear timers on pause, reset, replacement, completion, view change and unmount.

## Implementation checklist

### 1. Maintained architecture data

- [x] Add a focused Turn Execution graph data module with the nodes above.
- [x] Add labelled ordinary, tool-loop, recovery and terminal branches.
- [x] Add/clarify Input handoffs, controls, prompt answers, delivery and release.
- [x] Replace obsolete runtime-to-queue release semantics with Release turn ownership.
- [x] Keep deferred wait/restart/reconciliation detail explicit in inspector notes.
- [x] Include source mappings and separate proposed policy from agreed Input rules.

### 2. Canvas and saved-design integration

- [x] Compose both maintained blocks when creating/loading the design.
- [x] Refresh both maintained edge namespaces without duplicate nodes or edges.
- [x] Preserve user positions, statuses, experiment notes, custom nodes and unrelated edges.
- [x] Add missing execution nodes to older saved designs/drafts without overlap.
- [x] Retain existing explicit save, revision conflicts and browser draft behavior.
- [x] Render a distinct Turn Execution region beside/below Input with readable loop edges.
- [x] Update Input-only page labels where they now describe the full architecture.
- [x] Support dragging the execution block as a group using the existing interaction.
- [x] Keep Reset input layout limited to Input; no global layout reset or new layout framework.

### 3. Simulation progression

- [x] Add the three bounded scripted execution cases and their shared Input prefix.
- [x] Carry selected case through start/reset state and extend the route past handoff.
- [x] Validate every chosen graph transition, including loops and recovery branches.
- [x] Keep repeated visits distinct from unique-node visitation.
- [x] Finish only after Release turn; prevent advancement after completion.
- [x] Use the same advance operation for automatic playback and manual Next.
- [x] Keep simulation local and separate from architecture saves and backend runs.

### 4. Modal, controls and graph following

- [x] Add the compact execution-case setting to the existing Run modal.
- [x] Preserve channel and Automatic/Manual settings, Cancel and Escape behavior.
- [x] Preserve Pause, Resume, Next and Reset semantics throughout both blocks.
- [x] Update accessible simulation and completion labels to describe a turn.
- [x] Highlight current/revisited nodes and the exact active transition.
- [x] Follow execution nodes across the canvas while retaining readable zoom.
- [x] Preserve node/edge inspection and selected-node filtering during playback.
- [x] Keep controls compact; add no route-list panel, metrics dashboard or noisy copy.

### 5. Documentation and verification

- [x] Update the Lina workspace README with cases, usage, boundaries and deferred behavior.
- [x] Update Input boundary documentation where explicit connections change.
- [x] Document the Turn Execution baseline as design/simulation, not implemented runtime.
- [x] Link the block's notes to comparative research; avoid silently finalizing open policies.
- [x] Perform focused progression checks and the browser acceptance checks below.
- [x] Run docs generation, TypeScript compilation and diff formatting checks.
- [x] Record results and visual evidence here before marking completion.

Independent graph-data and progression work can be delegated during
implementation. Keep ownership decisions, page integration and final review with
the primary implementer. Do not concurrently edit the same page/control files.

## Acceptance checks

- [x] All 3 channels × 3 cases have valid routes and complete at Release turn.
- [x] Automatic playback visibly crosses Input → Turn Execution for each case.
- [x] Manual playback stays at the adapter until Next, traverses the handoff,
  follows repeated rounds/retry and finishes only at Release turn.
- [x] Automatic and manual traversal select identical node/edge sequences.
- [x] Pause/Next/Resume work before and after handoff and within a repeated round.
- [x] Reset in execution preserves channel/case, clears history and stays paused
  beyond the old timer interval.
- [x] Starting another case stops the previous timer; Cancel/Escape leave it unchanged.
- [x] Direct answer bypasses Tools/Recover; Tool round revisits Model after Tools;
  Model retry visits Recover once, retains its turn and does not execute tools.
- [x] Selection filtering, node clicks, edge inspection and camera following still work.
- [x] Input and execution block dragging preserve internal positions and cross-block edges.
- [x] An older saved design gains the execution block once and keeps its custom data.
- [x] Save/reload preserves the integrated graph; Reset input layout leaves execution alone.
- [x] Simulation start/advance/reset never mutates design data or its dirty status.
- [x] A missing route node/edge blocks playback rather than skipping or inventing it.
- [x] No real channel, model, tool, waiting approval or queue operation is invoked.
- [x] Capture at least one loop/retry traversal and the updated modal as visual evidence.

Use narrow pure-function checks for route validity, repeated visits, completion,
reset and missing-route behavior. Use the existing test/runtime tooling rather
than adding a test framework. Browser-check representative combinations and
verify all channel/case combinations with deterministic progression checks.

```bash
pnpm --filter @agent-harness-lab/web typecheck
pnpm --filter @agent-harness-lab/web generate:docs
git diff --check
```

## Deferred work and limits

Multiple simultaneous requests, actual queue draining, interactive Steer/Stop/
Interrupt, approval/clarification waits, parallel tool execution, child work,
crash recovery, persistent simulation traces and performance experiments are
later slices. Their relevant architecture boundaries are shown now; controls
and simulated paths for those capabilities are not added prematurely.

Future mechanisms should extend the same progression contracts. A scripted
model retry does not establish safe restart or external-effect replay. A release
visit emits a conceptual lifecycle event; it does not run the queue service.
Saved architecture persistence does not make simulation execution durable.

## Current position and completion audit

Current position: all five implementation milestones and the completion audit
are complete. The graph and simulator are implemented; actual Lina runtime
execution remains outside this slice.

- [x] Re-read the user request and verify the connected graph and both playback modes.
- [x] Review every checklist item against actual code and recorded evidence.
- [x] Confirm deferred capabilities are shown honestly and agreed boundaries remain intact.
- [x] Record validation results and remaining limitations below.
- [x] Mark complete and move this plan to completed only after acceptance checks pass.

Commit/push follows explicit user authorization; this request creates the plan.

## Validation record

- Focused checks passed: 15 tests, covering all nine channel/case combinations,
  matching automatic/manual paths, nonterminal handoff, repeated visits, reset,
  missing nodes/exact edges, graph immutability, old-design refresh, custom data,
  block placement, unique identities and valid handoff endpoints. Command:
  `pnpm --filter @agent-harness-lab/studio-api exec tsx --test ../web/tests/linaArchitecture.test.ts ../web/tests/linaSimulation.test.ts`.
- Web TypeScript compilation and docs generation passed. Production build passed,
  with the existing large-chunk advisory; no dependency changes were needed.
- Live Chromium checks passed against the running Studio web app. CUA's in-app
  tab connection timed out, so the bundled Playwright runtime used an isolated
  browser instead. The existing web/API services remained running.
- Automatic direct-answer, tool-round and retry cases crossed Input and execution
  to Release turn, with each case exercised through a different channel. The
  automatic browser clock exercised timer scheduling without treating viewing
  intervals as performance. Real one-second Resume/Pause behavior was also checked.
- Full Manual completion passed for direct answer, tool round and retry; the
  handoff remained nonterminal. Next during automatic playback paused and advanced
  once. Pause/Next/Resume, case replacement, Reset, Cancel/Escape and view changes
  behaved as specified. Manual/reset positions stayed unchanged beyond the old
  timer interval. Reset preserved the chosen channel and case.
- Selection filtering retained simulated arrows. Keyboard edge inspection showed
  the exact continue transition while the current repeated node stayed highlighted.
  Simulation never changed architecture data or dirty state.
- Both blocks dragged as groups with equal position deltas. Cross-block edges
  remained intact; Reset input layout left execution unchanged.
- A separate API process on port 4321 and `/tmp/lina-turn-verification.sqlite`
  exercised the real current SQLite implementation through browser Save/reload.
  An older Input-only fixture gained nine execution nodes once and preserved
  custom data, statuses, experiments and positions. Explicit save/reload retained
  the integrated graph. The user's saved database was not modified by these checks.
- Visual evidence: `/tmp/lina-turn-modal.png`, `/tmp/lina-turn-loop.png` and
  `/tmp/lina-turn-retry.png`. Temporary browser runners were
  `/tmp/lina-turn-verify.mjs` and `/tmp/lina-turn-final-browser.mjs`.
- No browser page errors were observed. `git diff --check` passed.
- Source review confirmed controls, waiting answers, output delivery and owner
  release have explicit boundary edges. Unsupported interactions remain labelled
  deferred; restart/reconciliation do not imply automatic fresh-start replay.
- No real model, channel or tool was invoked, and no lab run records were created.
  The required endpoint is a scripted Release visit, not real queue drain or
  delivery. These limits remain documented in the workspace guide.

Completed as a verified working-tree change. Research notes from the preceding
turn were preserved. No commit or push was requested for this implementation.
