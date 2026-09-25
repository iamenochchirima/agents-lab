# Studio implementation plans

This directory contains plans for Studio, a browser-accessible laboratory for
developing agent modules independently, assembling them into complete agents, and
inspecting run evidence.

Studio does not own complete platform execution and does not replace Anesu. Platform
plans live in [the platform plan directory](../platforms/README.md).

The [modular agent Studio program](modular-agent-studio.md) is the current forward
plan. Its first slice covered package ownership, module interfaces, and a
representative standalone example; that foundation plan is complete. Stage 2 will
add the remaining role implementations through separate focused plans.
The [component assembly discovery note](../../../docs/planning/studio-assembly-discovery.md)
records the earlier discussion that led to this direction.

## Program sequence

The current sequence is recorded in the [program plan](modular-agent-studio.md).
Stage 2 does not yet have an active focused plan. The earlier UI preview plan is
listed separately and will be reconciled before run-facing browser work. Later
stages will each receive their own scoped plan before work begins.

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
configuration-only preview remains distinct from run execution; reconcile it with the
program before implementing the run-facing browser workflow.

## Completed plans

- [Studio module package and interface foundation](completed/studio-module-foundation.md)
- [Studio backend completion and UI readiness](completed/studio-backend-ui-readiness.md)
- [Studio Memory runtime](completed/studio-memory-runtime.md)
- [Studio backend runtime foundation](completed/studio-backend.md)
- [Studio foundation kernel](completed/studio-runtime-kernel.md)
- [Studio multi-turn Memory and measurement](completed/studio-memory-multiturn-measurement.md)
- [Studio Context research runtime](completed/studio-context-research-runtime.md)
