# Pi system explorer: pinned source study

## Purpose and evidence

This study supports the Studio Pi component map. It describes the local
`earendil-works/pi` checkout at commit
`a276dabe57911253350bffb93cb7d7aff6a73261`, inspected on 2026-10-04. It is a
source study, not an experiment or a record of executing Pi. No provider,
filesystem tool, MCP server, or experimental runtime was invoked.

The repository identity matters: this checkout contains substantially more than
the older Pi coding-agent/agent-core split. It includes a separate durable
harness, Chord facets/services, client/server/protocol packages, and built-in
codemode/MCP integration. Those capabilities have different entry points and
must not be flattened into the ordinary coding-agent loop.

The executable teaching data is
[`pi.ts`](../../../apps/web/src/features/system-explorer/data/pi.ts): 132 nodes,
188 relationships, 16 regions, and six illustrative traces. Every node and edge
has a file/line anchor into the pinned checkout. Group names and visual placement
are editorial; classes/functions, state ownership, conditions and call relations
come from the source. An edge may summarize a helper chain in the linked owner.

## Coverage

| Region | What the surface map exposes |
| --- | --- |
| CLI and application modes | `main`, TTY/flag dispatch, initial input, interactive, print/JSON, stable JSONL RPC and `RpcClient` |
| Session runtime | SDK factory, cwd-bound services, `AgentSession`, replacement, outgoing-work settlement and host rebinding |
| Settings and resources | Trust-aware global/project settings, packages, instructions, skills, templates, extension factories and builtin registration |
| Input | Immediate slash commands, interception, expansion, busy-input choice, queues, before-start hooks and image processing |
| Agent core | Mutable state, nested turn/follow-up loops, next-turn refresh, continuation decisions, error/abort exit |
| Request | Canonical branch projection, virtual routing/state, structured prompt/tool changes, hidden/forced request projections, LLM conversion |
| Providers | Model catalogue/runtime, credentials, API adapter boundary, provider hooks and request retry |
| Tools | Batch policy, truncated-call rejection, lookup/schema preparation, blocking/result hooks, builtin operations and file mutation queue |
| Integrations | MCP connection/transports/resources, direct/deferred/script exposure, BM25 discovery, QuickJS and shared nested call pipeline |
| History | JSONL entry tree, active leaf, projected context, context edits, navigation, fork and export |
| Compaction/recovery | Size threshold, manual/automatic preparation, summary, committed boundary, overflow omission/retry and branch summary |
| Extensions/settlement | Ordered extension dispatch, persisted turn boundaries, before-settle continuation, settled activity and reload |
| Presentation | Public events, usage, cache warming, stdout protection, crash diagnostics and install telemetry preference |
| Experimental remote | Source-only client/server entry, framed protocol, Unix activation/coordinator, worker lifecycle and catalogue |
| Experimental durable | SQLite Harness, conversations, submissions/tasks, streamed generation, tool replay, foreground subagent and views |
| Chord | Facet dependency/activation/reload, generated remote service sources, transcript replication and plugin contracts |

## Stable coding-agent lifecycle

The main CLI chooses RPC/JSON explicitly, print for `--print` or non-TTY streams,
and interactive otherwise. These hosts share a replaceable `AgentSessionRuntime`.
The SDK can construct `AgentSession` directly. CLI builtin factories are supplied
by `main`; a minimal SDK resource loader does not automatically imply the same
builtin integration factories.

`createAgentSessionServices` binds resources/settings to the effective cwd and
registers extension-provided providers and virtual models before model selection.
`createAgentSession` restores projected branch messages, selection and thinking
metadata; it constructs `Agent` and the higher-level `AgentSession`.

An idle prompt passes through command/input handling, skill/template expansion,
model/auth checks, pre-prompt compaction checks and before-agent-start handlers.
Image normalization follows those handlers so model changes affect image limits.
Only then are user/custom messages and prompt-section deltas constructed.

