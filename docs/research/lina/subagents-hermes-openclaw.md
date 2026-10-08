# Subagents in Hermes and OpenClaw

Reviewed 2026-10-08 for Lina's Subagents / multi-agent orchestration proposal. This is source research, not a benchmark or an implementation of Lina's child runtime.

## Evidence boundary

I resolved both repositories' current HEADs through the GitHub API, fetched selected files from immutable raw URLs, and separately browsed their official documentation. The pins are Hermes `517b5e10febd619ce30bb22580e29b160266eb43` and OpenClaw `d60f85fb9771bea5d3c9f79b95413591aed25b1d`. They differ from the earlier Memory study. No upstream tests or real child sessions were run. Source inspection establishes implemented branches and declared contracts, not measured reliability under crashes or load.

The shared design is model-requested delegation through a tool, followed by host admission, a separately identified child execution, and result delivery to the parent. Delegation does not require replacing the ordinary agent loop. A child runs that loop with its own assignment and execution state. [Hermes construction][h-build], [OpenClaw spawn tool][o-tool]

## Hermes

### Decision, admission and child construction

The model-facing `delegate_task` tool accepts a task batch with goals, supplied context, optional images, output schemas and grouping. Legacy single-goal input remains accepted by the handler. The current schema does not let the model select toolsets, a provider/model route, or iteration budgets. The trusted delegation configuration owns these choices. Child construction can internally narrow inherited toolsets, but that internal argument is not a current model-facing capability. Model/provider routing comes from delegation configuration or parent inheritance. Pinned child routes do not silently borrow the parent's fallback chain. [Schema and handler][h-build], [runtime resolution][h-config], [toolset resolver][h-tools]

Each child has a fresh conversation, task identity, dedicated SessionDB handle linked to the parent, terminal identity and a task-focused prompt. Construction sets `side_agent`, `skip_context_files` and `skip_memory`. It still passes the parent's configured prefill messages, so "fresh" does not imply that no configured seed messages exist. It does not copy the ongoing parent transcript. Pass the necessary evidence in the task context. [Construction][h-build]

The default concurrency setting is 10 and the default maximum spawn depth is 1. The iteration default is 250. The current executable construction derives a child's leaf/orchestrator role from depth and `orchestrator_enabled`, which defaults true. The legacy `role` input is accepted but ignored. At default depth, children are leaves; raising the cap lets children below the cap delegate. Some repository documentation still describes caller-selected roles, so that explanation is stale relative to this source pin. [Configuration][h-config], [construction and dispatch][h-build]

Children inherit enabled toolsets with the parent's deny settings, then lose shared memory writes, user clarification, cross-platform messaging, scheduling and `start_chat`. Leaf workers also lose delegation. Composite toolsets receive a second subtraction pass so blocked tools do not reappear through a bundle. The internal narrowing path preserves parent MCP toolsets by default. Orchestrator capability explicitly re-adds delegation under the depth policy, so it is more precise to say "host-governed inherited capabilities" than claim an unqualified set intersection for every tool. [Resolver][h-tools]

The worker installs a noninteractive dangerous-command approval callback. Default behavior denies; `delegation.subagent_auto_approve` opts into approval. An isolated conversation is therefore not a separate operating-system security boundary. [Approval callbacks][h-config], [worker setup][h-run]

### Background execution, controls and outcomes

The active model dispatch makes top-level delegation background automatically. Nested orchestrator calls stay synchronous so the orchestrator can synthesize its workers before returning. Direct Python callers retain a synchronous default. If the session cannot receive detached completion events, or the async pool is full, the implementation falls back to synchronous execution with an explanatory note. A configuration comment claiming rejection at capacity does not describe this executable path. [Agent dispatch][h-agent], [batch dispatch][h-dispatch]

Ordinary batches join into a combined completion. Optional independent completions and task grouping change the delivery units. Completion order need not match task order, while the joined result is sorted by task index. A failed sibling can produce an early failure notice while others continue; that notice is separate from the durable final completion. [Batch execution][h-dispatch]

`action=list/steer/stop` operates synchronously on the caller's owned spawn tree. Steering queues guidance for an iteration boundary; acceptance does not prove the child consumed it. A late accepted steer can appear as `missed_steer` in the completion. Stop requests interruption, asks in-flight tools to cancel, and preserves partial output. It cannot undo external actions already performed. [Control registry][h-registry], [child execution][h-run]

There is no hard timeout by default. The configured `child_timeout_seconds` is an inactivity cap that refreshes on progress, and heartbeat staleness provides another stuck-child path. Waiting on an in-flight model call is treated as activity. A timed-out daemon worker can be abandoned rather than blocking process exit; its result includes diagnostic/failure information, so timeout must not be drawn as proof of instantaneous execution termination. [Liveness-aware wait][h-run], [configuration][h-config]

