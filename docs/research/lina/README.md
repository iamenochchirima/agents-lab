# Lina design document

The [Lina input architecture](input-design.md) is the single working document for
input decisions, proposed control behavior, open questions, and source references.
It accompanies the architecture workspace at `/studio/lina`.

Supporting research and review:

- [Execution Environment research and node proposal](environment-research.md)
  covers local-first workspace execution, configurable sandboxes, process sessions,
  subagent leases, artifact custody and recovery. Supporting studies compare
  [Hermes/OpenClaw](environment-hermes-openclaw.md),
  [backend capabilities, Pi and Waku](environment-backends-and-patterns.md),
  and [existing Lina integration](environment-existing-design-audit.md).
  The twelve-node Environment block is implemented in Studio with JSON contracts
  and deterministic simulation; live backend adapters remain outside this slice.

- [Subagents architecture proposal](subagents-research.md) rechecks current agent
  implementations and proposes eight lifecycle nodes. Supporting reports cover
  [Hermes/OpenClaw](subagents-hermes-openclaw.md),
  [Pi/Waku](subagents-pi-waku.md),
  [established patterns and experiments](subagents-patterns-and-evaluation.md),
  and [current Lina integration gaps](subagents-existing-design-audit.md).
  The accepted Subagents graph and fixture simulation are implemented; see the
  completed slice and limitations in the Subagents section below.

- [Input mechanism alternatives](input-mechanism-experiments.md) identifies
  small variation points, primary-source evidence, proposed experiments, and
  the correctness contracts needed before measuring performance.
- [Input architecture audit](input-architecture-audit.md) reviews the maintained
  decisions, map, and walkthroughs at `e3e3b44`, separates diagram findings from
  open decisions, and records verification limits.

These reports propose questions and repairs. They do not change the agreed
Input decisions or establish measured performance improvements.

Turn execution research, before the next block is finalized:

- [Comparative architecture research](turn-execution-research.md) compares
  ownership, model/tool rounds, controls, waiting and settlement, and proposes
  a responsibility boundary and mechanism experiments.
- Source studies: [Hermes](turn-execution-hermes.md),
  [OpenClaw](turn-execution-openclaw.md), [Pi](turn-execution-pi.md),
  and [Waku](turn-execution-waku.md). These use the explorer revisions,
  distinguish static evidence from inference, and record what remains unverified.

The comparative studies retain their pinned observations. The research summary
and completeness audit also record the 2026-10-07 Lina design clarification:
bounded parallel execution of independent calls is required, with ordered
conflict/dependency handling and a batch join. The populated-block revisit now illustrates
concurrent calls through deterministic design playback. Correctness requirements are separate from policy experiments.

- [Turn Execution completeness audit](turn-execution-completeness-audit.md)
  checks essential agent-loop and tool-lifecycle contracts against the pinned
  sources, records graph repairs, and distinguishes future Tools internals
  from the three currently simulated paths.

- [Node contracts and reference examples](node-contracts.md): precise provisional input/output contracts, multiple input forms and corrected handoffs.

Context research for the next block:

- [Context architecture and experiment direction](context-research.md): proposed
  nodes, Turn Execution handoffs, reduction/failure paths, subagent reuse and
  controlled mechanism comparisons.
- Pinned source studies: [Hermes and OpenClaw](context-hermes-openclaw.md),
  [Pi and Waku](context-pi-waku.md).

These notes record Context proposals and source evidence. The initial graph and
scripted playback are documented in the
[Context implementation checklist](../../../development/implementation-plans/studio/completed/lina-context-block.md).


Tools, connections, plugins and skills research:

- [Architecture and implementation direction](tools-architecture-research.md):
  capability setup and execution lanes, owner boundaries, proposed adapters,
  authentication lifecycles, JSON records, baseline requirements and experiments.
- [MCP and connector standards](tools-connections-standards.md): current and legacy
  protocol eras, OAuth/PKCE, provider credentials, discovery and skill activation.
- Source studies: [Hermes and OpenClaw](tools-hermes-openclaw.md),
  [Pi and Waku](tools-pi-waku.md).
