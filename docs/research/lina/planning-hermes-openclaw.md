# Planning and task management: Hermes and OpenClaw

Reviewed 2026-10-08. This is a source study for Lina's Planning block, not an implementation or performance result.

## Evidence and version boundaries

Current remote HEADs were resolved with `git ls-remote`, then inspected in isolated shallow checkouts without changing the repository's sibling reference checkouts:

| Agent | Inspected revision | Commit timestamp |
| --- | --- | --- |
| Hermes | `517b5e10febd619ce30bb22580e29b160266eb43` | 2026-10-08T13:49:31-04:00 |
| OpenClaw | `6070074dabf6b45f74d4039590cd307640317862` | 2026-10-08T19:12:22+00:00 |

Official web documentation was cross-checked. Immutable source links below govern implementation claims. No upstream tests, model calls, task dispatches, crashes, or benchmarks were run. Inspected tests establish intended behavior, not behavior measured here.

An important correction to older material: current OpenClaw exposes `progress_card` as the native plan/status tool. `tools.updatePlan` remains its configuration switch, and policy entries named `update_plan` map to the replacement. Some localized documentation still describes the earlier experimental `update_plan`. Source discovery also found no `src/tasks/task-flow-*` files at this pin; an older automation page describing that registry must not establish current task-flow behavior. This report therefore uses the inspected Progress Card, Goal and Workboard mechanisms. [Registration][o-registration], [policy aliases][o-policy], [current card documentation][o-card-doc]

## The mechanisms are separate

| Concern | Hermes | OpenClaw | Meaning for Lina |
| --- | --- | --- | --- |
| Model decides its next action | Existing agent loop; no compulsory separate planning model | Existing agent loop | Planning need not replace the agent loop |
| Visible working checklist | `todo_list`: session-local structured store | `progress_card`: durable parent-session status/card, optional checklist | Store explicit progress separately from model reasoning |
| Plan-only artifact | Built-in `/plan` asks the existing agent to write a Markdown plan | No analogous mandatory native plan-only engine established in the inspected files | Plan-only is a mode/policy, not automatically a new agent |
| Standing objective | `/goal` continuation engine with auxiliary judge, contracts and optional command gates | Durable session goal and explicit controls/tools | Goal, plan and execution are different records |
| Dependency-managed operating tasks | SQLite Kanban board, dispatcher, review lifecycle | Optional Workboard plugin, dependencies, claims and subagent dispatch | Rich task capability is real, but distinct from a simple checklist |

These distinctions follow the actual interfaces below. They do not imply one universal architecture or superiority.

## Hermes

### Session checklist: `todo_list`

The model calls an ordinary registered tool. Its description recommends use for work with three or more steps or multiple user tasks, tracking every requested instance, one active item, and completion after verification. Calling without `todos` reads; a write replaces the list unless `merge: true` updates by ID. Items contain `id`, `content`, `status` and optional nesting `parent`; statuses are `pending`, `in_progress`, `completed`, `cancelled`. Array order represents priority. [Tool contract][h-todo]

The store is per `AIAgent`, in memory, revisioned and bounded to 256 items and 4,000 characters per item. Changed writes advance revision; a no-op does not. Rejected replacement validation restores the previous list. Parent sanitization removes dangling references and breaks cycles. Crucially, `parent` expresses checklist nesting, not an execution prerequisite. There is no tool-schema dependency list, task lease, worker assignment, or scheduler in this store. The instruction to keep one item active is prompt guidance: the store does not reject two `in_progress` items. [Store and normalization][h-todo-store]

Restoration uses the latest size-bounded tool response paired with a preceding assistant Todo call. A fabricated unpaired tool row is insufficient; an authoritative newer revision, including an empty clear, can restore the store. This is transcript reconstruction, not an independently transactional task database. [Hydration][h-hydrate]

After compression, a separate rendering retains active items and the ancestry needed to understand active subtasks. Finished branches are omitted. Compression removes stale synthetic snapshots before folding the current one into context, preserves provenance, and can add a skill-reload notice when governing skill bodies were pruned. The store is not rewritten into the static system prompt. [Active projection][h-todo-projection], [compression reinjection][h-compress]

### `/plan`: planning without execution

The built-in command constructs a normal-turn prompt for the same agent. It asks for a saved implementation plan under `.hermes/plans/`, permits inspection, and forbids implementation and other mutations for that turn. It specifies goal, assumptions, approach, concrete steps and verification. This source establishes an instruction-based plan-only mode; it does not itself provide an independent execution engine or enforce a filesystem sandbox. User approval/execution comes afterward. [Plan prompt][h-plan]

### `/goal`: continuation and acceptance