Optional output schemas validate the returned JSON and allow one correction turn. If the JSON Schema library is unavailable, the implementation accepts parsed JSON without schema validation; validation receipts need to say what actually ran. Oversized summaries are trimmed according to parent context headroom and a static ceiling, with full output spilled to a file when possible. Child tool traces and estimated costs are retained/rolled up separately. [Output validation][h-output], [result handling][h-results]

### Persistence, recovery and memory/workspace boundaries

The async ledger persists dispatch identity, routing origin, process ownership and completion payloads in SQLite. It records finished child results before a batch joins on remaining siblings. Startup and periodic orphan recovery preserve those results and classify unfinished work as `unknown` when its owner has died. Recovery emits transcript/git hints rather than automatically rerunning side effects. Completion claims and acknowledgements suppress competing delivery; bounded retries and replay age limits remain. Queue admission is not proof that the parent processed a result or sent a reply. [Ledger and recovery][h-async]

Children skip curated memory injection and cannot call the shared `memory` mutation tool. The default filesystem directory is shared with the parent. Optional Git worktree isolation separates edits; unsupported backends or setup failure can fall back to the shared directory. Therefore prompt separation, memory authority and filesystem separation need different records. Worktree cleanup/retention is explicit and keeps work requiring inspection. [Construction][h-build], [tool exclusions][h-tools], [worktree implementation][h-worktree]

## OpenClaw

### Native child runs and optional runtimes

Native `sessions_spawn` launches a separately identified child on a parent-owned queue. The model chooses to call it. Delegation prompt modes influence model guidance rather than enforce spawning. The default target is the same configured agent; selecting another agent requires an allowlist that is intersected with known agents. ACP external runtimes and Codex-native children have separate owners/schedulers and must not be represented as identical native runs. Optional Swarm collectors have separate admission and concurrency budgets. [Spawn tool][o-tool], [target policy][o-target], [operations][o-operations]

Same-agent native children normally inherit the active parent model unless subagent configuration overrides it; cross-agent spawns use the target configuration, and explicit permitted selection takes precedence. Model planning verifies availability/tool support before acceptance. Run timeout resolves from the supplied value, configured subagent value, then zero for no timeout. The sample value 900 in documentation is not the implementation default. [Model/run planning][o-plan]

### Context and authority

Non-thread native children default to isolated transcripts. Explicit `fork` branches the requester transcript for context-sensitive work; thread-bound defaults can differ. Cross-agent fork is refused. A fork that exceeds the context-size cap can start isolated with a note, and acceptance reports the actual mode. Context engines have prepare/rollback/dispose hooks around spawn, so context preparation has a failure path before launch. [Context preparation][o-context]

The bootstrap filter at this pin allows only `AGENTS.md` for subagent sessions, and excludes root `MEMORY.md`. Older claims that children automatically receive the full root instruction/profile set are inaccurate. Additional context arrives through the assigned task, fork when selected, runtime instructions and permitted recall. [Bootstrap filtering][o-workspace], [child prompt][o-prompt]

Effective parent/target policy is followed by persistent subagent restrictions. Children lose system-level and direct delivery tools; workers at the depth cap also lose child-management tools. Resumed sessions use the persisted envelope, current depth policy and current revocations, so a dashboard resume is not a bypass. A sender-policy snapshot is part of the delegation authority. Memory authority is separately minted by the host from the exact parent incarnation/lifecycle and trusted owner status. Every lineage hop must remain current, and same-agent validation rejects cross-agent or malformed chains. Parent reset can invalidate a previously granted audience. [Capability envelope][o-capabilities], [spawn lineage recheck][o-lineage], [memory audience][o-memory]

Provider authentication and tool permission are separate concerns. The documented provider-auth rule resolves by target agent, with agent-local profiles overriding shared fallback profiles. The documented merge is additive, so it does not claim complete credential isolation between agents. This review did not execute a credential-resolution test. [Pinned authentication documentation][o-nesting]

### Scheduling, results and restart

Source defaults are depth 5, active-child admission cap 5 per parent and executing-child concurrency 8 per immediate spawning session. These are separate limits. Accepted excess execution can queue, and each nested orchestrator has its own lane. This is not one global tree-wide budget. Lina should record a total tree budget explicitly if it wants one. [Limit constants][o-limits], [operations][o-operations]

The parent can yield for child completion or wait on selected native run IDs. A child result normally travels one parent hop at a time; nested parents synthesize before returning upward. Controls separate steer, follow-up and notify. Notify is process-local queued context and does not wake execution or promise restart durability. Completion delivery is another path with retained results, delivery state and retry handling. Private parent completion is supported for a constrained native one-shot mode, allowing parent review before external communication. [Tool reference][o-reference], [completion delivery][o-announce]