- [Existing runtime audit](tools-existing-runtime-audit.md): reusable capability
  modules, fixture boundaries and gaps before real Lina implementation.

These are research findings and architecture proposals. They do not implement
connection management, external sign-in, plugin loading or real tool execution.

The initial Tools graph and provisional node contracts are documented in the
[completed node setup checklist](../../../development/implementation-plans/studio/completed/lina-tools-nodes.md).
Real authentication and adapters remain unimplemented; concurrent design playback
is now available.

Whole-architecture revisit after Tools expansion:

- [Consolidated proposal and checklist](../../../development/implementation-plans/studio/active/lina-cross-block-revisit.md)
- Supporting audits: [Input and Turn Execution](revisit-input-execution.md),
  [Context](revisit-context.md), [Tools](revisit-tools.md), and
  [remaining blocks and Subagents](revisit-planned-blocks.md).

These specify proposed nodes, contracts, cross-block routes and scripted cases.
The approved populated-block slice is now applied to the graph and simulation.
Remaining blocks and runtime capabilities are pending. See the
[implementation checklist](../../../development/implementation-plans/studio/completed/lina-current-block-revisit.md).

Model Interface research and implemented graph slice:

- [Architecture synthesis and current Lina audit](model-interface-research.md).
- [Official provider protocols](model-provider-protocols.md),
  [Hermes/OpenClaw source study](model-hermes-openclaw.md), and
  [Pi/Waku source study](model-pi-waku.md).
- [Implementation checklist](../../../development/implementation-plans/studio/completed/lina-model-interface.md).
- [Reference JSON schemas/examples](../../../development/implementation-plans/studio/completed/lina-model-interface.contract-fixtures.json),
  separate from the maintained inspector registry and fake protocol engine.

Four Model nodes now connect metadata preparation, encoding, simulated invocation
and terminal normalization to the existing Context, Execution and credential owners.
The Model slice brought the graph to 91 nodes and 221 connections; the subsequent Safety slice adds five nodes and 31 connections. Automatic and Next playback
use the same event reducers with versioned local fake protocol profiles. Draft
calls cannot launch Tools; readiness, retries and Stop preserve original ownership.
The source studies remain dated research evidence. No live provider adapters,
credential exchange, token measurements or remote-cancellation guarantee are implied.

Safety and permissions research:

- [Architecture synthesis and proposed five nodes](safety-permissions-research.md).
- [Hermes and OpenClaw](safety-hermes-openclaw.md), [Pi and Waku](safety-pi-waku.md).
- [Current Lina contracts and integration audit](safety-existing-design-audit.md),
  including JSON records, graph routes and simulation cases.
- [Earlier focused approval-choice study](approval-modes-research.md).

The proposal retains Allow once, Allow for this session, Always allow this scope,
and Deny. It expands the earlier three-node Safety proposal with explicit policy
resolution and permission-grant management. The [Safety graph and fixture simulation](../../../development/implementation-plans/studio/completed/lina-safety-permissions.md) now implement these responsibilities in the design workspace. The Safety slice brought the graph to 96 nodes and 252 connections. Durable grant storage and live enforcement remain unimplemented.

State, persistence and recovery research:

- [Comparative findings and four-node direction](state-persistence-research.md).
- [Hermes and OpenClaw](state-hermes-openclaw.md), [Pi and Waku](state-pi-waku.md).
- [Existing repository audit, graph connections and JSON sketches](state-existing-design-audit.md).

These refine the earlier State proposal. Conversation restoration, execution
recovery and uncertain-effect reconciliation remain distinct. The [State graph and recovery simulation](../../../development/implementation-plans/studio/completed/lina-state-persistence.md) now implement the design slice. Live runtime durability remains unimplemented.


Memory research and implemented design slice:

- [Architecture synthesis, candidate nodes and experiments](memory-research.md).
- [Hermes and OpenClaw source study](memory-hermes-openclaw.md).
- [Pi and Waku source study](memory-pi-waku.md).
- [Primary mechanisms and evaluation](memory-mechanisms-and-evaluation.md).
- [Existing Lina/Studio memory audit](memory-existing-design-audit.md).