Hermes has a distinct standing-goal engine. `GoalState` carries persistent session state, optional completion contract and quality gates. Contract fields are outcome, verification, constraints, boundaries and stop condition. An auxiliary judge evaluates progress; command gates can prevent a done verdict and supply failure evidence to the next turn. Goal persistence uses session metadata. This engine is separate from the TodoStore and does not silently create a Kanban board. [Goal records and persistence][h-goals-state], [judge implementation][h-goals-judge], [goal documentation][h-goals-doc]

A separate opt-in coding verification stop guard consults a verification ledger and issues a bounded follow-up when fresh evidence is missing. It does not run checks itself and is off by default. Therefore neither a completed Todo item nor general final-answer prose establishes independently verified success. [Verification guard][h-verify], [verification ledger][h-ledger]

### Kanban: durable work and dependencies

Hermes also has a much richer operating-task layer. A card has assignee/profile, title/body, workspace, parent dependencies, attempts and durable handoffs. Workflow statuses include `triage`, `todo`, `ready`, `running`, `blocked`, `review`, `done`, `archived`. The dispatcher runs workers; dependency completion promotes waiting cards. Same-card review supports review requests, change requests and return to implementation. Worker tools expose bounded context, prior attempts, parent results, comments, attachments and explicit terminal calls. These are not TodoStore features. [Kanban tools][h-kanban-tools], [workflow][h-kanban-workflow], [board reference][h-kanban-doc]

Graph expansion validates referenced parents and uses cycle checks; dispatch tracks claims, worker identity and heartbeats. Reclaim refuses to release a potentially live worker's claim when safe termination cannot be established, preventing a straightforward duplicate launch. Retry and review attempts remain inspectable. These source mechanisms justify modeling ready/blocked, binding and recovery in Lina, without copying their full dispatcher into the ordinary loop. [Dependency graph][h-kanban-graph], [claim/reclaim implementation][h-kanban-dispatch]

The board can use acceptance gates stronger than a worker's assertion. Published-PR completion can verify required checks against the exact head and recheck card/run ownership; rejection retains the active work. This is a special configured acceptance contract, not proof that every task is verified or that remote checks form a distributed transaction. [Acceptance implementation][h-pr-acceptance], [acceptance documentation][h-kanban-doc]

Caution: the current Kanban reference still contains an older comparison describing `delegate_task` as synchronous and non-resumable. The separate recent Subagents research documents newer async/persistent delegation. Do not repeat that table as a current blanket statement.

## OpenClaw

### `progress_card`: durable progress, not scheduling

The running session and agent bind ownership; the model supplies optional `markdown` and/or `plan`. Each call replaces the entire card. Checklist entries contain `step` and `status`; statuses are `pending`, `in_progress`, `completed`, with at most one active step enforced by normalization. Limits are 50 steps, 512 UTF-8 bytes per step and 8,192 bytes of Markdown. There are no checklist step IDs, dependency edges, assignees or evidence bindings in this schema. Blocking and pause details belong in Markdown rather than false completion. [Tool][o-card-tool], [input validation][o-card-input], [wire schema][o-card-schema]

Storage is canonical SQLite-backed session state with monotonic revision and clear tombstones. Clients read the current card instead of reconstructing it from receipts. The model sees a short receipt, so saving progress does not duplicate the entire card into the transcript. The store supports revision-checked clearing, but ordinary model replacement does not carry a compare-and-swap revision argument. These details matter when designing Lina's own concurrent writer contract. [Store][o-card-store], [tool result][o-card-tool]

The current policy excludes spawned children from this user-facing card; their results go to the owning parent, which updates progress. Prompt reminders are conditional on session kind, paired renderer, model and policy, rather than an unconditional mandatory planner. [Ownership documentation][o-card-doc], [prompt conditions][o-card-prompt], [subagent policy][o-child-policy]

The built-in runtime performs at most one same-run completion self-check after a successfully saved unfinished checklist and a normal final answer. It preserves completed effects, existing permissions and remaining time. Cancellation, timeout, pending handoffs and other explicit owners bypass the check. An old card does not independently restart idle work. This is bounded follow-through, not an autonomous DAG executor or guaranteed completion. [Completion boundary][o-completion]

No automatic full-card reinjection after compaction was established in the inspected native card/compaction files. Durable UI state should not be confused with context supplied to a subsequent model request. This is an inspection limit, not a repository-wide claim that no harness adapter performs such reinjection.

### Goals and Workboard

OpenClaw's Goal is a durable per-session objective, with explicit create/read/complete/block tools and operator pause/resume/reset controls. The model cannot silently replace, clear or resume it. A goal is not a task queue. Unlike Hermes's judge-based goal engine, the inspected OpenClaw goal-tool interface itself records and constrains transitions; it does not expose an auxiliary judge planner. [Goal tools][o-goal-tools], [Goal reference][o-goal-doc]