The low-level loop emits finalized initial message events before preparing its
request. `AgentSession` subscribes to these events for extension dispatch, public
notifications and persistence. Each request uses a projection rebuilt from the
session branch, not an assumed unmodified in-memory list.

Sources: [CLI dispatch](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/main.ts),
[SDK construction](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/sdk.ts),
[coding session](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/agent-session.ts).

## Loop, branches and tool calls

`runLoop` has an inner tool/steering loop and an outer follow-up loop. Steering
is polled at turn boundaries, including after long next-turn preparation.
Follow-ups enter when the inner loop would otherwise stop. An explicit finish
decision of `end` exits immediately. A `continue` decision produces a context-only
turn when no natural tool, steering or follow-up work takes that continuation.

An error or aborted assistant response exits the low-level run before tool
execution. `AgentSession` can subsequently auto-retry eligible errors. A
length-stopped assistant with tool calls fails all those calls without execution
because salvaged arguments might be incomplete.

Normal tool batches are sequential if configured or if any selected tool declares
sequential execution; otherwise preparation occurs before parallel invocation.
Unknown tools, invalid arguments, blocked calls and tool exceptions produce error
results. Direct and nested calls share validation and interception. Tool-call hooks
can implement permission decisions; there is no invented universal approval node.
Image normalization also applies after result hooks.

Sources: [agent loop and tool pipeline](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/agent/src/agent-loop.ts),
[nested call runner](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/nested-tool-calls.ts).

## Transcript, projection and request boundaries

The stable `SessionManager` stores an entry tree connected by parent IDs. The
current leaf chooses one branch; navigation preserves the other entries. A
projection interprets compaction boundaries and context replacement/omission
records into request messages while retaining source-entry links.

System prompt sections and tool additions/removals are transcript messages.
Executable tool implementations remain in the runtime. Request transforms can
hide declarations or collapse a forced prompt at the head without replacing the
recorded structured prompt history. Optional virtual routing chooses a physical
model per request and persists routing state on the branch. Provider response
metadata names the physical model while model-change entries can retain the
virtual selection.

`message_end` persists finalized messages. Stable JSONL does not commit every
partial stream chunk. A new file is created when a user or assistant message
exists; setup-only entries stay in memory. Writes are synchronous append/file
operations, without a claim of crash-safe task replay or exactly-once tool effects.

Sources: [session tree/projection/persistence](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/session-manager.ts),
[structured prompt sections](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/system-prompt.ts),
[model runtime](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/model-runtime.ts).

## Compaction and retry are separate paths

Threshold compaction can happen before another assistant response; virtual-model
requests check the routed physical model's limits. Post-run overflow recovery
checks same-model conditions, projection membership and stale pre-compaction
usage. It persists omissions of the failed selected response/result attempt,
then compacts and optionally continues. Only one compact-and-retry overflow
attempt is admitted before reporting failed recovery.

Manual and automatic compaction both prepare retained history and permit
extension cancellation or a replacement summary. Default summary generation
uses a separate model request. Successful results append a compaction entry and
refresh the projection. Failed/cancelled generation does not create a successful
summary boundary. Successful automatic compaction can also continue queued work.

Provider request retry, session-level assistant-error retry and summary-call
retry are distinct mechanisms. Request retries are budget-dependent; the helper
does not imply every provider request retries by default. Session retries retain
the failed raw-history entry while durably omitting it from model projection and
waiting with abortable exponential backoff.

Sources: [compaction preparation/generation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/core/compaction/compaction.ts),
[request retry](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/ai/src/utils/provider-retry.ts).

## Builtin integration defaults

Codemode and tool-search are registered inactive. Explicit tool selection,
settings or `setActiveTools` can activate them. Configured MCP servers normally
expose tools to codemode and activate it unless auto-enablement is disabled.
Deferred MCP exposure activates tool-search instead. Direct tools are declared
immediately; hidden tools are unreachable. Single-tool overrides can change this.

