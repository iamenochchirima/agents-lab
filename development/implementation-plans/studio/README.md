# Studio implementation plans

This directory contains plans for Studio, the workspace for studying individual
harness components under controlled conditions. Studio plans cover component
experiments, comparison strategies, Studio-owned APIs, evidence, and the Studio user
surface.

Studio does not own complete platform execution and does not replace Anesu. Platform
plans live in [the platform plan directory](../platforms/README.md).

## Studio roadmap

Studio is implemented in separate plans. Each plan finishes one concrete slice before
the next component strategy is added. The backend kernel is complete; the current UI
plan is still active and must consume the backend contract rather than invent a second
execution path.

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

The roadmap describes the intended order. The active plan defines the work that may
be implemented now.

## Active plans

- [Component Lab UI foundation](active/component-lab-ui.md)

## Completed plans

- [Studio backend completion and UI readiness](completed/studio-backend-ui-readiness.md)
- [Studio Memory runtime](completed/studio-memory-runtime.md)
- [Studio backend runtime foundation](completed/studio-backend.md)
- [Studio foundation kernel](completed/studio-runtime-kernel.md)
- [Studio multi-turn Memory and measurement](completed/studio-memory-multiturn-measurement.md)
- [Studio Context research runtime](completed/studio-context-research-runtime.md)
