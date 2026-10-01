# Platform implementation plans

This directory contains plans for the Lab's execution platforms and their shared
server integration. It covers platform runners, native lifecycle behaviour, state,
durability, retries, recovery, model and tool integration, evidence, and the Platform
Lab user surface required to inspect those behaviours.

It does not contain Lina or Studio work. Those have their own plan directories.

## Active plans

- [AWS Step Functions baseline](active/aws-step-functions-baseline.md) — parked until
  its workflow-type and external-service decisions are revisited.

The completed [cross-platform agent conformance plan](completed/platform-agent-conformance.md)
was the foundation for this acceptance phase and the completed Restate slice. AWS Step
Functions remains parked.

## Completed plans

### Platform foundations and shared capabilities

- [Platform UI](completed/platform-ui.md)
- [Lab server and Temporal baseline](completed/lab-server-temporal-baseline.md)
- [Server platform foundation](completed/server-platform-foundation.md)
- [Platform completion wave](completed/platform-completion-wave.md)
- [Platform parallel implementation](completed/platform-parallel-implementation.md)
- [One-command local stack](completed/local-stack-launcher.md)
- [OpenRouter model selection](completed/openrouter-model-selection.md)
- [Session context and compaction](completed/context-management.md)
- [Tool-enabled turn loop](completed/tool-enabled-turn-loop.md)
- [Browser Chat surface](completed/browser-chat-surface.md)
- [Cross-platform agent conformance](completed/platform-agent-conformance.md)
- [Mastra agent runtime and durable workflows](completed/mastra-agent-runtime-and-workflows.md)
- [Cross-platform production acceptance and comparison](completed/platform-cross-comparison-acceptance.md)
- [Platform capabilities, tools, skills, and connections](completed/platform-capabilities-and-integrations.md)

### Platform baselines

- [Restate](completed/restate-baseline.md)
- [Restate session continuity and recovery](completed/restate-session-continuity-and-recovery.md)
- [LangGraph](completed/langgraph-baseline.md)
- [LangGraph agent execution — end-to-end continuation and recovery](completed/langgraph-agent-execution-and-recovery.md)
- [Mastra](completed/mastra-baseline.md)
- [Inngest](completed/inngest-baseline.md)
- [DBOS](completed/dbos-baseline.md)
- [Hatchet](completed/hatchet-baseline.md)
- [Vercel Workflows](completed/vercel-workflows-baseline.md)
- [Trigger.dev](completed/trigger-dev-baseline.md)

Use [the platform baseline template](templates/platform-baseline.md) when a new
platform needs its own implementation plan.