The registry persists execution and delivery state with current-owner/version checks and represents unknown database write outcomes. Restart recovery rechecks exact child/run ownership. Interrupted children are settled as interrupted instead of blindly relaunched, while an already-admitted yielded parent continuation can retain its captured child batch. Parents decide whether to inspect, continue a retained session or spawn replacement work. Explicit stop cascades through selected descendants and retires their pending continuations, preserving captured results. Restart, cancellation and successful result delivery are therefore distinct graph paths. [Registry persistence][o-persistence], [restart coordinator][o-recovery], [operations][o-operations]

`outputSchema` on current `sessions_spawn` is restricted to enabled Swarm with `collect=true`; it is not ordinary native-child structured output. Lina can choose a reusable result envelope without claiming ordinary OpenClaw children already enforce the same schema. [Spawn request validation][o-request]

## Implications for Lina's graph proposal

These are design recommendations inferred from the inspected mechanisms, not measurements of which agent performs better.

- Keep delegation as a model-requested registered tool, with host admission as a separate step. Deterministic orchestration may submit the same request contract later.
- Represent a child assignment, context preparation, capability/limit resolution, child registration and launch separately. Reuse Context, Tools, Model Interface, Safety, State and Memory rather than build duplicate versions inside Subagents.
- Give children their own execution identity and loop state, linked to the parent task and a fixed parent incarnation. A diagram can reuse the loop visually while showing which agent currently owns execution.
- Separate the active-child cap, execution concurrency, nesting depth, model/iteration allowance and any total tree budget. Make queue versus rejection an explicit policy.
- Make result capture, result validation, delivery and parent integration distinct. Captured results should remain inspectable when delivery fails. Parent acceptance of a result is not automatic permission to publish child memory.
- Include steer/follow-up/notify semantics without promising delivery from mere message admission. Controls must reference an owned child run and apply at a defined boundary.
- Draw timeout, cancellation, partial output and interrupted recovery explicitly. Require reconciliation before replacement work when side effects may already have happened.
- Keep isolated versus forked context, shared versus isolated workspace, child memory access and publication policy independent. Their effects can be compared without changing the ordinary single-agent baseline.

Useful first simulations are one child, parallel siblings, queued versus rejected spawn, denied capability, fork fallback, invalid child result, parent continuing while a child runs, yielded parent, child timeout with partial output, cascade cancellation, delivery retry, parent-reset stale result, and restart with one recorded sibling plus one unknown sibling. Optional external runtimes, cloud placement, Swarm and collaborative peer handoffs can remain separately marked extensions.

## Sources

[h-build]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/delegate_tool.py

[h-config]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/delegate_tool_config.py

[h-tools]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/delegate_tool_toolsets.py

[h-run]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/delegate_tool_child_run.py

[h-agent]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/run_agent.py

[h-dispatch]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/delegate_tool_dispatch.py

[h-registry]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/delegate_tool_registry.py

[h-output]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/delegation_output_schema.py

[h-results]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/delegate_tool_results.py

[h-async]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/async_delegation.py

[h-worktree]: https://github.com/NousResearch/hermes-agent/blob/517b5e10febd619ce30bb22580e29b160266eb43/tools/subagent_worktree.py

[o-tool]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/agents/tools/sessions-spawn-tool.ts

[o-target]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/agents/subagents/spawn/subagent-target-policy.ts

[o-plan]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/agents/subagents/spawn/subagent-spawn-plan.ts

[o-context]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/agents/subagents/spawn/subagent-spawn-context.ts

[o-workspace]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/agents/workspace.ts

[o-prompt]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/agents/subagents/spawn/subagent-system-prompt.ts

[o-capabilities]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/agents/subagents/spawn/subagent-capabilities.ts

[o-lineage]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/agents/subagents/spawn/spawn-parent-lineage.ts

[o-memory]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/plugins/memory-audience.ts

[o-nesting]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/docs/tools/subagents/nesting.md

[o-limits]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/config/agent-limits.ts

[o-reference]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/docs/tools/subagents/tool-reference.md

[o-announce]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/docs/tools/subagents/announce.md

[o-persistence]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/agents/subagents/registry/subagent-registry-persistence.ts

[o-recovery]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/agents/subagents/registry/subagent-registry-restart-recovery-coordinator.ts

[o-operations]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/docs/tools/subagents/operations.md

[o-request]: https://github.com/openclaw/openclaw/blob/d60f85fb9771bea5d3c9f79b95413591aed25b1d/src/agents/subagents/spawn/subagent-spawn-request.ts

Live documentation cross-checks: [Hermes delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation/), [OpenClaw subagents](https://docs.openclaw.ai/tools/subagents), [OpenClaw tool reference](https://docs.openclaw.ai/tools/subagents/tool-reference). Immutable source links above govern implementation claims.