The optional, disabled-by-default Workboard plugin provides durable cards, parent links, assignees, claims, attempts, proof/artifacts, specification and decomposition tools. Dependency links reject cycles and incompatible active-child mutation. Children become ready after all parents finish. This is the appropriate comparison for Lina's richer task capability, rather than stretching the progress checklist into it. [Workboard reference][o-workboard-doc], [tool definitions][o-workboard-tools], [dependency validation][o-workboard-core]

Workboard dispatch uses the existing Gateway subagent runtime. It promotes ready cards, handles stale claims/timeouts, selects bounded work and starts workers with card context and claim authority. Default dispatch starts at most three workers, with owner-slot restrictions. Claim tokens gate agent mutation and are redacted from ordinary reads. Failed start compensation blocks/releases the card rather than representing it as successful work. [Dispatcher][o-workboard-dispatch], [claim and dispatch documentation][o-workboard-doc]

Proof metadata is explicitly worker-reported; missing proof can generate a diagnostic, but a `passed` field is not independent verification. The parent/host needs a separate verifier where correctness requires it. Durable retry history, lifecycle provenance and dependency gates make this layer more capable than status text alone. [Proof tools][o-workboard-tools], [diagnostic and context helpers][o-workboard-helpers]

## Grounded direction for Lina

These are recommendations, not upstream behavior:

1. Keep optional planning inside the existing model/tool loop. Offer plan-only as explicit policy. A simple request can bypass it.
2. Maintain a canonical plan record and a separate compact Context projection. UI durability and model-context durability must both be designed.
3. Use stable task IDs and revisions in Lina, even where upstream lightweight checklists do not. Nesting and execution dependencies should have different fields.
4. Support dependency-ready task selection as an optional capability. Bind a ready task to the existing tool operation or child task; avoid a second executor.
5. Treat child success, reported proof and independently checked acceptance as separate observations. The owning agent reconciles them before completion.
6. Replanning should revise remaining work from new evidence, preserving completed work, attempts, reasons and uncertain effects. Editing a plan grants no additional tool permission.
7. Pause, block, cancellation, resumption and uncertain side effects need visible routes. A pending checklist must not automatically restart an idle or explicitly stopped session.

This supports a compact graph covering policy, load, update, readiness, execution binding, review, replanning and completion. It does not establish that every request needs eight extra serial execution stages, a separate planner model, or a mandatory workflow scheduler.

[h-todo]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/todo_tool.py#L227-L283
[h-todo-store]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/todo_tool.py#L26-L105
[h-todo-projection]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/todo_tool.py#L108-L145
[h-hydrate]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/run_agent.py#L1020-L1110
[h-compress]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/agent/conversation_compression.py#L3049-L3120
[h-plan]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/agent/plan_prompt.py#L1-L71
[h-goals-state]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/hermes_cli/goals.py#L287-L710
[h-goals-judge]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/hermes_cli/goals.py#L893-L960
[h-goals-doc]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/website/docs/user-guide/features/goals.md
[h-verify]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/agent/verification_stop.py#L48-L81
[h-ledger]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/agent/verification_evidence.py
[h-kanban-tools]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/kanban_tools_schemas.py
[h-kanban-workflow]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/hermes_cli/kanban_workflow.py
[h-kanban-doc]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/website/docs/user-guide/features/kanban.md
[h-kanban-graph]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/hermes_cli/kanban_db_graph.py#L25-L169
[h-kanban-dispatch]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/hermes_cli/kanban_db_dispatch.py#L362-L623
[h-pr-acceptance]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/hermes_cli/kanban_pr_acceptance.py
[o-registration]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/src/agents/openclaw-tools.registration.ts#L60-L115
[o-policy]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/src/agents/tool-policy.ts#L53-L63
[o-card-tool]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/src/agents/tools/progress-card-tool.ts#L17-L101
[o-card-input]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/src/session-cards/progress-card-input.ts#L24-L109
[o-card-schema]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/packages/gateway-protocol/src/schema/progress-card.ts#L6-L65
[o-card-store]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/src/session-cards/progress-card-store.ts#L88-L204
[o-card-doc]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/docs/tools/progress-card.md
[o-card-prompt]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/src/agents/progress-card-system-prompt.ts#L41-L101
[o-completion]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/src/agents/embedded-agent-runner/run/attempt-stream-prepare.ts#L285-L316
[o-goal-tools]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/src/agents/tools/goal-tools.ts#L64-L156
[o-goal-doc]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/docs/tools/goal.md
[o-workboard-doc]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/docs/plugins/workboard.md
[o-workboard-tools]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/extensions/workboard/src/tools.ts
[o-workboard-core]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/extensions/workboard/src/store-core.ts#L868-L958
[o-workboard-dispatch]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/extensions/workboard/src/dispatcher.ts
[o-workboard-helpers]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/extensions/workboard/src/store-card-helpers.ts#L450-L587

[o-child-policy]: https://github.com/openclaw/openclaw/blob/6070074dabf6b45f74d4039590cd307640317862/src/agents/agent-tools.policy.ts#L57-L76
