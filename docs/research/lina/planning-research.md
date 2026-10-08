# Lina Planning and task management: research and proposed architecture

Reviewed 2026-10-08. Status: **accepted design; Studio design slice implemented**. This research follows the completed Subagents design slice. It concerns Studio's architecture, JSON contracts and deterministic simulation, with an eventual real harness in mind.

## Recommendation

Add an optional **Planning and task management** block with eight nodes. Use a model-led structured task ledger as the baseline: the model proposes and updates the plan, while the harness validates its structure, records revisions, resolves dependencies and checks declared completion evidence. Simple requests retain the direct model/tool loop. More complex tasks can plan first, work sequentially or in parallel, delegate through the existing Subagents block, and revise the remaining plan when observations change it.

This is a Lina design recommendation, not a universal upstream standard or a measured performance advantage. The full boundary should support dependency-aware work, review, partial results, user revisions, recovery and bounded replanning. An executable workflow compiler is a separate strategy; a checklist is not executable code.

## Research evidence

The source studies distinguish installed/core behavior from examples, optional extensions and separate task services:

- [Hermes and OpenClaw](planning-hermes-openclaw.md): native progress tracking, explicit planning modes and separate longer-lived task management surfaces.
- [Pi and Waku](planning-pi-waku.md): optional plan/todo examples, transactional plan documents and authored graph workflows.
- [Planning mechanisms and evaluation](planning-patterns-and-evaluation.md): primary papers and official architecture guidance, including limitations of benchmark claims.
- [Existing Lina integration audit](planning-existing-design-audit.md): current seams, missing contracts and proposed routes.

| Reference | Inspected behavior | Architectural lesson |
| --- | --- | --- |
| Hermes | Revisioned session todos, same-agent `/plan`, separate judged goals and durable Kanban dependencies/review | Do not merge checklist, goal verification and cross-session dispatch into one flag. |
| OpenClaw | Current native `progress_card` stores durable parent-owned status; optional Workboard handles dependencies/claims/subagent dispatch | Progress visibility and durable task execution are separate capabilities. |
| Pi | Core direct loop; optional plan/todo extensions and a transactional plan-document example | Planning can remain optional and still have an explicit state boundary. |
| Waku | Core direct loop and separately authored graph workflows with dependency waves | An authored workflow is a meaningful alternative to model-led task selection. |

These summaries refer to the dated, pinned source reports above. In particular, OpenClaw's current native name is `progress_card`; older `update_plan` documentation does not describe its current tool contract.

A progress list, an agent reasoning strategy and a durable task board solve different problems. Progress records help preserve the goal across turns and compaction. A planner/executor strategy decides how to decompose and revise work. A task system can own work across sessions, dependencies and dispatch. Lina should represent those distinctions rather than silently adding a second execution scheduler.

## Ownership and operating modes

The main agent normally decides whether to propose a plan and how to decompose it. A user or configured policy can require plan-first behavior. The harness admits plan mutations and actual operations. Subagents own their local plans; a parent links assigned steps to child task/result references and reviews the result. A parent plan does not share mutable child history or silently read a child's private plan.

Keep two independent settings:

- **Task strategy:** direct loop, model-led structured plan, or an explicitly configured authored workflow. Later strategies can use separate planner/executor models without changing the task record boundary.
- **Execution mode:** ordinary execution or plan-only/review-before-execution. Plan-only exposes admitted exploration capabilities and blocks effectful operations through Tools/Safety. It is not merely a prompt saying “do not execute.” Accepting a plan is not permission to perform its actions.

Dependencies and parallel readiness are supported from the outset where explicitly declared. Independent ready work can use existing parallel Tools or Subagents. Planning identifies work and constraints; those owners enforce launch authority, capacity, waits and cancellation. A task board can persist across turns without treating every idle conversation as an active agent run.

## Proposed nodes

