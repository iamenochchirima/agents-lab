# Active implementation plans

**Last updated:** 2026-09-16T11:00:00+02:00

These plans govern implementation that is not yet complete. Every checkbox must remain
honest: it represents work that has been verified, not merely code that was started.

When a plan reaches its completion gate, add its completion record and move it to
[`../completed/`](../completed/README.md).

## Current Computer Native slice

The browser-interaction and memory slices are complete and archived in
[`../completed/computer-native-browser-interaction.md`](../completed/computer-native-browser-interaction.md)
and [`../completed/computer-native-memory.md`](../completed/computer-native-memory.md).
The queue can now advance to the next Computer Native module.

## Current additive UI slice

The Component Lab is an additive workspace and is governed by
[`component-lab-ui.md`](component-lab-ui.md). This slice establishes the area catalog
and Context Management configuration preview without changing Platform Lab execution.

## Current platform batch

- [Real OpenRouter model connection and shared model selection](openrouter-model-selection.md)
- [Parallel platform implementation coordination](platform-parallel-implementation.md)
- [First-party platform plan source audit](../../../docs/research/platform-plan-source-audit.md)
- [Session context, token budgets, and bounded compaction](context-management.md)
- [Trigger.dev baseline](trigger-dev-baseline.md)
- [AWS Step Functions baseline](aws-step-functions-baseline.md)

Restate, LangGraph, Mastra, Inngest, DBOS, Hatchet, and Vercel Workflows are
archived in [completed plans](../completed/README.md). Trigger.dev remains active
because its real local server/worker acceptance profile is not available yet. AWS
Step Functions remains outside the current implementation wave.
