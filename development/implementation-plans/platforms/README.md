# Platform implementation plans

This directory contains plans for the Lab's execution platforms and their shared
server integration. It covers platform runners, native lifecycle behaviour, state,
durability, retries, recovery, model and tool integration, evidence, and the Platform
Lab user surface required to inspect those behaviours.

It does not contain Studio work or plans for independently owned harnesses.

## Active plans

- [Connected tool execution and approvals in chat](active/connected-tool-execution-and-inline-approvals.md):
  proposed next substantial phase covering reliable startup, transcript approvals,
  Vercel's native connected-tool loop, five-platform real-task acceptance, focused
  checks and coherent commit checkpoints.

- [Agent capability awareness and discovery](active/agent-capability-awareness.md):
  proposed milestone for generated model inventories, enabled skill metadata,
  authorized tool discovery, native schema activation and frontend parity.

- [Real agent tools and skills](active/real-agent-tools-and-skills.md): standalone
  next implementation milestone, with architecture decisions, capability adapters,
  skills, task environments, native integration, minimal acceptance checks and
  commit checkpoints. Implemented with four-platform native and real-model
  evidence; failed model steps and the Restate deadline remain recorded.

- [Free-model live agent evals](active/free-model-live-evals.md) — implemented:
  historical first slice: three real-model tasks passed on Mastra, LangGraph and
  Temporal; Restate was unavailable then. The completed behaviour milestone below
  supersedes that service status. Retained evidence is visible in Evals.
  This temporary checklist is not published in the curated Docs navigation.

- [First executable agent evals](active/agent-harness-baseline-evals.md) — four-case
  development implementation complete: Mastra and LangGraph trials passed;
  Temporal/Restate services were absent then. The completed behaviour milestone
  below supersedes that coverage and service status. Broader hardening remains deferred.

- [AWS Step Functions baseline](active/aws-step-functions-baseline.md) — parked until
  its workflow-type and external-service decisions are revisited.

The completed [cross-platform agent conformance plan](completed/platform-agent-conformance.md)
was the foundation for this acceptance phase and the completed Restate slice. AWS Step
Functions remains parked.

## Completed plans

- [Frontend capability management](completed/frontend-capability-management.md):
  saved encrypted connections, HTTP/OAuth and managed stdio, skill/bundle imports,
  tool approvals and live agent profiles. Four native baselines have workload-specific
  free-model acceptance; failed trials and observer corrections remain recorded.

- [General backend agent eval gap closure](completed/agent-eval-gap-closure.md):
  implemented coverage, correction evaluation, retained assessment, native extension
  acceptance and demonstrated runtime fixes. Focused evidence and remaining live
  failures/human judgments are recorded; final-revision readiness is not implied.

- [Connected business-agent tools](completed/connected-business-agent-tools.md):
  four native baselines with connected HTTP/MCP tools, connection authority,
  exact-action review/recovery, optional external document/procedure providers,
  retained effect evidence and actual LangGraph browser acceptance. Strict free-model
  trial results remain 2 pass / 3 fail / 3 error; production hardening is deferred.


- [Cross-platform agent behaviour milestone](completed/cross-platform-agent-behaviour-milestone.md):
  B01–B12 implemented with 48 passing native case reports across four platforms.
  L01–L06 actual free-model trials retain 16 passes, four pending human assessments
  and four provider/runtime errors. Includes commit checkpoints, focused checks,
  setup and inspectable evidence. Temporary plan kept outside curated Docs.

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
