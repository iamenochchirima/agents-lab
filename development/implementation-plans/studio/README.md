# Studio implementation plans

This directory contains plans for Studio, the workspace for studying individual
harness components under controlled conditions. Studio plans cover component
experiments, comparison strategies, Studio-owned APIs, evidence, and the Studio user
surface.

Studio does not own complete platform execution and does not replace Anesu. Platform
plans live in [the platform plan directory](../platforms/README.md).

## Studio roadmap

Studio is implemented in separate active plans. Each plan should finish one concrete
slice before the next component strategy is added.

1. **Foundation kernel:** compose one complete deterministic agent turn through all
   twelve component slots, with baseline adapters, Context strategies, evidence, and
   one opt-in live model adapter.
2. **Memory:** implement memory scopes, retrieval, writing, consolidation, restart,
   and Context/Memory comparison cases.
3. **Context research:** add compaction, summarization, ranking, caching, multimodal
   sources, and pressure-controlled scenario families.
4. **Tools and control:** add tool selection, retries, parallel dispatch, loops,
   graphs, replanning, delegation, and termination comparisons.
5. **Environment and safety:** add real permissions, resource governors, failure
   injection, side-effect gates, and computer-use profiles.
6. **Model and observability:** add provider routing, cost/latency studies,
   distributed traces, and richer model-backed experiments.

The roadmap describes the intended order. The active plan defines the work that may
be implemented now.

## Active plans

- [Studio Memory runtime](active/studio-memory-runtime.md)
- [Component Lab UI foundation](active/component-lab-ui.md)
- [Studio backend runtime foundation](active/studio-backend.md)

## Completed plans

- [Studio foundation kernel](completed/studio-runtime-kernel.md)