| Proposed ID / title | Responsibility | Inputs → outputs |
| --- | --- | --- |
| `lina-planning-policy` / Resolve planning policy | Bind strategy, execution mode, scope and bounded replanning policy; allow bypass | Admitted goal, user preference and current policy → effective policy, bypass or refused mode |
| `lina-planning-load` / Load task plan | Restore the exact scoped current plan and project a bounded view | Goal/agent/branch identity, requested revision → found, absent, stale/conflict or unavailable |
| `lina-planning-update` / Apply task updates | Validate create/update/revise commands and conditionally commit through State | Typed command, expected revision and original operation identity → applied, duplicate, conflict, invalid or unknown |
| `lina-planning-ready` / Select ready work | Resolve declared dependencies, blockers and required work without launching it | Accepted revision, task states and policy → ready set, blocked set, waiting or completion candidate |
| `lina-planning-bind` / Bind work execution | Correlate selected tasks with admitted actual tool calls or child tasks | Ready task IDs and admitted execution handles → binding/receipt, refused assignment or unresolved binding |
| `lina-planning-review` / Review task evidence | Compare observations with declared acceptance criteria and preserve their provenance | Correlated results, artifacts and verification policy → accepted, insufficient, failed, blocked or uncertain assessment |
| `lina-planning-replan` / Decide plan revision | Decide whether observations/user changes require revision; retain completed evidence and bound revision attempts | Assessment, guidance and counters → continue, model revision request, user wait or exhausted |
| `lina-planning-complete` / Assess goal completion | Check required tasks, goal criteria and unresolved obligations before reporting whole-goal status | Candidate answer, plan revision and accepted evidence → complete, partial, needs-work, blocked, failed or cancelled |

“Review task evidence” can use deterministic checks, a declared model evaluator, or human review according to the task. Record which method produced the assessment. Many natural-language criteria cannot be proven by a schema check. Explicit model assertions are allowed as such; do not label them independently verified.

## Contracts to implement

Use stable `goalId`, `planId`, `taskId` and `revision`; scope records by workspace, agent, conversation and history branch. Separate lifecycle status from evidence/verification status. An empty dependency set does not authorize external execution. Reject missing/self/cyclic dependencies within a plan revision; bounded repeated work is represented as a new attempt or revision rather than a cyclic dependency graph.

Plan lifecycle: `draft`, `active`, `waiting`, `paused`, `completed`, `failed`, `cancelled`, `superseded`. Task lifecycle: `pending`, `ready`, `in_progress`, `blocked`, `completed`, `failed`, `cancelled`, `skipped`. `ready` may be derived in the projection, rather than persisted as a competing truth. A required task may not be silently skipped: an explicit accepted goal/plan revision must change its requirement. Failed/cancelled tasks do not count as success.

Illustrative task-plan record (fake references; not a maintained runtime schema yet):

```json
{
  "schemaVersion": 1,
  "planId": "plan:review:001",
  "goalId": "goal:review:001",
  "scope": {
    "workspaceId": "workspace-demo",
    "agentId": "lina-main",
    "conversationId": "conversation-demo",
    "historyBranchRef": "history:main:active"
  },
  "revision": 3,
  "status": "active",
  "strategy": "model-led",
  "executionMode": "execute",
  "goal": "Review a proposed change and report supported findings.",
  "goalCriteria": ["Required source checks and final synthesis are accepted."],
  "constraints": ["Read-only review; cite inspected artifacts."],
  "tasks": [
    {
      "taskId": "task:inspect",
      "title": "Inspect changed source",
      "required": true,
      "dependsOn": [],
      "status": "completed",
      "acceptanceCriteria": ["Relevant source revisions inspected and referenced."],
      "executionRefs": ["child-task:source-review:001"],
      "evidenceRefs": ["artifact:source-findings:001"],
      "assessment": {
        "method": "parent-model-review",
        "status": "accepted",
        "assessmentRef": "assessment:source:001"
      }
    },
    {
      "taskId": "task:synthesize",
      "title": "Synthesize findings",
      "required": true,
      "dependsOn": ["task:inspect"],
      "status": "pending",
      "acceptanceCriteria": ["Claims cite retained source evidence."],
      "executionRefs": [],
      "evidenceRefs": [],
      "assessment": null
    }
  ],
  "supersedesRevision": 2,
  "replanReasonRef": "observation:additional-source:001"
}
```

Mutation envelope and outcome:

```json
{
  "commandId": "plan-update:001",
  "callId": "call:plan-update:001",
  "planId": "plan:review:001",
  "expectedRevision": 3,
  "actorAgentId": "lina-main",
  "operation": "update_task",
  "taskId": "task:synthesize",
  "set": {"status": "in_progress"},
  "reasonRef": "decision:begin-synthesis:001"
}
```

```json
{
  "commandId": "plan-update:001",
  "callId": "call:plan-update:001",
  "status": "applied",
  "planId": "plan:review:001",
  "previousRevision": 3,
  "revision": 4,
  "receiptRef": "state-receipt:plan-update:001",
  "launchedWork": false
}
```

Retried commands retain identity and fingerprint. Same ID with different content conflicts. Unknown commit acknowledgement triggers inspection of the original transaction; it does not submit a different mutation. Replanning changes the future plan without replaying completed external operations. Historical revisions and evidence remain inspectable.