MCP connects in background. The first prompt waits, with a bound, for direct
servers; scripts/search/resource operations wait for needed indirect servers on
demand. OAuth, expired-session recovery, reconnect and transport errors belong
to `McpServerConnection` and the MCP package boundary.

Codemode runs in a lazy QuickJS worker with exposed tool proxies. Nested calls
share tool validation/permissions. Their results reach the script; the outer tool
result contains nested records/usage. Successful store writes are custom branch
entries. Failed scripts keep partial output but do not commit successful store
writes; unfinished nested calls are cancelled as the script ends.

Sources: [MCP extension](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/extensions/mcp/index.ts),
[codemode activation](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/extensions/codemode/index.ts),
[script execution](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/extensions/codemode/execute.ts).

## Experimental architecture has a separate root

The experimental local durable demo opens `Harness` with SQLite storage, coding
registry/settings/environments and a foreground `Subagent` extension. Durable
conversations, submissions, generation/tool tasks, checkpoints, live documents,
views and task ownership replace the stable AgentSession/JSONL mechanism here.
Tool replay policy still matters; transactional state does not make all external
effects exactly once.

A durable subagent tool reuses or creates the child owned by its task and submits
with a task-derived request ID. The child inherits agent configuration, has no
parent transcript, and loses the Subagent extension to prevent further delegation.
The tool waits for child answer text; the child can remain available afterward.

Experimental remote services use a separate client/server/framed protocol.
Workers own durable sessions and active facet generations. Chord builds service
catalogues from provided tokens and validates dependencies before activation.
`Transcript` serves `Conversation.viewState` directly. Client replicas own state
hydration/operation decoding, avoiding a second hand-written transcript reducer.

The current remote controller exposes the root conversation. Its source notes
explicitly defer subagent service instances, older-history paging and stable-style
tree navigation. These are limitations, not missing edges filled with invented
capabilities.

Sources: [durable runtime](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/experimental/durable/runtime.ts),
[foreground subagent](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/experimental/durable/subagent.ts),
[experimental service boundaries](https://github.com/earendil-works/pi/blob/a276dabe57911253350bffb93cb7d7aff6a73261/packages/coding-agent/src/experimental/services/README.md).

## Trace assumptions and follow-up learning

The six traces cover ordinary completion, a builtin read round, queued steering
and follow-up, overflow recovery, codemode with a nested MCP tool, and an alternate
durable foreground subagent. Each trace states its assumed branch outcomes.
They are selected teaching paths through a component map; their steps are not
observed logs or an executable state machine.

Per-node work should follow the linked owner and callers, inspect alternative
conditions, then expand that node with focused state/data views. Particularly
valuable next studies are request projection versus raw history, finish-boundary
continuation, loadout exposure/activation, recovery omission ordering, and the
stable/durable persistence distinction.

## Validation and limits

Source-anchor generation checked every referenced file and needle against the
pinned local checkout. Node IDs, edge endpoints and trace node references were
checked for consistency. An independent source review corrected continuation
precedence, builtin tool activation defaults and automatic-compaction anchors.
This is static evidence checking, without running Pi tests or providers.

This map does not enumerate every provider implementation, MCP wire operation,
terminal widget, packaging/install/updater operation, eval runner or example
extension. Provider/MCP internals appear as expandable boundaries, and alternate
vacation/demo paths are not presented as ordinary agent execution. The research
map preserves framework-specific behavior and does not normalize it into a
shared harness contract or assert benchmark results.

## Item-level audit

The [semantic audit ledger](audits/pi.md) records corrections and unresolved
subsystem details. Manual compaction first aborts/settles active agent work.
`reload()` has no equivalent abort guarantee: the interactive host refuses busy
reload, while SDK callers own that guard. Parallel tool preparation is serial,
execution concurrent, and result-message publication follows emission order
after joining. Steering/follow-up queues remain volatile until admitted into
the transcript. Successful compaction preserves the system-message checkpoint.
