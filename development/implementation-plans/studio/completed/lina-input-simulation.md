# Lina input simulation: first implementation

**Created:** `2026-10-07T14:10:01+02:00`
**Last updated:** `2026-10-07`
**Status:** Complete, verified

## Goal

Make a working simulation on Lina's existing architecture graph. Click **Run**,
choose a channel and playback mode in a modal, and watch a request travel through the input nodes.
Support automatic playback and manual progression with **Next**. No message
text is needed.

The eventual goal is a stateful simulator: send another request while work is
active, observe queueing, and vary message types and conditions. This first
slice establishes the interaction; it does not implement those later behaviors.

## Read before implementation

- [Repository rules](../../../../AGENTS.md)
- [Lina workspace](../../../../apps/web/src/features/lina/README.md)
- [Input graph](../../../../apps/web/src/features/lina/inputBlock.ts)
- [Existing example paths](../../../../apps/web/src/features/lina/executionPaths.ts)
- [Input design](../../../../docs/research/lina/input-design.md)

Preserve existing graph inspection, layout editing, and architecture saves.

## Working flow

1. **Run** opens a small modal. Choose a channel: CLI, WhatsApp, or Telegram, and playback mode: Automatic
   or Manual. CLI and Automatic are the defaults. Include Cancel and Run simulation.
2. **Run simulation** closes the modal and begins automatic playback at the
   selected adapter. Manual instead starts paused and waits for Next. A new run
   replaces the previous simulation.
3. Highlight the current node and the arrows taken. Follow the current node
   on the canvas so the request remains visible. Keep controls compact;
   do not add route lists or a Paths inspector tab.
4. **Pause** stops automatic progression. **Next** pauses and advances one
   step. **Resume** continues automatic progression.
5. **Reset** clears the traversal and returns to the same adapter, paused.
6. Stop at **Execution handoff**, labelled as completion of the input simulation.
   No model response or final answer is simulated in this slice.

Use a fixed playback pace of approximately one second per step. This is a
viewing pace, not a latency measurement. The original design walkthrough can
remain separately available; switching away pauses the simulation.

## Initial route and assumptions

Use an ordinary request with valid input, admitted access, a new message identity,
no attachments, and an idle conversation. Telegram uses an activated group/topic
request. These are internal defaults, not more modal settings.

```text
Selected channel adapter
→ Input envelope → Identity resolver → Access policy → Group activation gate
→ Conversation router → Input identity claim → Intent and permission
→ Durable acceptance → Accepted-input dispatcher → Messaging burst collector
→ Conversation admission → Execution handoff
```

Visit the nodes applicable to this request, not every node on the diagram.
CLI passes through the collector without batching. WhatsApp must use an ordinary
text route rather than the existing attachment example. Queue, failure, command,
attachment, and recovery routes are deferred.

Focus this version on the main request route. Acceptance receipts and lifecycle
notifications are separate branches; leave them as graph relationships without
simulating them yet. Do not invent an edge from delivery back to dispatch.

## Small implementation

Keep progression state and route selection separate from graph rendering, using
plain local types and functions. A deterministic baseline route per channel is
sufficient now; do not build a general rules engine. Later conditions can replace
route selection without replacing the graph controls.

Store the simulation only in page memory. It must not alter architecture data,
create backend runs, or connect to real channels/models/tools. Reload clears it.
Use the same advance function for the timer and Next. Clear playback timers on
pause, reset, replacement, completion, view change, and unmount.

If the loaded graph lacks a required node or edge, stop with a short message.
Do not implement snapshots, retries, recovery infrastructure, durable simulation
records, extensive event logs, or a new test framework for this slice.

## To-do list

- [x] Add simple channel configuration and per-channel baseline routes.
- [x] Add local current-step, traversal, and playback state.
- [x] Add Run and the channel/playback modal, including Cancel and Escape.
- [x] Add automatic playback, Pause/Resume, Next, and Reset.
- [x] Integrate current-node and traversed-arrow highlighting into the graph.
- [x] Keep the current step visible and simulation highlighting independent of node inspection.
- [x] Keep traversed/current edges visible under connection filtering.
- [x] Stop at execution handoff; prevent progression beyond the last step.
- [x] Clean up timers and show a simple error for a missing route.
- [x] Add a short README usage note and document the fixed assumptions.
- [x] Verify the working flow in the browser and run TypeScript/formatting checks.

Independent UI and route work may be delegated if useful, following repository
rules. Keep integration with the primary implementer.

## Practical verification

- [x] Run CLI, WhatsApp, and Telegram automatically to execution handoff.
- [x] Pause a run, advance with Next, and Resume it to completion.
- [x] Reset and start another channel; verify the previous timer stops.
- [x] Confirm highlighting follows the request and graph inspection still works.
- [x] Confirm simulation does not change saved architecture or its dirty status.
- [x] Capture a screenshot of the working traversal.

```bash
pnpm --filter @agent-harness-lab/web typecheck
git diff --check
```

Use the existing local Studio stack for browser checks. Add focused automated
checks only where useful to resolve a concrete concern; extensive test coverage
and production hardening are not prerequisites for this initial version.

## Completion and deferred work

Complete when the browser flow above works for all channels, both progression
modes work, and the relevant checks pass. Record results and any remaining limits.
Preserve unrelated changes; commit/push only when authorized.

Deferred: configurable message types, multiple requests, busy/queue behavior,
controls, attachments, failure injection, receipt animation, downstream agent
blocks, persisted evidence, performance measurements, and broader hardening.

This is explicitly a simulation. It does not establish runtime guarantees or
measured agent behavior. The initial simulator is implemented and verified.


## Validation results

- `pnpm --filter @agent-harness-lab/web typecheck` passed.
- `git diff --check` passed.
- Native Node TypeScript assertions passed for all three channel routes, 36
  manual transitions, running/paused state, completion, reset, and missing nodes/edges.
  The checks used Node v23.11.1 with `node --input-type=module` importing the
  simulation functions and maintained input graph; no test dependencies were added.
- Live browser: CLI, WhatsApp, and Telegram automatically completed at step 13/13.
  WhatsApp visited no attachment-custody node.
- Live browser: CLI Pause, Next, Resume, active Reset, and full manual completion
  passed. Reset remained paused at 1/13 after the previous timer interval.
- Live browser: Cancel and Escape preserved the existing request; selected-node
  filtering retained the simulated route; inspection stayed independent of playback.
- Architecture save status stayed unchanged throughout. Simulation uses no design
  mutation or save operation. Its state is local React state and does not persist.
- Visual evidence: `/tmp/lina-simulation-modal.png` and
  `/tmp/lina-simulation-graph.png` show the modal and paused dispatcher traversal.
- Completed on 2026-10-07. The user authorized committing this slice. The plan
  and validation record accompany the implementation commit; research is committed
  separately. No push was requested.

Remaining limits are the deferred work listed above. This first version deliberately
uses a fixed baseline route rather than condition-driven or concurrent simulation.

Follow-up: added Manual playback selection to the modal. Browser verification
confirmed it stays at 1/13 until Next, which advances to 2/13 while paused.
