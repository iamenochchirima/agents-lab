# Pi explorer semantic audit

## Scope and reproducibility

Audited on 2026-10-04 against read-only local `earendil-works/pi` HEAD
`a276dabe57911253350bffb93cb7d7aff6a73261`. The checkout was clean. This ledger
covers every existing graph item: **132 nodes, 188 edges and six illustrative
traces**, including experimental durable and remote boundaries. It records static
source inspection, not executed Pi telemetry. No provider, tool, runtime or tests
were invoked. No dependency was added.

Source repository: [earendil-works/pi](https://github.com/earendil-works/pi).
Evidence paths below are relative to a checkout of the pinned revision. To reproduce a finding, inspect
the listed line with surrounding owner body and its callers; line existence alone
is insufficient. The graph data lives in
[`pi.ts`](../../../../apps/web/src/features/system-explorer/data/pi.ts).

## Meaning of statuses

- **verified:** the item's stated surface relationship/behavior was inspected in
  source. This does not establish exhaustive internal branch coverage or runtime
  guarantees. Generic dispatch arrows remain conditional on the selected implementation.
- **corrected:** a concrete wording, owner, condition, ordering or anchor defect
  was repaired. A remaining limitation is recorded when deeper work is still required.
- **needs-deeper-review:** the owner and cited boundary were inspected, but one or
  more broad behaviors require additional caller/implementation review. This is
  deliberately not treated as verification of the entire description.

The inspection covered all anchor neighborhoods and then focused owner bodies:
agent-loop preparation/stream/tool validation and finalization; session request
projection/turn boundary/next-turn refresh, prompt/retry/recovery/manual and
reload ordering; branch projection and compaction checkpoint construction;
physical/virtual model dispatch; outer script store/callback handling; remote
request framing and worker facet provisioning; durable tool-round commits and
foreground subagent reuse. The remaining-review entries show where this pass
stopped short of a complete subsystem audit.

## Findings that affect understanding

1. **Manual compaction aborts first.** `compact()` awaits `abort()` before installing
   its controller. It is not a busy-operation rejection gate.
2. **Reload does not abort on its own.** InteractiveMode rejects reload while busy
   or compacting. SDK users cannot infer equivalent settlement from `reload()`.
3. **Parallel tool calls have an ordered join.** Preparation is serial; prepared
   executions launch together; result messages publish in original call order after
   all settle. Termination requires every finalized result to request it, and
   `finishTurn(end)` takes precedence over another turn.
4. **Queues are volatile.** Steering and follow-up are process-memory queues until
   admitted and persisted through `message_end`.
5. **Recovery and summary routing have different owners.** Request virtual-routing
   evidence previously pointed to summary routing; recovery edit evidence pointed
   to boundary draft application. Both now cite their actual callers.
6. **Compaction checkpoints include system state.** The entry preserves the current
   system message in addition to summary/kept-entry metadata.
7. **Script store commits are conditional.** Success and an installed append callback
   are required. Script failure does not undo external nested-tool side effects.
8. **Remote startup and endpoint ownership differ.** CoordinatorConnection is a
   server router endpoint; startup leases and coordinator launching belong to server
   startup. Several source anchors had pointed only to imports or interfaces.

## Correction log

- **`endpoint`** (source): Replaced unrelated cost-rate anchor with actual configured endpoint field.
  - source before: packages/ai/src/types.ts:1056; after: packages/ai/src/types.ts:1102
- **`compact-entry`** (summary, source): Compaction entry also preserves current structured system prompt checkpoint.
  - summary before: Records summary, firstKeptEntryId, tokensBefore, extension details and optional usage; projection reads this boundary.; after: Records summary, firstKeptEntryId, tokensBefore, details/usage and current system-message checkpoint; projection reads this boundary.
  - source before: packages/coding-agent/src/core/session-manager.ts:1202; after: packages/coding-agent/src/core/session-manager.ts:1261
- **`manual`** (conditions): Manual operation aborts and settles work before preparing; it does not simply reject a busy run.
  - conditions before: Cannot run against conflicting active operations; independently abortable.; after: Explicit compact() first awaits abort(), then installs an independently abortable manual compaction controller.
- **`reload`** (summary, source, conditions): reload() does not itself abort; InteractiveMode checks busy/compacting before calling it.
  - summary before: Stops current activity, reloads resources/provider registrations, rebuilds extension runtime and emits restart lifecycle.; after: Emits shutdown, reloads resources/provider registrations and rebuilds extension runtime; emits session_start when host bindings exist.
  - source before: packages/coding-agent/src/core/agent-session.ts:3612; after: packages/coding-agent/src/core/agent-session.ts:3612; packages/coding-agent/src/modes/interactive/interactive-mode.ts:6356
  - conditions before: (absent); after: Interactive /reload rejects busy or compacting state. Direct SDK callers must arrange safe lifecycle ordering; reload() does not call abort().
- **`coordinator`** (summary, notes): CoordinatorConnection owns server-side routing endpoint, not startup lease/coordinator spawning.
  - summary before: Coordinates experimental server process startup and control-channel ownership.; after: Server-side endpoint of the coordinator router tracks registered peers and replacement, routes opaque control messages and detects connection loss.
  - notes before: (absent); after: ensureCoordinator/startup leases belong to server startup; this class is the registered server endpoint.
- **`agents-files`** (outputs): General nearest-file overriding was misleading; source concatenates ancestry and separately shadows worktree main-repo counterpart.
  - outputs before: Ordered paths and contents; closer context files can shadow alternatives.; after: Global instruction file followed by ancestor files from root to cwd, deduplicated by path; linked-worktree counterpart can be shadowed.
- **`mutation`** (summary): Serialization scope is per canonical file, not all mutations.
  - summary before: Serializes related builtin mutations instead of allowing parallel write/edit races.; after: Serializes builtin mutations targeting the same canonical file; mutations for different files can run in parallel.
- **`dispatch`** (notes): Batch termination requires every finalized result to request termination; parallel preparation and result publication ordering are material.
  - notes before: (absent); after: Parallel mode prepares calls serially, then launches prepared executions with Promise.all; result messages are emitted in original call order after the join. A batch terminates only when all finalized results request terminate.
- **`steer`** (notes): Pending messages are volatile until admitted, not a durable inbox.
  - notes before: Steering is not injected in the middle of the current provider stream.; after: Steering is not injected mid-stream. Queue is process memory; its message is persisted only when admitted as message_end.
- **`followup`** (notes): Pending follow-up storage is volatile until admitted.
  - notes before: (absent); after: Queue is process memory; admitted user messages later become transcript entries. End decisions can leave queued work for a later higher-level continuation.
- **`script-store`** (conditions): Successful standalone script calls may have no append callback; only extension-backed configured writer persists.
  - conditions before: Writes are committed only when script result is successful.; after: Script success, nonempty storeWrites and installed appendEntry callback; without session context writes are dropped.
- **`cli-mode-1`** (source): Use actual caller rather than callee declaration.
  - source before: packages/coding-agent/src/main.ts:112; after: packages/coding-agent/src/main.ts:651
- **`cli-initial-2`** (source): Use actual caller rather than callee declaration.
  - source before: packages/coding-agent/src/main.ts:211; after: packages/coding-agent/src/main.ts:900
- **`sdk-manager-13`** (source): Replace option-interface comment with actual manager selection.
  - source before: packages/coding-agent/src/core/sdk.ts:83; after: packages/coding-agent/src/core/sdk.ts:185
- **`resources-settings-22`** (source): Replace pre-trust bootstrap occurrence with final trusted-state reload.
  - source before: packages/coding-agent/src/core/resource-loader.ts:501; after: packages/coding-agent/src/core/resource-loader.ts:520
- **`resources-skills-27`** (source): Replace resource-extension pass with reload caller.
  - source before: packages/coding-agent/src/core/resource-loader.ts:477; after: packages/coding-agent/src/core/resource-loader.ts:592
- **`resources-templates-28`** (source): Replace resource-extension pass with reload caller.
  - source before: packages/coding-agent/src/core/resource-loader.ts:485; after: packages/coding-agent/src/core/resource-loader.ts:607
- **`resources-agents-files-29`** (source, condition): Context discovery uses noContextFiles; source does not gate instruction-text loading on project trust.
  - source before: packages/coding-agent/src/core/resource-loader.ts:232; after: packages/coding-agent/src/core/resource-loader.ts:637
  - condition before: (absent); after: Context files enabled (noContextFiles is false); project instruction text loading itself is not gated by project trust
- **`tui-prompt-30`** (source): Replace startup initial-input call with actual editor input owner.
  - source before: packages/coding-agent/src/modes/interactive/interactive-mode.ts:1221; after: packages/coding-agent/src/modes/interactive/interactive-mode.ts:1243
- **`prompt-loadout-44`** (source): Replace next-turn refresh occurrence with idle prompt caller.
  - source before: packages/coding-agent/src/core/agent-session.ts:887; after: packages/coding-agent/src/core/agent-session.ts:2058
- **`prompt-sections-agents-files-46`** (source): Replace option-interface declaration with actual rendering.
  - source before: packages/coding-agent/src/core/system-prompt.ts:29; after: packages/coding-agent/src/core/system-prompt.ts:164
- **`prompt-sections-skills-47`** (source, condition): Skills prompt requires active read or bash and nonempty skill metadata.
  - source before: packages/coding-agent/src/core/system-prompt.ts:22; after: packages/coding-agent/src/core/system-prompt.ts:167
  - condition before: (absent); after: Selected tools include read or bash and skills are loaded
- **`projection-context-54`** (source): Replace physical next-turn compaction helper with request projection caller.
  - source before: packages/coding-agent/src/core/agent-session.ts:749; after: packages/coding-agent/src/core/agent-session.ts:765
- **`projection-route-55`** (source): Replace summary direct routing occurrence with agent request routing.
  - source before: packages/coding-agent/src/core/agent-session.ts:556; after: packages/coding-agent/src/core/agent-session.ts:794
- **`provider-stream-adapters-66`** (source): Anchor actual physical provider dispatch rather than virtual routing start.
  - source before: packages/coding-agent/src/core/model-runtime.ts:715; after: packages/coding-agent/src/core/model-runtime.ts:738
- **`mcp-conn-mcp-transport-94`** (source): Replace transport factory declaration with connection caller.
  - source before: packages/coding-agent/src/extensions/mcp/runtime.ts:97; after: packages/coding-agent/src/extensions/mcp/runtime.ts:383
- **`nested-mcp-conn-102`** (source): Replace generic script catalogue construction with MCP-backed execution.
  - source before: packages/coding-agent/src/extensions/codemode/execute.ts:345; after: packages/coding-agent/src/extensions/mcp/tools.ts:314
- **`tree-context-115`** (source): Replace method declaration with actual post-navigation refresh.
  - source before: packages/coding-agent/src/core/agent-session.ts:3915; after: packages/coding-agent/src/core/agent-session.ts:4088
- **`compact-entry-context-126`** (source): Replace legacy migration branch with current compaction-aware projection.
  - source before: packages/coding-agent/src/core/session-manager.ts:302; after: packages/coding-agent/src/core/session-manager.ts:481
- **`omit-context-edit-130`** (source): Replace boundary-draft edit occurrence with recovery omission caller.
  - source before: packages/coding-agent/src/core/agent-session.ts:935; after: packages/coding-agent/src/core/agent-session.ts:1219
- **`loop-turn-decision-133`** (source): Anchor successful turn decision; failed branch ignores decision and exits.
  - source before: packages/agent/src/agent-loop.ts:252; after: packages/agent/src/agent-loop.ts:286
- **`turn-decision-boundary-134`** (source): Anchor actual wrapper call rather than installer declaration.
  - source before: packages/coding-agent/src/core/agent-session.ts:858; after: packages/coding-agent/src/core/agent-session.ts:862
- **`settle-loop-138`** (source): Replace post-run retry continuation with before-settle continuation.
  - source before: packages/coding-agent/src/core/agent-session.ts:1789; after: packages/coding-agent/src/core/agent-session.ts:1794
- **`remote-client-frame-148`** (source): Replace cancel-frame occurrence with request frame encoding.
  - source before: packages/client/src/client.ts:256; after: packages/client/src/client.ts:290
- **`frame-remote-server-149`** (source): Replace import statement with decoder instance.
  - source before: packages/server/src/server.ts:16; after: packages/server/src/server.ts:156
- **`worker-facets-154`** (source): Replace import with actual facet construction.
  - source before: packages/coding-agent/src/experimental/services/worker.ts:3; after: packages/coding-agent/src/experimental/services/worker.ts:82
- **`facets-controller-155`** (source): Replace type import with service registration.
  - source before: packages/coding-agent/src/experimental/services/agent-controller-provider.ts:11; after: packages/coding-agent/src/experimental/services/worker.ts:62
- **`plugins-facets-161`** (source): Replace interface declaration with serialized worker reload implementation.
  - source before: packages/coding-agent/src/experimental/services/plugins.ts:9; after: packages/coding-agent/src/experimental/services/worker.ts:96
- **`generation-durable-tool-168`** (source): Replace checkpoint type field with actual task creation.
  - source before: packages/durable/src/harness/generation.ts:86; after: packages/durable/src/harness/generation.ts:578
- **`services-sdk-11`** (label, kind): Services value is input to adapter; creation is not called inside services constructor.
  - label before: create session from services; after: services supplied to session factory
  - kind before: call; after: data
- **`before-start-images-43`** (label, kind, condition): AgentSession.prompt owns both operations; hook does not directly call normalization.
  - label before: normalize after model selection; after: prompt resumes with image normalization
  - kind before: call; after: transition
  - condition before: (absent); after: before_agent_start handlers finished; normalization is owned by AgentSession.prompt
- **`adapters-provider-retry-68`** (condition): Retry wrapper runs for initial request too; only repeated attempts require retryable failure/budget.
  - condition before: Retryable provider transport failure; after: Concrete OpenAI Responses adapter wraps initial request; retries require retryable failure and remaining configured budget
- **`execute-tool-tool-result-78`** (label, kind, condition): Dispatcher/runToolCall performs finalization after execute helper returns.
  - label before: post-execution interception; after: caller finalizes executed outcome
  - kind before: call; after: transition
  - condition before: Executed call finalized; after: Prepared execution returned; dispatcher or runToolCall invokes finalizeExecutedToolCall
- **`subagent-conversation-172`** (condition): Edge includes reuse as well as creation, so old no-child condition excluded a valid path.
  - condition before: No child exists for this tool task; after: Tool task starts or replays: reuse existing task-owned child; create only when none exists
- **`manual-summarize-123`** (condition): Extension-supplied compaction skips default generation.
  - condition before: (absent); after: No extension supplied compaction; operation not cancelled
- **`tool-result-loop-181`** (label, condition): Appending occurs regardless of termination; continuation also constrained by finishTurn end.
  - label before: append results and continue tool round; after: append finalized results; possibly continue
  - condition before: Tool batch does not terminate; after: Results are appended even for terminating batch; another tool turn requires nonterminating batch and no finishTurn end override
- **`truncated-loop-182`** (condition): finishTurn can stop rather than guarantee next corrective generation.
  - condition before: Truncated call batch returns error results; after: Length-stopped calls produce error results; next correction turn requires no finishTurn end override
- **`answer`** (steps): Move initial finalized message persistence before runLoop; runAgentLoop owns those events.
  - steps before: tui: Editor submits user input to the current stable session. → prompt: Validate idle prompt, input interception and expansion. → before-start: Run before_agent_start hooks before message construction. → images: Prepare supplied images against selected model limits; none assumed here. → loadout: Construct prompt section changes and executable tool loadout. → run: Start the coding-agent activity. → agent: Agent begins low-level prompt lifecycle. → loop: Emit initial message events and enter first assistant turn. → event-persist: Initial finalized system/user messages become session entries. → projection: Read the persisted canonical request view. → stream: Transform and convert context before provider call. → provider-stream: Request selected model through ModelRuntime. → stream: Receive streamed text and final successful assistant message. → event-persist: Persist assistant message_end. → turn-decision: Finish turn; assume no continuation request. → loop: No tools, steering or follow-ups: emit agent_end. → settle: No late work; emit agent_settled.; after: tui: Editor submits user input to the current stable session. → prompt: Validate idle prompt, input interception and expansion. → before-start: Run before_agent_start hooks before message construction. → images: Prepare supplied images against selected model limits; none assumed here. → loadout: Construct prompt section changes and executable tool loadout. → run: Start the coding-agent activity. → agent: Agent begins low-level prompt lifecycle. → event-persist: Initial finalized system/user messages become session entries. → loop: Enter runLoop after runAgentLoop emitted initial system/user message_end events; enter first assistant turn. → projection: Read the persisted canonical request view. → stream: Transform and convert context before provider call. → provider-stream: Request selected model through ModelRuntime. → stream: Receive streamed text and final successful assistant message. → event-persist: Persist assistant message_end. → turn-decision: Finish turn; assume no continuation request. → loop: No tools, steering or follow-ups: emit agent_end. → settle: No late work; emit agent_settled.
- **`steering`** (steps): Show follow-up arrival as concurrent with generation rather than implying queueing only after completion.
  - steps before: prompt: New user input arrives while streaming. → input-hooks: Hooks pass input through; skill/template expansion follows. → busy: Explicit steer behavior selected. → steer: Message waits in steering queue. → stream: Existing provider response completes. → turn-decision: Existing turn boundary completes. → loop: Poll steering queue for another inner-loop turn. → refresh: Prepare next turn context. → event-persist: Queued user message starts and ends; UI queue updates and persistence follows. → projection: Project next request with admitted steering input. → stream: Respond to the steering message. → followup: Assume a separate follow-up was queued earlier. → loop: Drain follow-up only when inner loop would stop. → stream: Respond to follow-up in another turn. → settle: Both queues empty; settle.; after: prompt: New user input arrives while streaming. → input-hooks: Hooks pass input through; skill/template expansion follows. → busy: Explicit steer behavior selected. → steer: Message waits in steering queue. → stream: Existing provider response completes. → turn-decision: Existing turn boundary completes. → loop: Poll steering queue for another inner-loop turn. → refresh: Prepare next turn context. → event-persist: Queued user message starts and ends; UI queue updates and persistence follows. → projection: Project next request with admitted steering input. → stream: Respond to the steering message. → followup: A separate follow-up is queued while the steering response is running; this event is concurrent with that response. → loop: Drain follow-up only when inner loop would stop. → stream: Respond to follow-up in another turn. → settle: Both queues empty; settle.
- **`script`** (steps): Clarify conditional store persistence and nontransactional external tool effects.
  - steps before: stream: Model issues complete codemode script call. → event-persist: Persist outer assistant call. → prepare-tool: Validate script call and run tool_call hooks. → codemode: Load lazy executor. → sandbox: Expose callable tools, discovery globals and branch store. → script-store: Load values from current branch. → nested: Script invokes ctx.executeTool proxy with parent call ID. → prepare-tool: Nested call receives the shared validation pipeline. → tool-hook: Assume extension allows nested call. → mcp-conn: Registered MCP-backed implementation calls configured server. → mcp-server: Assume successful remote response. → tool-result: Nested result passes result interception. → sandbox: Script processes result and emits output; successful writes become custom entries. → event-persist: Persist outer tool result including nested-call records. → refresh: Prepare next assistant response with outer result. → stream: Model answers from script output. → settle: Settle activity.; after: stream: Model issues complete codemode script call. → event-persist: Persist outer assistant call. → prepare-tool: Validate script call and run tool_call hooks. → codemode: Load lazy executor. → sandbox: Expose callable tools, discovery globals and branch store. → script-store: Load values from current branch. → nested: Script invokes ctx.executeTool proxy with parent call ID. → prepare-tool: Nested call receives the shared validation pipeline. → tool-hook: Assume extension allows nested call. → mcp-conn: Registered MCP-backed implementation calls configured server. → mcp-server: Assume successful remote response. → tool-result: Nested result passes result interception. → sandbox: Script processes result and emits output. On successful return, nonempty store writes are appended by the installed callback; external tool effects are not rolled back on script failure. → event-persist: Persist outer tool result including nested-call records. → refresh: Prepare next assistant response with outer result. → stream: Model answers from script output. → settle: Settle activity.
- **`workers-catalog-store-152`** (label, kind): Server host owns metadata lookup; no direct worker→catalogue call is established.
  - label before: select catalogue metadata; after: host combines tracked workers and catalogue metadata
  - kind before: call; after: data

## Coverage gaps and next focused studies

The map has broad source coverage, but these are important omitted internal owners
or compressed topologies. They are not fabricated as unconditional runtime nodes:

- Durable `Submissions`, `CompactionTask`, registry snapshots, kernel commit line,
  storage transaction/publication and task handover deserve separate maps. They
  mediate conversation admission and recovery; Harness → Scheduler alone is not a
  complete durable execution graph.
- Stable finalization currently summarizes `finalizeExecutedToolCall` and the
  sequential/parallel dispatcher helpers in one relationship. Validation failures
  bypass result hooks; executed failures go through finalization. A per-tool-round
  detail view should expose this distinction.
- MCP auth/token refresh, transport reconnect/expired-session logic and resource
  conversion need protocol-level review. A client owner cannot establish remote
  tool idempotency or external server behavior.
- Project trust, package resources, loading/reload, provider auth/catalogues,
  terminal command and RPC command matrices need focused internal audits.
- Chord facet activation/reload, remote attachment state hydration and worker
  retirement/authority handover remain broad boundaries; no exactly-once or
  end-to-end recovery claim is established here.
- The six paths are selected teaching narratives. They omit event fan-out and
  intermediate helpers and must not be read as executable state machines or logs.

## Item ledger

Totals: **51 corrected**, **71 needs-deeper-review**, **204 verified**.

### Nodes

| Item ID | Status | Evidence at pinned source | Rationale / remaining limit |
| --- | --- | --- | --- |
| `cli` | needs-deeper-review | `packages/coding-agent/src/main.ts:573` | Startup dispatch inspected; all argument/auth/install/update early exits not audited. |
| `mode` | verified | `packages/coding-agent/src/main.ts:112` | Owner and claimed surface behavior inspected in surrounding source. |
| `initial` | verified | `packages/coding-agent/src/main.ts:211` | Owner and claimed surface behavior inspected in surrounding source. |
| `tui` | needs-deeper-review | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:447` | Prompt and reload owners inspected; command/UI lifecycle and session switching internals remain collapsed. |
| `print` | needs-deeper-review | `packages/coding-agent/src/modes/print-mode.ts:33` | Initial prompt loop inspected; signal and output backpressure teardown not traced end to end. |
| `rpc` | needs-deeper-review | `packages/coding-agent/src/modes/rpc/rpc-mode.ts:54` | Prompt acknowledgement boundary inspected; every command/error/disposal branch not audited. |
| `rpc-client` | needs-deeper-review | `packages/coding-agent/src/modes/rpc/rpc-client.ts:56` | Spawn/correlation owner inspected; pending request timeout and exit paths need deeper review. |
| `services` | needs-deeper-review | `packages/coding-agent/src/core/agent-session-services.ts:135` | Construction/reload/registration anchors inspected; full trust and provider diagnostic interaction needs deeper review. |
| `sdk` | needs-deeper-review | `packages/coding-agent/src/core/sdk.ts:175` | Agent/session/stream hookup inspected; full restore selection/fallback and custom tool cases need review. |
| `runtime` | verified | `packages/coding-agent/src/core/agent-session-runtime.ts:74` | Owner and claimed surface behavior inspected in surrounding source. |
| `session` | verified | `packages/coding-agent/src/core/agent-session.ts:362` | Owner and claimed surface behavior inspected in surrounding source. |
| `replace` | verified | `packages/coding-agent/src/core/agent-session-runtime.ts:196` | Owner and claimed surface behavior inspected in surrounding source. |
| `shutdown` | verified | `packages/coding-agent/src/core/agent-session-runtime.ts:167` | Owner and claimed surface behavior inspected in surrounding source. |
| `settings` | needs-deeper-review | `packages/coding-agent/src/core/settings-manager.ts:379` | Storage fields/default interface inspected; merge, reload/write and parse failures need full review. |
| `trust` | needs-deeper-review | `packages/coding-agent/src/core/trust-manager.ts:210` | Trust-store responsibility inspected; canonical-root matching and persistence failure cases need full review. |
| `resources` | needs-deeper-review | `packages/coding-agent/src/core/resource-loader.ts:505` | Reload sequence and trust gates inspected; collisions/overrides/loadFinalExtensionSet helpers need full review. |
| `packages` | needs-deeper-review | `packages/coding-agent/src/core/package-manager.ts:812` | Resource resolver owner located; install/update and every source/config branch not audited. |
| `agents-files` | corrected | `packages/coding-agent/src/core/resource-loader.ts:232` | General nearest-file overriding was misleading; source concatenates ancestry and separately shadows worktree main-repo counterpart. |
| `skills` | needs-deeper-review | `packages/coding-agent/src/core/skills.ts:409` | Discovery owner inspected; symlink/collision/frontmatter failure claims need full review. |
| `templates` | verified | `packages/coding-agent/src/core/prompt-templates.ts:304` | Owner and claimed surface behavior inspected in surrounding source. |
| `extension-loader` | needs-deeper-review | `packages/coding-agent/src/core/extensions/loader.ts:711` | Public load wrapper inspected; factory loading/cache/individual failures not traced fully. |
| `builtin-ext` | verified | `packages/coding-agent/src/extensions/index.ts:7` | Owner and claimed surface behavior inspected in surrounding source. |
| `prompt` | verified | `packages/coding-agent/src/core/agent-session.ts:1921` | Owner and claimed surface behavior inspected in surrounding source. |
| `commands` | verified | `packages/coding-agent/src/core/agent-session.ts:2069` | Owner and claimed surface behavior inspected in surrounding source. |
| `input-hooks` | verified | `packages/coding-agent/src/core/agent-session.ts:1870` | Owner and claimed surface behavior inspected in surrounding source. |
| `skill-expand` | verified | `packages/coding-agent/src/core/agent-session.ts:2100` | Owner and claimed surface behavior inspected in surrounding source. |
| `busy` | verified | `packages/coding-agent/src/core/agent-session.ts:1966` | Owner and claimed surface behavior inspected in surrounding source. |
| `steer` | corrected | `packages/agent/src/agent.ts:299` | Pending messages are volatile until admitted, not a durable inbox. |
| `followup` | corrected | `packages/agent/src/agent.ts:304` | Pending follow-up storage is volatile until admitted. |
| `before-start` | verified | `packages/coding-agent/src/core/agent-session.ts:2015` | Owner and claimed surface behavior inspected in surrounding source. |
| `images` | needs-deeper-review | `packages/coding-agent/src/core/agent-session.ts:1890` | Normalization loop owner inspected; processImage invalid-image/profile branches not audited. |
| `loadout` | verified | `packages/coding-agent/src/core/agent-session.ts:1689` | Owner and claimed surface behavior inspected in surrounding source. |
| `agent` | needs-deeper-review | `packages/agent/src/agent.ts:188` | Run dispatch/state ownership and queues inspected; lifecycle catch/event subscriber exceptions need full review. |
| `run` | verified | `packages/coding-agent/src/core/agent-session.ts:1775` | Owner and claimed surface behavior inspected in surrounding source. |
| `loop` | verified | `packages/agent/src/agent-loop.ts:163` | Owner and claimed surface behavior inspected in surrounding source. |
| `refresh` | verified | `packages/coding-agent/src/core/agent-session.ts:870` | Owner and claimed surface behavior inspected in surrounding source. |
| `turn-decision` | verified | `packages/agent/src/agent-loop.ts:286` | Owner and claimed surface behavior inspected in surrounding source. |
| `stop` | verified | `packages/agent/src/agent-loop.ts:245` | Owner and claimed surface behavior inspected in surrounding source. |
| `abort` | verified | `packages/coding-agent/src/core/agent-session.ts:2387` | Owner and claimed surface behavior inspected in surrounding source. |
| `projection` | verified | `packages/coding-agent/src/core/agent-session.ts:759` | Owner and claimed surface behavior inspected in surrounding source. |
| `route` | verified | `packages/coding-agent/src/core/model-runtime.ts:994` | Owner and claimed surface behavior inspected in surrounding source. |
| `route-state` | verified | `packages/coding-agent/src/core/agent-session.ts:804` | Owner and claimed surface behavior inspected in surrounding source. |
| `tool-delta` | verified | `packages/agent/src/agent-loop.ts:333` | Owner and claimed surface behavior inspected in surrounding source. |
| `transform` | verified | `packages/coding-agent/src/core/agent-session.ts:1720` | Owner and claimed surface behavior inspected in surrounding source. |
| `convert` | verified | `packages/coding-agent/src/core/messages.ts:148` | Owner and claimed surface behavior inspected in surrounding source. |
| `stream` | verified | `packages/agent/src/agent-loop.ts:381` | Owner and claimed surface behavior inspected in surrounding source. |
| `prompt-sections` | verified | `packages/coding-agent/src/core/system-prompt.ts:121` | Owner and claimed surface behavior inspected in surrounding source. |
| `model-runtime` | needs-deeper-review | `packages/coding-agent/src/core/model-runtime.ts:171` | Registration/routing/dispatch inspected; classification/image and provider composition internals remain collapsed. |
| `auth` | needs-deeper-review | `packages/coding-agent/src/core/model-runtime.ts:549` | getAuth composition inspected; refreshed credential storage/provider failure behavior not fully traced. |
| `catalog` | needs-deeper-review | `packages/coding-agent/src/core/model-runtime.ts:839` | Refresh owner inspected; provider network refresh/cache behavior not traced. |
| `provider-stream` | verified | `packages/coding-agent/src/core/model-runtime.ts:715` | Owner and claimed surface behavior inspected in surrounding source. |
| `adapters` | needs-deeper-review | `packages/ai/src/api/openai-responses.ts:127` | OpenAI Responses concrete dispatch inspected; other provider translation/decoding boundaries not reviewed. |
| `provider-retry` | verified | `packages/ai/src/utils/provider-retry.ts:105` | Owner and claimed surface behavior inspected in surrounding source. |
| `provider-hooks` | verified | `packages/coding-agent/src/core/sdk.ts:358` | Owner and claimed surface behavior inspected in surrounding source. |
| `endpoint` | corrected | `packages/ai/src/types.ts:1102` | Replaced unrelated cost-rate anchor with actual configured endpoint field. |
| `dispatch` | corrected | `packages/agent/src/agent-loop.ts:508` | Batch termination requires every finalized result to request termination; parallel preparation and result publication ordering are material. |
| `truncated` | verified | `packages/agent/src/agent-loop.ts:478` | Owner and claimed surface behavior inspected in surrounding source. |
| `prepare-tool` | verified | `packages/agent/src/agent-loop.ts:707` | Owner and claimed surface behavior inspected in surrounding source. |
| `tool-hook` | verified | `packages/coding-agent/src/core/agent-session.ts:630` | Owner and claimed surface behavior inspected in surrounding source. |
| `execute-tool` | verified | `packages/agent/src/agent-loop.ts:820` | Owner and claimed surface behavior inspected in surrounding source. |
| `tool-result` | verified | `packages/coding-agent/src/core/agent-session.ts:656` | Owner and claimed surface behavior inspected in surrounding source. |
| `read` | needs-deeper-review | `packages/coding-agent/src/core/tools/read.ts:201` | Factory and execution owner inspected; all image/truncation/offset branches not traced. |
| `bash` | needs-deeper-review | `packages/coding-agent/src/core/tools/bash.ts:434` | Factory and execution owner inspected; shell process-tree cancellation/timeout behavior not traced. |
| `edit` | needs-deeper-review | `packages/coding-agent/src/core/tools/edit.ts:218` | Mutation ordering inspected; exact-match/diff/Unicode implementation not fully traced. |
| `write` | needs-deeper-review | `packages/coding-agent/src/core/tools/write.ts:95` | Mutation ordering inspected; filesystem failure after side effect needs focused review. |
| `search` | needs-deeper-review | `packages/coding-agent/src/core/tools/grep.ts:321` | Grep owner inspected; find/ls and external binary/output truncation remain collapsed. |
| `mutation` | corrected | `packages/coding-agent/src/core/tools/file-mutation-queue.ts:32` | Serialization scope is per canonical file, not all mutations. |
| `filesystem` | verified | `packages/coding-agent/src/core/tools/path-utils.ts:48` | Owner and claimed surface behavior inspected in surrounding source. |
| `mcp-ext` | needs-deeper-review | `packages/coding-agent/src/extensions/mcp/index.ts:276` | Registration/codemode exposure inspected; bounded first-prompt wait and every exposure override need full review. |
| `mcp-conn` | needs-deeper-review | `packages/coding-agent/src/extensions/mcp/runtime.ts:155` | Transport creation owner inspected; auth/reconnect/expired-session recovery not fully traced. |
| `mcp-transport` | verified | `packages/coding-agent/src/extensions/mcp/runtime.ts:97` | Owner and claimed surface behavior inspected in surrounding source. |
| `mcp-resources` | needs-deeper-review | `packages/coding-agent/src/extensions/mcp/resources.ts:197` | Resource definitions inspected; conversion and all protocol failures not traced. |
| `mcp-server` | needs-deeper-review | `packages/coding-agent/src/extensions/mcp/runtime.ts:56` | Connection-state contract inspected; underlying remote server cannot be verified from client source. |
| `tool-search` | verified | `packages/coding-agent/src/extensions/tool-search/tool.ts:119` | Owner and claimed surface behavior inspected in surrounding source. |
| `codemode` | needs-deeper-review | `packages/coding-agent/src/extensions/codemode/tool.ts:365` | Inactive registration and executor owner inspected; every loadout mode/recursive exposure gate not fully traced. |
| `sandbox` | needs-deeper-review | `packages/coding-agent/src/extensions/codemode/execute.ts:320` | Outer execution/store commit inspected; QuickJS worker isolation and cancellation internals need full review. |
| `nested` | needs-deeper-review | `packages/coding-agent/src/core/nested-tool-calls.ts:160` | Shared validation and parent-ID wiring inspected; nested queue cancellation and scope cleanup need full review. |
| `script-store` | corrected | `packages/coding-agent/src/extensions/codemode/execute.ts:220` | Successful standalone script calls may have no append callback; only extension-backed configured writer persists. |
| `manager` | verified | `packages/coding-agent/src/core/session-manager.ts:987` | Owner and claimed surface behavior inspected in surrounding source. |
| `jsonl` | verified | `packages/coding-agent/src/core/session-manager.ts:1172` | Owner and claimed surface behavior inspected in surrounding source. |
| `event-persist` | verified | `packages/coding-agent/src/core/agent-session.ts:1074` | Owner and claimed surface behavior inspected in surrounding source. |
| `branch` | verified | `packages/coding-agent/src/core/session-manager.ts:1469` | Owner and claimed surface behavior inspected in surrounding source. |
| `context` | verified | `packages/coding-agent/src/core/session-manager.ts:543` | Owner and claimed surface behavior inspected in surrounding source. |
| `context-edit` | verified | `packages/coding-agent/src/core/session-manager.ts:1360` | Owner and claimed surface behavior inspected in surrounding source. |
| `tree` | verified | `packages/coding-agent/src/core/agent-session.ts:3915` | Owner and claimed surface behavior inspected in surrounding source. |
| `fork` | verified | `packages/coding-agent/src/core/session-manager.ts:1632` | Owner and claimed surface behavior inspected in surrounding source. |
| `export` | verified | `packages/coding-agent/src/core/agent-session.ts:4239` | Owner and claimed surface behavior inspected in surrounding source. |
| `pressure` | verified | `packages/coding-agent/src/core/compaction/compaction.ts:267` | Owner and claimed surface behavior inspected in surrounding source. |
| `manual` | corrected | `packages/coding-agent/src/core/agent-session.ts:2717` | Manual operation aborts and settles work before preparing; it does not simply reject a busy run. Remaining: Abort-first and summary boundary inspected; every extension replacement/failure branch not traced. |
| `auto` | verified | `packages/coding-agent/src/core/agent-session.ts:3050` | Owner and claimed surface behavior inspected in surrounding source. |
| `prepare-summary` | needs-deeper-review | `packages/coding-agent/src/core/compaction/compaction.ts:872` | Projected-entry preparation inspected; complete cut-point algorithm/file-operation carryover not traced. |
| `summarize` | needs-deeper-review | `packages/coding-agent/src/core/compaction/compaction.ts:965` | Model call and split-summary entry inspected; all splitting/summary retry contracts need full review. |
| `compact-entry` | corrected | `packages/coding-agent/src/core/session-manager.ts:1261` | Compaction entry also preserves current structured system prompt checkpoint. |
| `overflow` | verified | `packages/coding-agent/src/core/agent-session.ts:2900` | Owner and claimed surface behavior inspected in surrounding source. |
| `omit` | verified | `packages/coding-agent/src/core/agent-session.ts:1208` | Owner and claimed surface behavior inspected in surrounding source. |
| `auto-retry` | verified | `packages/coding-agent/src/core/agent-session.ts:3713` | Owner and claimed surface behavior inspected in surrounding source. |
| `branch-summary` | needs-deeper-review | `packages/coding-agent/src/core/compaction/branch-summarization.ts:293` | Generation owner and tree caller inspected; token budget/file-operation preservation algorithm not fully traced. |
| `runner` | needs-deeper-review | `packages/coding-agent/src/core/extensions/runner.ts:356` | Boundary and specialized hook call sites inspected; every emitter merge/error rule not audited. |
| `boundary` | verified | `packages/coding-agent/src/core/agent-session.ts:818` | Owner and claimed surface behavior inspected in surrounding source. |
| `settle` | verified | `packages/coding-agent/src/core/agent-session.ts:1846` | Owner and claimed surface behavior inspected in surrounding source. |
| `reload` | corrected | `packages/coding-agent/src/core/agent-session.ts:3612`; `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6356` | reload() does not itself abort; InteractiveMode checks busy/compacting before calling it. |
| `events` | verified | `packages/coding-agent/src/core/agent-session.ts:1339` | Owner and claimed surface behavior inspected in surrounding source. |
| `usage` | verified | `packages/coding-agent/src/core/agent-session.ts:4134` | Owner and claimed surface behavior inspected in surrounding source. |
| `cache` | needs-deeper-review | `packages/coding-agent/src/core/cache-warmer.ts:162` | Warming caller and usage append inspected; TTL/prefix/race safety gates need full review. |
| `output` | needs-deeper-review | `packages/coding-agent/src/core/output-guard.ts:45` | Stdout takeover/raw-write owners inspected; transient-buffer retry/backpressure ordering not fully traced. |
| `diagnostics` | needs-deeper-review | `packages/coding-agent/src/core/crash-log.ts:124` | Best-effort crash owner inspected; startup diagnostic sources broader than crash logging. |
| `telemetry` | verified | `packages/coding-agent/src/core/telemetry.ts:8` | Owner and claimed surface behavior inspected in surrounding source. |
| `experimental` | needs-deeper-review | `packages/coding-agent/src/cli/experimental/cli.ts:16` | Explicit experimental command dispatch inspected; full enablement/CLI routing gates need review. |
| `remote-client` | needs-deeper-review | `packages/client/src/client.ts:62` | Request framing/decoder lifecycle inspected; attachment hydration/reconnection sequencing not fully traced. |
| `remote-server` | needs-deeper-review | `packages/server/src/server.ts:46` | Decoder and host wiring inspected; handshake/disposal/error matrix not fully traced. |
| `frame` | verified | `packages/protocol/src/codec.ts:56` | Owner and claimed surface behavior inspected in surrounding source. |
| `launcher` | needs-deeper-review | `packages/coding-agent/src/experimental/server.ts:145` | Activation owner inspected; lock contention/lease/process restart protocol not fully traced. |
| `coordinator` | corrected | `packages/coding-agent/src/experimental/coordinator.ts:43` | CoordinatorConnection owns server-side routing endpoint, not startup lease/coordinator spawning. Remaining: Endpoint owner clarified; peer replacement/router races need deeper review. |
| `workers` | needs-deeper-review | `packages/coding-agent/src/experimental/session-worker-manager.ts:95` | Spawn and metadata integration inspected; worker retirement/plugin-generation matching not fully traced. |
| `worker` | needs-deeper-review | `packages/coding-agent/src/experimental/session-worker.ts:739` | Harness and facet ownership inspected; process liveness/demand/cleanup contracts need deeper review. |
| `catalog-store` | verified | `packages/coding-agent/src/experimental/session-catalog.ts:58` | Owner and claimed surface behavior inspected in surrounding source. |
| `controller` | needs-deeper-review | `packages/coding-agent/src/experimental/services/agent-controller-provider.ts:18` | Root conversation submit/control owner inspected; every operation/error contract not fully traced. |
| `open-durable` | verified | `packages/coding-agent/src/experimental/durable/runtime.ts:124` | Owner and claimed surface behavior inspected in surrounding source. |
| `harness` | needs-deeper-review | `packages/durable/src/harness/harness.ts:164` | Scheduler/views/storage ownership inspected; commit publication and transactional kernel not fully traced. |
| `sqlite` | needs-deeper-review | `packages/durable/src/storage/sqlite/node.ts:205` | File-backed storage factory inspected; locking/transaction/crash guarantees need storage-layer review. |
| `conversation` | verified | `packages/durable/src/harness/harness.ts:82` | Owner and claimed surface behavior inspected in surrounding source. |
| `scheduler` | needs-deeper-review | `packages/durable/src/harness/scheduler.ts:174` | Scheduler responsibility inspected; task handover/recovery precedence not fully traced. |
| `generation` | needs-deeper-review | `packages/durable/src/harness/generation.ts:115` | Tool-round task creation/join inspected; generation partial checkpoints/recovery not fully traced. |
| `durable-tool` | needs-deeper-review | `packages/durable/src/harness/tool.ts:50` | Replay-policy owner inspected; each replay mode/recovery phase not fully traced. |
| `subagent` | verified | `packages/coding-agent/src/experimental/durable/subagent.ts:24` | Owner and claimed surface behavior inspected in surrounding source. |
| `view` | needs-deeper-review | `packages/durable/src/harness/view.ts:71` | Commit subscription ownership inspected; incremental projection/replay algorithm not fully traced. |
| `task-graph` | needs-deeper-review | `packages/durable/src/harness/task-graph.ts:62` | Commit-backed optional mount inspected; ownership/wait reduction algorithm not fully traced. |
| `facets` | needs-deeper-review | `packages/chord/src/facets/host.ts:340` | Dependency kernel owner inspected; reload compatibility/activation/rollback algorithm not fully traced. |
| `service-source` | needs-deeper-review | `packages/coding-agent/src/experimental/services/connection.ts:354` | Client binding owner inspected; attachment transitions/detached availability not fully traced. |
| `transcript-service` | verified | `packages/coding-agent/src/experimental/services/transcript-provider.ts:6` | Owner and claimed surface behavior inspected in surrounding source. |
| `replica` | needs-deeper-review | `packages/chord/src/services/state-codec.ts:99` | Decoder reset/snapshot/update ownership inspected; remote sequencing and dictionary correctness not fully traced. |
| `plugins` | needs-deeper-review | `packages/coding-agent/src/experimental/services/plugins.ts:12` | Serialized worker reload inspected; server and presentation generation matching need broader review. |

### Edges

| Item ID | Status | Evidence at pinned source | Rationale / remaining limit |
| --- | --- | --- | --- |
| `cli-mode-1` | corrected | `packages/coding-agent/src/main.ts:651` | Use actual caller rather than callee declaration. |
| `cli-initial-2` | corrected | `packages/coding-agent/src/main.ts:900` | Use actual caller rather than callee declaration. |
| `mode-tui-3` | verified | `packages/coding-agent/src/main.ts:951` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `mode-print-4` | verified | `packages/coding-agent/src/main.ts:985` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `mode-rpc-5` | verified | `packages/coding-agent/src/main.ts:949` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `rpc-client-rpc-6` | verified | `packages/coding-agent/src/modes/rpc/rpc-client.ts:94` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `cli-services-7` | verified | `packages/coding-agent/src/main.ts:749` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `services-model-runtime-8` | verified | `packages/coding-agent/src/core/agent-session-services.ts:142` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `services-settings-9` | verified | `packages/coding-agent/src/core/agent-session-services.ts:147` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `services-resources-10` | verified | `packages/coding-agent/src/core/agent-session-services.ts:154` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `services-sdk-11` | corrected | `packages/coding-agent/src/core/agent-session-services.ts:217` | Services value is input to adapter; creation is not called inside services constructor. |
| `cli-runtime-12` | verified | `packages/coding-agent/src/main.ts:862` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `sdk-manager-13` | corrected | `packages/coding-agent/src/core/sdk.ts:185` | Replace option-interface comment with actual manager selection. |
| `sdk-agent-14` | verified | `packages/coding-agent/src/core/sdk.ts:387` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `sdk-session-15` | verified | `packages/coding-agent/src/core/sdk.ts:437` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `runtime-session-16` | verified | `packages/coding-agent/src/core/agent-session-runtime.ts:90` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `runtime-replace-17` | verified | `packages/coding-agent/src/core/agent-session-runtime.ts:196` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `replace-shutdown-18` | verified | `packages/coding-agent/src/core/agent-session-runtime.ts:212` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `shutdown-abort-19` | verified | `packages/coding-agent/src/core/agent-session-runtime.ts:170` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `replace-services-20` | needs-deeper-review | `packages/coding-agent/src/core/agent-session-runtime.ts:214` | createRuntime is injected; default factory chain supports services but custom factories can differ. |
| `replace-fork-21` | verified | `packages/coding-agent/src/core/agent-session-runtime.ts:316` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `resources-settings-22` | corrected | `packages/coding-agent/src/core/resource-loader.ts:520` | Replace pre-trust bootstrap occurrence with final trusted-state reload. |
| `resources-packages-23` | verified | `packages/coding-agent/src/core/resource-loader.ts:521` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `resources-trust-24` | verified | `packages/coding-agent/src/core/resource-loader.ts:515` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `resources-extension-loader-25` | needs-deeper-review | `packages/coding-agent/src/core/resource-loader.ts:574` | loadFinalExtensionSet inspected at caller; cache/inline replacement helpers not fully traced. |
| `cli-builtin-ext-26` | verified | `packages/coding-agent/src/main.ts:575` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `resources-skills-27` | corrected | `packages/coding-agent/src/core/resource-loader.ts:592` | Replace resource-extension pass with reload caller. |
| `resources-templates-28` | corrected | `packages/coding-agent/src/core/resource-loader.ts:607` | Replace resource-extension pass with reload caller. |
| `resources-agents-files-29` | corrected | `packages/coding-agent/src/core/resource-loader.ts:637` | Context discovery uses noContextFiles; source does not gate instruction-text loading on project trust. |
| `tui-prompt-30` | corrected | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:1243` | Replace startup initial-input call with actual editor input owner. |
| `print-prompt-31` | verified | `packages/coding-agent/src/modes/print-mode.ts:132` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `rpc-prompt-32` | verified | `packages/coding-agent/src/modes/rpc/rpc-mode.ts:399` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `prompt-commands-33` | verified | `packages/coding-agent/src/core/agent-session.ts:1931` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `prompt-input-hooks-34` | verified | `packages/coding-agent/src/core/agent-session.ts:1946` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `input-hooks-runner-35` | verified | `packages/coding-agent/src/core/agent-session.ts:1880` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `prompt-skill-expand-36` | verified | `packages/coding-agent/src/core/agent-session.ts:1961` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `prompt-templates-37` | verified | `packages/coding-agent/src/core/agent-session.ts:1962` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `skill-expand-skills-38` | verified | `packages/coding-agent/src/core/agent-session.ts:2107` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `prompt-busy-39` | verified | `packages/coding-agent/src/core/agent-session.ts:1966` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `busy-steer-40` | verified | `packages/coding-agent/src/core/agent-session.ts:1975` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `busy-followup-41` | verified | `packages/coding-agent/src/core/agent-session.ts:1973` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `prompt-before-start-42` | verified | `packages/coding-agent/src/core/agent-session.ts:2015` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `before-start-images-43` | corrected | `packages/coding-agent/src/core/agent-session.ts:2028` | AgentSession.prompt owns both operations; hook does not directly call normalization. |
| `prompt-loadout-44` | corrected | `packages/coding-agent/src/core/agent-session.ts:2058` | Replace next-turn refresh occurrence with idle prompt caller. |
| `loadout-prompt-sections-45` | needs-deeper-review | `packages/coding-agent/src/core/agent-session.ts:1700` | Core section diff inspected; hidden loadout options from every hook remain open. |
| `prompt-sections-agents-files-46` | corrected | `packages/coding-agent/src/core/system-prompt.ts:164` | Replace option-interface declaration with actual rendering. |
| `prompt-sections-skills-47` | corrected | `packages/coding-agent/src/core/system-prompt.ts:167` | Skills prompt requires active read or bash and nonempty skill metadata. |
| `prompt-run-48` | verified | `packages/coding-agent/src/core/agent-session.ts:2063` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `run-agent-49` | verified | `packages/coding-agent/src/core/agent-session.ts:1785` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `agent-loop-50` | verified | `packages/agent/src/agent.ts:437` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `loop-refresh-51` | verified | `packages/agent/src/agent-loop.ts:186` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `loop-tool-delta-52` | verified | `packages/agent/src/agent-loop.ts:211` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `loop-projection-53` | verified | `packages/agent/src/agent-loop.ts:219` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `projection-context-54` | corrected | `packages/coding-agent/src/core/agent-session.ts:765` | Replace physical next-turn compaction helper with request projection caller. |
| `projection-route-55` | corrected | `packages/coding-agent/src/core/agent-session.ts:794` | Replace summary direct routing occurrence with agent request routing. |
| `route-route-state-56` | verified | `packages/coding-agent/src/core/agent-session.ts:804` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `projection-pressure-57` | verified | `packages/coding-agent/src/core/agent-session.ts:810` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `refresh-pressure-58` | verified | `packages/coding-agent/src/core/agent-session.ts:752` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `loop-stream-59` | verified | `packages/agent/src/agent-loop.ts:242` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `stream-transform-60` | verified | `packages/agent/src/agent-loop.ts:391` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `transform-runner-61` | verified | `packages/coding-agent/src/core/sdk.ts:415` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `stream-convert-62` | verified | `packages/agent/src/agent-loop.ts:395` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `stream-provider-stream-63` | verified | `packages/agent/src/agent-loop.ts:403` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `model-runtime-auth-64` | needs-deeper-review | `packages/coding-agent/src/core/model-runtime.ts:547` | Member getAuth surface; prepareRequest delegation/auth refresh chain needs review. |
| `model-runtime-catalog-65` | needs-deeper-review | `packages/coding-agent/src/core/model-runtime.ts:839` | Member refresh surface; provider refresh paths need review. |
| `provider-stream-adapters-66` | corrected | `packages/coding-agent/src/core/model-runtime.ts:738` | Anchor actual physical provider dispatch rather than virtual routing start. |
| `adapters-endpoint-67` | verified | `packages/ai/src/api/openai-responses.ts:184` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `adapters-provider-retry-68` | corrected | `packages/ai/src/api/openai-responses.ts:183` | Retry wrapper runs for initial request too; only repeated attempts require retryable failure/budget. |
| `sdk-provider-hooks-69` | verified | `packages/coding-agent/src/core/sdk.ts:408` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `provider-hooks-runner-70` | verified | `packages/coding-agent/src/core/sdk.ts:361` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `stream-stop-71` | verified | `packages/agent/src/agent-loop.ts:245` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `stream-dispatch-72` | verified | `packages/agent/src/agent-loop.ts:270` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `stream-truncated-73` | verified | `packages/agent/src/agent-loop.ts:269` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `dispatch-prepare-tool-74` | verified | `packages/agent/src/agent-loop.ts:549` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `prepare-tool-tool-hook-75` | verified | `packages/agent/src/agent-loop.ts:728` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `tool-hook-runner-76` | verified | `packages/coding-agent/src/core/agent-session.ts:640` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `dispatch-execute-tool-77` | verified | `packages/agent/src/agent-loop.ts:558` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `execute-tool-tool-result-78` | corrected | `packages/agent/src/agent-loop.ts:864` | Dispatcher/runToolCall performs finalization after execute helper returns. |
| `tool-result-runner-79` | verified | `packages/coding-agent/src/core/agent-session.ts:662` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `session-read-80` | verified | `packages/coding-agent/src/core/tools/index.ts:121` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `read-filesystem-81` | verified | `packages/coding-agent/src/core/tools/read.ts:81` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `session-bash-82` | verified | `packages/coding-agent/src/core/tools/index.ts:123` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `bash-filesystem-83` | verified | `packages/coding-agent/src/core/tools/bash.ts:261` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `session-edit-84` | verified | `packages/coding-agent/src/core/tools/index.ts:127` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `edit-filesystem-85` | verified | `packages/coding-agent/src/core/tools/edit.ts:159` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `session-write-86` | verified | `packages/coding-agent/src/core/tools/index.ts:129` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `write-filesystem-87` | verified | `packages/coding-agent/src/core/tools/write.ts:58` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `session-search-88` | verified | `packages/coding-agent/src/core/tools/index.ts:131` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `search-filesystem-89` | verified | `packages/coding-agent/src/core/tools/grep.ts:81` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `edit-mutation-90` | verified | `packages/coding-agent/src/core/tools/edit.ts:163` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `builtin-ext-mcp-ext-91` | verified | `packages/coding-agent/src/extensions/index.ts:13` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `builtin-ext-codemode-92` | verified | `packages/coding-agent/src/extensions/codemode/index.ts:34` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `mcp-ext-mcp-conn-93` | verified | `packages/coding-agent/src/extensions/mcp/index.ts:521` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `mcp-conn-mcp-transport-94` | corrected | `packages/coding-agent/src/extensions/mcp/runtime.ts:383` | Replace transport factory declaration with connection caller. |
| `mcp-transport-mcp-server-95` | verified | `packages/coding-agent/src/extensions/mcp/runtime.ts:104` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `mcp-ext-mcp-resources-96` | verified | `packages/coding-agent/src/extensions/mcp/index.ts:446` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `mcp-ext-loadout-97` | verified | `packages/coding-agent/src/extensions/mcp/index.ts:403` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `tool-search-loadout-98` | verified | `packages/coding-agent/src/extensions/tool-search/tool.ts:209` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `codemode-sandbox-99` | verified | `packages/coding-agent/src/extensions/codemode/tool.ts:383` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `sandbox-nested-100` | verified | `packages/coding-agent/src/extensions/codemode/execute.ts:363` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `nested-prepare-tool-101` | needs-deeper-review | `packages/coding-agent/src/core/agent-session.ts:720` | Host callback wiring inspected; runner invocation/queue lifecycle not fully traced. |
| `nested-mcp-conn-102` | corrected | `packages/coding-agent/src/extensions/mcp/tools.ts:314` | Replace generic script catalogue construction with MCP-backed execution. |
| `sandbox-script-store-103` | verified | `packages/coding-agent/src/extensions/codemode/execute.ts:393` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `sandbox-manager-104` | needs-deeper-review | `packages/coding-agent/src/extensions/codemode/execute.ts:409` | Successful append callback inspected; extension append scheduling chain not fully traced. |
| `agent-event-persist-105` | verified | `packages/coding-agent/src/core/agent-session.ts:485` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `event-persist-manager-106` | verified | `packages/coding-agent/src/core/agent-session.ts:1133` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `event-persist-events-107` | verified | `packages/coding-agent/src/core/agent-session.ts:1112` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `event-persist-runner-108` | verified | `packages/coding-agent/src/core/agent-session.ts:1111` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `manager-jsonl-109` | verified | `packages/coding-agent/src/core/session-manager.ts:1195` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `manager-branch-110` | verified | `packages/coding-agent/src/core/session-manager.ts:1469` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `branch-context-111` | verified | `packages/coding-agent/src/core/session-manager.ts:543` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `context-edit-context-112` | verified | `packages/coding-agent/src/core/session-manager.ts:519` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `tree-branch-113` | verified | `packages/coding-agent/src/core/agent-session.ts:4079` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `tree-branch-summary-114` | verified | `packages/coding-agent/src/core/agent-session.ts:4011` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `tree-context-115` | corrected | `packages/coding-agent/src/core/agent-session.ts:4088` | Replace method declaration with actual post-navigation refresh. |
| `manager-fork-116` | verified | `packages/coding-agent/src/core/session-manager.ts:1632` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `session-export-117` | verified | `packages/coding-agent/src/core/agent-session.ts:4239` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `pressure-auto-118` | verified | `packages/coding-agent/src/core/agent-session.ts:755` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `manual-prepare-summary-119` | verified | `packages/coding-agent/src/core/agent-session.ts:2733` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `auto-prepare-summary-120` | verified | `packages/coding-agent/src/core/agent-session.ts:3064` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `auto-runner-121` | verified | `packages/coding-agent/src/core/agent-session.ts:3079` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `auto-summarize-122` | verified | `packages/coding-agent/src/core/agent-session.ts:3115` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `manual-summarize-123` | corrected | `packages/coding-agent/src/core/agent-session.ts:2782` | Extension-supplied compaction skips default generation. |
| `summarize-provider-stream-124` | verified | `packages/coding-agent/src/core/compaction/compaction.ts:636` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `auto-compact-entry-125` | verified | `packages/coding-agent/src/core/agent-session.ts:3130` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `compact-entry-context-126` | corrected | `packages/coding-agent/src/core/session-manager.ts:481` | Replace legacy migration branch with current compaction-aware projection. |
| `run-auto-retry-127` | verified | `packages/coding-agent/src/core/agent-session.ts:1817` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `run-overflow-128` | verified | `packages/coding-agent/src/core/agent-session.ts:1837` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `overflow-omit-129` | verified | `packages/coding-agent/src/core/agent-session.ts:2996` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `omit-context-edit-130` | corrected | `packages/coding-agent/src/core/agent-session.ts:1219` | Replace boundary-draft edit occurrence with recovery omission caller. |
| `overflow-auto-131` | verified | `packages/coding-agent/src/core/agent-session.ts:2997` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `auto-retry-agent-132` | verified | `packages/coding-agent/src/core/agent-session.ts:1789` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `loop-turn-decision-133` | corrected | `packages/agent/src/agent-loop.ts:286` | Anchor successful turn decision; failed branch ignores decision and exits. |
| `turn-decision-boundary-134` | corrected | `packages/coding-agent/src/core/agent-session.ts:862` | Anchor actual wrapper call rather than installer declaration. |
| `loop-steer-135` | verified | `packages/agent/src/agent-loop.ts:176` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `loop-followup-136` | verified | `packages/agent/src/agent-loop.ts:302` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `run-settle-137` | verified | `packages/coding-agent/src/core/agent-session.ts:1792` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `settle-loop-138` | corrected | `packages/coding-agent/src/core/agent-session.ts:1794` | Replace post-run retry continuation with before-settle continuation. |
| `session-reload-139` | verified | `packages/coding-agent/src/core/agent-session.ts:3612` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `reload-resources-140` | verified | `packages/coding-agent/src/core/agent-session.ts:3623` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `session-usage-141` | verified | `packages/coding-agent/src/core/agent-session.ts:4134` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `sdk-cache-142` | verified | `packages/coding-agent/src/core/sdk.ts:404` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `cache-manager-143` | verified | `packages/coding-agent/src/core/cache-warmer.ts:342` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `rpc-output-144` | verified | `packages/coding-agent/src/modes/rpc/rpc-mode.ts:61` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `experimental-launcher-145` | needs-deeper-review | `packages/coding-agent/src/experimental/server.ts:145` | Activation helper exists; complete experimental command-to-helper chain not fully traced. |
| `launcher-coordinator-146` | needs-deeper-review | `packages/coding-agent/src/experimental/server.ts:586` | Server startup uses ensureCoordinator; launch-to-server process chain summarized. |
| `launcher-remote-client-147` | needs-deeper-review | `packages/coding-agent/src/experimental/server.ts:221` | connectServer helper inspected; all activateServer reconnect branches not fully traced. |
| `remote-client-frame-148` | corrected | `packages/client/src/client.ts:290` | Replace cancel-frame occurrence with request frame encoding. |
| `frame-remote-server-149` | corrected | `packages/server/src/server.ts:156` | Replace import statement with decoder instance. |
| `remote-server-workers-150` | needs-deeper-review | `packages/coding-agent/src/experimental/server.ts:589` | Worker constructor/host wiring inspected; attachment routing implementation needs deeper review. |
| `workers-worker-151` | verified | `packages/coding-agent/src/experimental/session-worker-manager.ts:465` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `workers-catalog-store-152` | corrected | `packages/coding-agent/src/experimental/server.ts:391` | Server host owns metadata lookup; no direct worker→catalogue call is established. Remaining: Actual server host owns metadata lookup; relationship is host integration, not direct worker method call. |
| `worker-harness-153` | verified | `packages/coding-agent/src/experimental/session-worker.ts:784` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `worker-facets-154` | corrected | `packages/coding-agent/src/experimental/services/worker.ts:82` | Replace import with actual facet construction. |
| `facets-controller-155` | corrected | `packages/coding-agent/src/experimental/services/worker.ts:62` | Replace type import with service registration. |
| `controller-conversation-156` | verified | `packages/coding-agent/src/experimental/services/agent-controller-provider.ts:25` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `facets-transcript-service-157` | verified | `packages/coding-agent/src/experimental/services/transcript-provider.ts:6` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `transcript-service-view-158` | verified | `packages/coding-agent/src/experimental/services/transcript-provider.ts:7` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `service-source-remote-client-159` | verified | `packages/coding-agent/src/experimental/services/connection.ts:111` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `remote-client-replica-160` | verified | `packages/client/src/client.ts:183` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `plugins-facets-161` | corrected | `packages/coding-agent/src/experimental/services/worker.ts:96` | Replace interface declaration with serialized worker reload implementation. |
| `open-durable-sqlite-162` | verified | `packages/coding-agent/src/experimental/durable/runtime.ts:139` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `open-durable-harness-163` | verified | `packages/coding-agent/src/experimental/durable/runtime.ts:138` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `open-durable-subagent-164` | verified | `packages/coding-agent/src/experimental/durable/runtime.ts:134` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `harness-conversation-165` | verified | `packages/durable/src/harness/harness.ts:314` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `harness-scheduler-166` | verified | `packages/durable/src/harness/harness.ts:181` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `scheduler-generation-167` | needs-deeper-review | `packages/durable/src/harness/registry.ts:10` | Registry declares builtin generation tasks; complete scheduler resolve/invoke chain not audited. |
| `generation-durable-tool-168` | corrected | `packages/durable/src/harness/generation.ts:578` | Replace checkpoint type field with actual task creation. |
| `harness-view-169` | verified | `packages/durable/src/harness/harness.ts:206` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `harness-task-graph-170` | verified | `packages/durable/src/harness/harness.ts:200` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `harness-sqlite-171` | needs-deeper-review | `packages/coding-agent/src/experimental/durable/runtime.ts:139` | Demo passes SQLite factory; transactional guarantee belongs to storage/kernel implementation. |
| `subagent-conversation-172` | corrected | `packages/coding-agent/src/experimental/durable/subagent.ts:39` | Edge includes reuse as well as creation, so old no-child condition excluded a valid path. |
| `subagent-conversation-173` | verified | `packages/coding-agent/src/experimental/durable/subagent.ts:46` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `execute-tool-read-174` | verified | `packages/agent/src/agent-loop.ts:829` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `execute-tool-bash-175` | verified | `packages/agent/src/agent-loop.ts:829` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `execute-tool-edit-176` | verified | `packages/agent/src/agent-loop.ts:829` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `execute-tool-write-177` | verified | `packages/agent/src/agent-loop.ts:829` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `execute-tool-search-178` | verified | `packages/agent/src/agent-loop.ts:829` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `execute-tool-codemode-179` | verified | `packages/agent/src/agent-loop.ts:829` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `execute-tool-mcp-conn-180` | verified | `packages/agent/src/agent-loop.ts:829` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `tool-result-loop-181` | corrected | `packages/agent/src/agent-loop.ts:275` | Appending occurs regardless of termination; continuation also constrained by finishTurn end. |
| `truncated-loop-182` | corrected | `packages/agent/src/agent-loop.ts:269` | finishTurn can stop rather than guarantee next corrective generation. |
| `steer-loop-183` | verified | `packages/agent/src/agent-loop.ts:205` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `followup-loop-184` | verified | `packages/agent/src/agent-loop.ts:306` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `auto-retry-omit-185` | verified | `packages/coding-agent/src/core/agent-session.ts:3738` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `write-mutation-186` | verified | `packages/coding-agent/src/core/tools/write.ts:67` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `session-read-187` | verified | `packages/coding-agent/src/core/agent-session.ts:3573` | Cited owner/caller or data boundary inspected; relationship matches stated condition. |
| `auto-agent-188` | needs-deeper-review | `packages/coding-agent/src/core/agent-session.ts:3160` | Return-to-post-run continuation inspected; all pre-request/post-run caller combinations not fully traced. |

### Traces

| Item ID | Status | Evidence at pinned source | Rationale / remaining limit |
| --- | --- | --- | --- |
| `answer` | corrected | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:447`; `packages/coding-agent/src/core/agent-session.ts:1921`; `packages/coding-agent/src/core/agent-session.ts:2015`; `packages/coding-agent/src/core/agent-session.ts:1890`; `packages/coding-agent/src/core/agent-session.ts:1689`; `packages/coding-agent/src/core/agent-session.ts:1775`; `packages/agent/src/agent.ts:188`; `packages/coding-agent/src/core/agent-session.ts:1074`; `packages/agent/src/agent-loop.ts:163`; `packages/coding-agent/src/core/agent-session.ts:759`; `packages/agent/src/agent-loop.ts:381`; `packages/coding-agent/src/core/model-runtime.ts:715`; `packages/agent/src/agent-loop.ts:286`; `packages/coding-agent/src/core/agent-session.ts:1846` | Move initial finalized message persistence before runLoop; runAgentLoop owns those events. |
| `tools` | verified | `packages/coding-agent/src/core/agent-session.ts:1921`; `packages/coding-agent/src/core/agent-session.ts:1775`; `packages/agent/src/agent-loop.ts:163`; `packages/coding-agent/src/core/agent-session.ts:759`; `packages/agent/src/agent-loop.ts:381`; `packages/coding-agent/src/core/agent-session.ts:1074`; `packages/agent/src/agent-loop.ts:508`; `packages/agent/src/agent-loop.ts:707`; `packages/coding-agent/src/core/agent-session.ts:630`; `packages/agent/src/agent-loop.ts:820`; `packages/coding-agent/src/core/tools/read.ts:201`; `packages/coding-agent/src/core/agent-session.ts:656`; `packages/agent/src/agent-loop.ts:286`; `packages/coding-agent/src/core/agent-session.ts:870`; `packages/coding-agent/src/core/agent-session.ts:1846` | Selected assumed path reconciled with message events, loop boundaries and recovery ordering. |
| `steering` | corrected | `packages/coding-agent/src/core/agent-session.ts:1921`; `packages/coding-agent/src/core/agent-session.ts:1870`; `packages/coding-agent/src/core/agent-session.ts:1966`; `packages/agent/src/agent.ts:299`; `packages/agent/src/agent-loop.ts:381`; `packages/agent/src/agent-loop.ts:286`; `packages/agent/src/agent-loop.ts:163`; `packages/coding-agent/src/core/agent-session.ts:870`; `packages/coding-agent/src/core/agent-session.ts:1074`; `packages/coding-agent/src/core/agent-session.ts:759`; `packages/agent/src/agent.ts:304`; `packages/coding-agent/src/core/agent-session.ts:1846` | Show follow-up arrival as concurrent with generation rather than implying queueing only after completion. |
| `recovery` | verified | `packages/agent/src/agent-loop.ts:381`; `packages/coding-agent/src/core/agent-session.ts:1074`; `packages/agent/src/agent-loop.ts:245`; `packages/coding-agent/src/core/agent-session.ts:1775`; `packages/coding-agent/src/core/agent-session.ts:2900`; `packages/coding-agent/src/core/agent-session.ts:1208`; `packages/coding-agent/src/core/session-manager.ts:1360`; `packages/coding-agent/src/core/agent-session.ts:3050`; `packages/coding-agent/src/core/compaction/compaction.ts:872`; `packages/coding-agent/src/core/extensions/runner.ts:356`; `packages/coding-agent/src/core/compaction/compaction.ts:965`; `packages/coding-agent/src/core/session-manager.ts:1261`; `packages/coding-agent/src/core/session-manager.ts:543`; `packages/agent/src/agent.ts:188`; `packages/coding-agent/src/core/agent-session.ts:759`; `packages/coding-agent/src/core/agent-session.ts:1846` | Selected assumed path reconciled with message events, loop boundaries and recovery ordering. |
| `script` | corrected | `packages/agent/src/agent-loop.ts:381`; `packages/coding-agent/src/core/agent-session.ts:1074`; `packages/agent/src/agent-loop.ts:707`; `packages/coding-agent/src/extensions/codemode/tool.ts:365`; `packages/coding-agent/src/extensions/codemode/execute.ts:320`; `packages/coding-agent/src/extensions/codemode/execute.ts:220`; `packages/coding-agent/src/core/nested-tool-calls.ts:160`; `packages/coding-agent/src/core/agent-session.ts:630`; `packages/coding-agent/src/extensions/mcp/runtime.ts:155`; `packages/coding-agent/src/extensions/mcp/runtime.ts:56`; `packages/coding-agent/src/core/agent-session.ts:656`; `packages/coding-agent/src/core/agent-session.ts:870`; `packages/coding-agent/src/core/agent-session.ts:1846` | Clarify conditional store persistence and nontransactional external tool effects. Remaining: Outer script path and shared hook wiring inspected; nested runner queue/cancellation and MCP protocol internals remain open. |
| `durable-subagent` | needs-deeper-review | `packages/coding-agent/src/experimental/durable/runtime.ts:124`; `packages/durable/src/storage/sqlite/node.ts:205`; `packages/durable/src/harness/harness.ts:164`; `packages/durable/src/harness/harness.ts:82`; `packages/durable/src/harness/scheduler.ts:174`; `packages/durable/src/harness/generation.ts:115`; `packages/durable/src/harness/tool.ts:50`; `packages/coding-agent/src/experimental/durable/subagent.ts:24`; `packages/durable/src/harness/view.ts:71`; `packages/durable/src/harness/task-graph.ts:62` | Subagent child reuse/requestId and generation tool-task creation inspected; full durable scheduler/restart behavior is not yet established. |

## Validation

Every graph ID is listed above once per category. Graph references and source-anchor bounds were checked statically after edits. No runtime behavior, provider integration, crash recovery or test suite was executed. Remaining-review items explicitly constrain what this audit establishes.