Binding records must retain task ID, accepted plan revision, attempt ID, call/child task ID, operation identity, controller and outcome certainty. Declare dependency conditions (accepted-success by default, explicitly terminal-outcome for cleanup) and immutable input bindings to a producing attempt/artifact. Late results attach to the original attempt; they cannot complete replacement work after a revision. Plan edits do not implicitly cancel running work; issue explicit controls through its owner. A successful child is a candidate observation; parent review determines whether it satisfies the assigned task. Goal completion carries the assessed revision, remaining required tasks, unresolved effect references and evidence method.

## Connections and lifecycle

1. Start turn → policy → load/bypass → existing round preparation. A missing plan is legitimate for direct/model-led requests; an unavailable required saved plan is not silently empty.
2. Context Load reads a permitted current-plan projection through Load and State. Context Task includes bounded current goal, constraints, active/blocked tasks and evidence references. Compaction changes the view, not canonical task state.
3. Model requests a registered plan command → existing Tools admission → Update → State Record → exact tool-result return. Plan creation/revision uses normal model invocation and existing budgets.
4. Accepted plan → Ready → model-visible ready work. Bind records actual admitted Tools/Subagents operations; readiness alone does not run an action.
5. Correlated tool/child outcomes → Review → Update, Replan or Complete. Independent results retain their IDs even when they arrive out of order.
6. Replan → existing Controls/Prepare for the next model call, or retained user wait. New plan proposals return through Update. Replanning budgets count additional model work; they do not reset main loop limits.
7. Candidate whole-goal completion → Complete → existing Controls/Settle. Incomplete required work routes to continuation or an honest blocked/partial/failed outcome. User-requested pause/Stop is respected without insisting on full completion.
8. Recovery reloads exact compatible plan/task references through State. Stop cancels actual work through existing owners, then records truthful plan status. Unknown tool/child effects remain in existing reconciliation; task accounting cannot clear them.

## Simulation cases and implementation checklist

The deterministic Studio slice is complete; see the [implementation and verification checklist](../../../development/implementation-plans/studio/completed/lina-planning-block.md). These checks describe design playback, not a live task service.

- [x] Add eight graph nodes, route labels and branch highlighting; replace only the empty Planning region.
- [x] Add JSON schemas and example input/output for each node and meaningful alternative outcome; use the existing collapsible highlighted inspector.
- [x] Extend State record/checkpoint references, Context task projection, registered Tools and exact Subagents task bindings.
- [x] Implement one canonical transition reducer used by Auto and Next; retain agent-instance identity and manual camera following.
- [x] Add modal settings for direct/model-led/plan-first scenarios, sequential/parallel work, evidence outcome and bounded replan behavior.
- [x] Cover bypass, plan creation, plan-only exploration and review-before-execution without implying action approval.
- [x] Cover dependency readiness, parallel independent tasks, failed prerequisite, invalid graph and insufficient evidence.
- [x] Cover retained attempt bindings across revisions, user scope change, bounded replan, duplicate/conflicting update and unknown write acknowledgement.
- [x] Cover compaction/reload, compatible recovery, child-local plans, partial result and Stop with unresolved work.
- [x] Verify goal completion cannot silently discard required tasks or uncertain effects; distinguish asserted and verified completion.
- [x] Update architecture/docs/checklist and run focused contracts, transition, graph and UI checks.

## Defaults versus experiments

Required correctness defaults: stable identities, scope isolation, explicit status/evidence, valid dependencies, conditional updates, matched results, honest incomplete outcomes, bounded loops and retained canonical records. Independent admitted tool calls may run in parallel; dependency and authority checks remain required. These are not performance hypotheses to loosen merely to create comparisons.

Meaningful strategy comparisons: direct ReAct loop versus explicit plan-and-replan; one agent versus separate planner/executor; coarse versus fine decomposition; authored workflows versus model-proposed tasks; fixed plans versus observation-triggered revision; per-step versus milestone review; parent versus specialist synthesis. Compare under the same models, tools, task criteria and resource budgets, and record planning/evaluation overhead separately. Measure final success, constraint violations, unsupported completion, cost, latency, critical path, unnecessary work and recovery behavior. Studio playback only demonstrates designed branches; live runs are required for performance conclusions.

## Scope limit

This proposal provides a substantial architecture boundary rather than a mandatory planner on every request. A general workflow compiler, durable cross-session dispatcher, provider calls and live storage require their own runtime implementation. Existing source agents combine different subsets of these mechanisms; their feature count alone does not establish superior task performance.
