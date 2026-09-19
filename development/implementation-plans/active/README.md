# Active implementation plans

**Last updated:** 2026-09-19T18:40:00+02:00

These plans govern implementation that is not yet complete. Every checkbox must remain
honest: it represents work that has been verified, not merely code that was started.

When a plan reaches its completion gate, add its completion record and move it to
[`../completed/`](../completed/README.md).

## Current Anesu slices

The current Anesu foundation slice is
[core hardening and production foundation](anesu-core-hardening.md). Its
first-iteration paths are usable; exhaustive production reinforcement remains tracked
in the gap register. The browser-interaction and memory slices are complete and archived in
[`../completed/anesu-browser-interaction.md`](../completed/anesu-browser-interaction.md)
and [`../completed/anesu-memory.md`](../completed/anesu-memory.md).
The first Skills foundation slice is complete and archived in
[`../completed/anesu-skills-foundation.md`](../completed/anesu-skills-foundation.md).
The first standalone Context Management slice is complete and archived in
[`../completed/anesu-context-management.md`](../completed/anesu-context-management.md).
It delivered resource precedence, bounded context assembly, snapshots, compaction,
recovery, retention semantics, and inspection. Its later maturity gaps remain in the
production-readiness register.
Overall maturity is not complete. The authoritative remaining work is in
[Anesu production-readiness gaps](anesu-production-readiness-gaps.md).
The queue's status table separately lists what each completed slice still does not cover.

The next standalone Anesu capability planned after the current foundation is the
[computer-use dual-path slice](anesu-computer-use-dual-paths.md). It will expose a
traditional screenshot/vision strategy and a TypeSafe/Jev semantic strategy behind one
shared host executor, approval boundary, and evidence model. It is a plan, not a claim
that implementation has started or that either path is currently available.

That work starts with the narrower [computer-use proof of concept](anesu-computer-use-poc.md),
which uses a visible local browser fixture and records the native desktop work it does
not yet cover.

## Current additive UI slice

The Component Lab is an additive workspace and is governed by
[`component-lab-ui.md`](component-lab-ui.md). This slice establishes the area catalog
and Context Management configuration preview without changing Platform Lab execution.

## Current Studio backend slice

The standalone Studio interface is backed by the active
[Studio backend runtime foundation](studio-backend.md). It adds a separately owned
`server/src/studio/` module family to the existing Lab server and begins with one
deterministic Context Management comparison. It does not change the Platform Lab
control plane or create a second server.

## Current platform batch

- [Real OpenRouter model connection and shared model selection](../completed/openrouter-model-selection.md)
- [First-party platform plan source audit](../../../docs/research/platform-plan-source-audit.md)

The cross-platform agent conformance slice is complete and archived in
[`../completed/platform-agent-conformance.md`](../completed/platform-agent-conformance.md).
It extends the accepted Temporal, Restate, LangGraph, and Mastra baselines with one
comparable prompt, calculator-tool, and two-turn context workload. AWS Step Functions
remains outside that implementation wave.

Restate, LangGraph, Mastra, Inngest, DBOS, Hatchet, and Vercel Workflows are
archived in [completed plans](../completed/README.md). Trigger.dev is also archived
as implementation-ready with real server/worker and manual UI acceptance deferred.
