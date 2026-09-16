# Active implementation plans

**Last updated:** 2026-09-16T08:34:37+02:00

These plans govern implementation that is not yet complete. Every checkbox must remain
honest: it represents work that has been verified, not merely code that was started.

When a plan reaches its completion gate, add its completion record and move it to
[`../completed/`](../completed/README.md).

## Current Computer Native slice

The browser-interaction slice is complete and archived in
[`../completed/computer-native-browser-interaction.md`](../completed/computer-native-browser-interaction.md).
The next Computer Native component is Memory, as recorded in the follow-on queue. It
requires its own active implementation plan before code work begins.

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
