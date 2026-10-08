# Planning: existing Lina design audit

Research date: 2026-10-08. Scope: maintained Studio graph, contracts and deterministic simulation; no live harness claims. This is a proposal, not an implemented block.

## Current boundary

`apps/web/src/features/lina/plannedBlocks.ts` reserves Planning near Turn Execution. It has no executable Planning nodes. The maintained architecture has 120 nodes and 477 relationships after Subagents. Existing task packets, child task IDs and task context are useful integration seams, but do not constitute a plan ledger or completion verifier.

| Existing owner | What Planning should consume | What remains with that owner |
| --- | --- | --- |
| Input | admitted goal and correlated user guidance | request admission, queue, owner selection and deduplication |
| Turn Execution | round outcomes, safe control checkpoints, candidate answer | model loop, round budget, continuation, Stop, settlement and release |
| Context | permitted task source manifest and active agent scope | instruction precedence, history selection, pruning, compaction and publication |
| Tools | registered plan-update command and exact call identity | capability resolution, authorization, dispatch, result pairing |
| Model Interface | ordinary planner/replanner model request through the existing loop | encoding, invocation, protocol retries and normalization |
| State | plan revisions, update receipts and exact task/operation references | conditional persistence, checkpoints, recovery and uncertainty inspection |
| Subagents | delegation result/handle and child lifecycle references | child admission, launch, sessions, joins, cancellation and recovery |
| Safety | effective plan-only restrictions and action authorization | grants and enforcement; approving a plan does not approve its actions |
| Memory | permitted recalled knowledge | durable knowledge mutation; task progress is not a memory write |

## Required changes if accepted

1. Add a dedicated scoped plan/task record. `contracts/stateRecords.ts` currently has no plan record kind. Reference it from checkpoints; preserve the active plan revision across compatible recovery.
2. Extend Context source/contribution contracts with a bounded task-plan view, explicit revision and provenance. `lina-context-load` reads it, `lina-context-task` includes selected goals, constraints, progress and ready-task references. History compaction cannot erase the canonical ledger.
3. Register structured plan commands in Tools. `lina-tools-dispatch` routes admitted commands to Planning; correlated outcomes return to `lina-tools-collect`. A textual checklist in an answer does not mutate the ledger.
4. Add a policy route from `lina-execution-start`, and exact safe-checkpoint routes from `lina-execution-controls`. Model-generated plans still use the ordinary model loop; do not add a second unbounded planner loop.
5. Link ready work to actual tool/child operation identities only after admission. `lina-subagents-return` and `lina-tools-collect` provide evidence; a task status cannot replace their results or ownership.
6. Evaluate planned-task completion before accepting candidate whole-goal completion. Return needs-work or blocked outcomes to existing controls/waits; failed or cancelled goals can settle honestly. Do not force every unplanned request through a checklist.
7. Extend Run settings and fixtures with planning policy, scenario and evidence/replanning choices. Auto and Next use the same instance-tagged transition sequence; manual graph following remains independent of playback mode.

## Node and route direction

The synthesis proposes eight responsibilities: policy, load, update, ready-work selection, binding, evidence review, replanning decision and goal completion. State Record is called by Update rather than replaced by a new persistence mechanism. Ready-work selection describes dependencies; Tools and Subagents still admit and launch work.

Internal routes: policy → load or bypass; load → ready; update → ready; ready → bind or wait/complete; bind → existing execution; review → update/replan/complete; replan → normal model preparation → update; complete → execution controls/settlement.

External routes: start → policy → prepare; load ↔ State Load; update ↔ State Record; Context Load ↔ load; task projection → Context Task; Tools Dispatch → update → Tools Collect; admitted work ↔ bind; Tools/child results → review; controls → replan/complete; recovery → load with exact saved revision; Stop → existing cancellation before plan accounting.

Each edge must carry requester phase and return identity. A State acknowledgement must resume the requester, never redispatch the original external effect. Child terminal status is not evidence of acceptance criteria by itself. Unknown effects remain owned by existing reconciliation paths.

## Verification targets

- Simple request bypass; model-led creation; plan-first with enforced restricted capabilities.
- Valid sequential and dependency plans; missing dependency and cycle rejection.
- Parallel ready tasks without duplicate ownership; exact call/task bindings.
- Successful child with insufficient evidence; failed sibling; blocked dependencies.
- Revision conflict, duplicate update and unknown commit acknowledgement inspection.
- Compaction followed by reload of canonical plan; compatible recovery without replay.
- User changes scope mid-task; bounded replan; preserved historical results.
- Stop with running children or uncertain effects; accurate incomplete/partial settlement.
- Whole-goal completion rejected while required work is outstanding.

These checks verify the design simulator and contracts. They do not measure planning quality, real durability or agent performance.
