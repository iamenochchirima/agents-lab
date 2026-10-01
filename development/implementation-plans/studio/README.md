# Studio implementation plans

This directory contains plans for Studio, a browser-accessible laboratory for
developing agent modules independently, assembling them into complete agents, and
inspecting run evidence.

Studio does not own complete platform execution and does not replace Anesu. Platform
plans live in [the platform plan directory](../platforms/README.md).

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
browser chat foundation. The
[Components UI preview](active/component-lab-ui.md) remains a separate static
catalog and strategy preview; the chat adds a run-facing surface without changing
that preview's scope.

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

- [Component Lab UI foundation](active/component-lab-ui.md)

The existing UI foundation plan predates the separate Studio API decision. Its
configuration-only preview remains distinct from run execution. The chat uses a
separate route and the Studio API.

## Completed plans

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
