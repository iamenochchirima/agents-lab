# Studio implementation plans

This directory contains plans for Studio, a browser-accessible laboratory for
developing agent modules independently, assembling them into complete agents, and
inspecting run evidence.

Studio does not own complete platform execution. Platform plans live in
[the platform plan directory](../platforms/README.md).

The [modular agent Studio program](modular-agent-studio.md) is the current forward
plan. Its first slice covered package ownership, module interfaces, and a
representative standalone example; that foundation plan is complete. Stage 2 began
with the Input and Context baselines. The completed [chat test slice](completed/studio-chat-test-slice.md)
and its [tool round-trip follow-up](completed/studio-tool-roundtrip.md) provide a
small integrated example. The completed [remaining module baselines plan](completed/studio-remaining-module-baselines.md)
adds standalone Planning, Computer Use, Output Actions, and Observability implementations,
completing the first baseline for all twelve areas. The completed [kernel and reference
assembly plan](completed/studio-kernel-reference-assembly.md) connects those first
implementations through one inspectable agent cycle.
The [component assembly discovery note](../../../docs/planning/studio-assembly-discovery.md)
records the earlier discussion that led to this direction.

The user-provided screenshot confirms the initial Replay chat reached Context. The
[deterministic tool round-trip slice](completed/studio-tool-roundtrip.md) records the
fixed calculator scenario through Tool Use, Safety, Execution Environment, and
structured Context continuation. The completed reference assembly extends this to
all twelve selected areas and persists run evidence.

## Program sequence

The current sequence is recorded in the [program plan](modular-agent-studio.md).
Stage 2 began with the completed [Input and Context baseline slice](completed/studio-input-context-baselines.md).
The completed [Studio chat test slice](completed/studio-chat-test-slice.md) is the
browser chat foundation. The [Components UI foundation](active/component-lab-ui.md)
introduced the catalog and strategy preview. The active
[Context component experiment](active/context-component-experiment.md) connects the
Context workspace to a bounded, saved two-strategy comparison; its completion gate
still includes dedicated checks and browser inspection.

## Historical roadmap for the server-hosted implementation

The list below records the previous implementation sequence. The modular agent
Studio program supersedes it as the forward direction; completed plans remain useful
as a record of the current implementation.

1. **Foundation kernel:** compose one complete deterministic agent turn through all
   twelve component slots, with baseline adapters, Context strategies, evidence, and
   one opt-in live model adapter.
2. **Memory runtime:** implement memory scopes, retrieval, writing, consolidation,
   restart, and Context/Memory comparison cases.
3. **Multi-turn Memory and measurement:** carry Memory across ordered turns and add
   reproducible retrieval, growth, Context-cost, latency, and recovery measurements.
4. **Context research:** hold Memory fixed while adding compaction, summarization,
   ranking, budgeting, and pressure-controlled scenario families.
5. **Backend contract and UI readiness:** verify the same-server Context/Memory API,
   persistence, cancellation, recovery, evidence safety, and the future UI handoff.
6. **Studio UI:** connect the existing navigation to the catalog, comparison lifecycle,
   safe projections, and evidence inspection without fabricating run data.
7. **Tools and control:** add tool selection, retries, parallel dispatch, loops,
   graphs, replanning, delegation, and termination comparisons.
8. **Environment and safety:** add real permissions, resource governors, failure
   injection, side-effect gates, and computer-use profiles.
9. **Model and observability:** add provider routing, cost/latency studies,
   distributed traces, and richer model-backed experiments.

## Active plans

- [Lina cross-block architecture revisit proposal](active/lina-cross-block-revisit.md)
  audits all current and reserved blocks after Tools expansion. It specifies
  graph-ready additions and handoffs. The populated-block revisit is complete;
  remaining block development is pending.
- [Studio Context component experiment](active/context-component-experiment.md)
- [Component Lab UI foundation](active/component-lab-ui.md)

The existing UI foundation plan predates the separate Studio API decision. It
documents the catalog and preview; run execution uses the Studio API. The active
Context experiment plan connects that workspace to one executable, inspectable
comparison. Other components and Context alternatives remain planned.

## Completed plans

- [Lina Execution Environment](completed/lina-execution-environment.md) adds twelve
  workspace/process/lifecycle nodes, JSON contracts and configurable local/sandbox
  design playback. Validation is complete for the design simulation.

- [Lina Subagents / multi-agent orchestration](completed/lina-subagents-block.md)
  adds eight lifecycle nodes, recursive/session/ownership contracts, scoped child
  harness simulation and per-agent Auto/Next inspection.

- [Lina Memory design block](completed/lina-memory-block.md) adds twelve nodes,
  scoped recall/write/maintenance contracts and 21 Auto/Next cases, including
  parent-reviewed publication, corrections and tracked forgetting.

- [Lina State, persistence and recovery](completed/lina-state-persistence.md)
  adds four nodes, correlated storage/checkpoint contracts and fourteen recovery
  cases with Auto/Next, preserved work and explicit uncertain effects.

- [Lina Safety nodes and permission simulation](completed/lina-safety-permissions.md)
  adds five nodes, four approval choices, scoped fixture grants and final dispatch
  checks, with independent waits and preserved sibling results.

- [Lina Model Interface and provider simulation](completed/lina-model-interface.md)
  adds four maintained nodes connected to Context, Execution and shared readiness;
  local protocol fixtures show drafts, normalization, retries and Stop without
  live provider calls. The [reference contract fixtures](completed/lina-model-interface.contract-fixtures.json)
  remain design examples, not production provider schemas.

- [Lina populated-block revisit and detailed simulation](completed/lina-current-block-revisit.md)

- [Lina Tools nodes, capability setup and credential lifecycle](completed/lina-tools-nodes.md)

- [Lina Context block and connected simulation](completed/lina-context-block.md)

- [Lina tool outcomes and loop limits](completed/lina-tool-outcomes-and-limits.md)

- [Lina turn execution and connected simulation](completed/lina-turn-execution-simulation.md)
- [Lina input simulation: first implementation](completed/lina-input-simulation.md)

- [Studio chat test slice](completed/studio-chat-test-slice.md)
- [Studio kernel and first reference assembly](completed/studio-kernel-reference-assembly.md)
- [Studio deterministic tool round-trip](completed/studio-tool-roundtrip.md)
- [Studio remaining module baselines](completed/studio-remaining-module-baselines.md)
- [Studio Input and Context baselines](completed/studio-input-context-baselines.md)
- [Studio module package and interface foundation](completed/studio-module-foundation.md)
- [Studio backend completion and UI readiness](completed/studio-backend-ui-readiness.md)
- [Studio Memory runtime](completed/studio-memory-runtime.md)
- [Studio backend runtime foundation](completed/studio-backend.md)
- [Studio foundation kernel](completed/studio-runtime-kernel.md)
- [Studio multi-turn Memory and measurement](completed/studio-memory-multiturn-measurement.md)
- [Studio Context research runtime](completed/studio-context-research-runtime.md)

- [Lina Planning and task management](completed/lina-planning-block.md)

- [Lina Output and delivery](completed/lina-output-delivery.md)

## Standalone Lina handoff

The [full-screen TUI implementation handoff](active/lina-tui-upgrade.md) is stored
here with its Lab design references. It targets the separate Lina repository,
not Studio runtime code. Its checklist covers the approved five-screen design,
real application integration and terminal verification. Transfer the plan into
Lina when its implementation session starts.