The accepted research refines the earlier four-responsibility sketch into twelve
nodes across recall, mutation, consolidation and forgetting. The
[Memory implementation checklist](../../../development/implementation-plans/studio/completed/lina-memory-block.md)
records the graph, JSON contracts and deterministic Auto/Next playback. The
Memory slice brought the maintained architecture to 112 nodes, 400 connections and
112 typed node contracts. Memory uses inspectable design fixtures; no live Lina memory backend,
embedding service, background daemon or measured retrieval improvement is implied.
The source studies remain historical observations at their pinned revisions.

## Subagents / multi-agent orchestration

- [Accepted architecture and eight lifecycle nodes](subagents-research.md).
- [Hermes and OpenClaw source study](subagents-hermes-openclaw.md).
- [Pi and Waku source study](subagents-pi-waku.md).
- [Orchestration patterns and experiment variables](subagents-patterns-and-evaluation.md).
- [Existing design and integration audit](subagents-existing-design-audit.md).

The full accepted scope includes recursive delegation, persistent sessions,
selected/forked context, admitted worker configuration, selective joins, attached
and independently owned detached work, cancellation and recovery. The earlier
narrow initial-slice restrictions are superseded by this scope. Eight maintained
nodes and 77 relationships reuse the existing child-instance harness loop.
The graph now has 120 nodes, 477 relationships and 120 typed contracts. The
[implementation checklist](../../../development/implementation-plans/studio/completed/lina-subagents-block.md)
tracks validation. Studio lifecycle records and child execution are deterministic
fixtures; they do not demonstrate a live scheduler or agent-team performance.
Pinned source studies describe their inspected revisions, not universal defaults.

## Planning and task management — research proposal

- [Architecture recommendation, eight proposed nodes and future checklist](planning-research.md).
- [Hermes and OpenClaw source study](planning-hermes-openclaw.md).
- [Pi and Waku source study](planning-pi-waku.md).
- [Established mechanisms and evaluation variables](planning-patterns-and-evaluation.md).
- [Current Lina integration audit](planning-existing-design-audit.md).

The proposed block distinguishes optional progress tracking, plan-first modes and
dependency-aware task management. It reuses Turn Execution, Tools, State, Context
and Subagents rather than creating another scheduler. The accepted Planning graph and fixture simulation now populate this region;
see the [implementation checklist](../../../development/implementation-plans/studio/completed/lina-planning-block.md). No performance
improvement or live durability is established by this source review.


## Execution Environment

- [Accepted architecture, twelve nodes and implementation boundaries](environment-research.md).
- [Hermes and OpenClaw source study](environment-hermes-openclaw.md).
- [Backend capabilities, Pi and Waku](environment-backends-and-patterns.md).
- [Existing Lina integration audit](environment-existing-design-audit.md).

The maintained Environment region now contains twelve nodes. The current graph
has 140 nodes and 643 connections. Local workspace execution is the default
profile; Docker and remote placement are configurable design fixtures. Command
and file tools share a declared binding, while whole-harness deployment and
external MCP/API placement remain separate. The [implementation checklist](../../../development/implementation-plans/studio/completed/lina-execution-environment.md)
tracks final verification. Twenty-six selector entries cover normal execution,
resource/readiness failures, process interaction, custody, recovery and bypass.
No live sandbox or process durability is established by this implementation.

## Output and delivery research

- [Architecture proposal, coverage audit, thirteen nodes and future checklist](output-research.md).
- [Hermes and OpenClaw source study](output-hermes-openclaw.md).
- [Channel contracts, Pi and Waku](output-channels-and-protocols.md).
- [Existing Lina ownership and integration audit](output-existing-design-audit.md).

The research covers prompts, progress, proactive notices, internal child results,
media custody, per-part receipts and uncertain-send recovery alongside replies.
The Output region now contains thirteen nodes with JSON contracts and controlled
delivery playback. See the [implementation checklist](../../../development/implementation-plans/studio/completed/lina-output-delivery.md). Live channel sends, runtime outbox storage and measured platform reliability remain unimplemented.
