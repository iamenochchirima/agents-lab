# Implementation plans

**Last updated:** 2026-09-16T08:34:37+02:00

This directory contains the execution contracts for substantial implementation slices.
They are deliberately more specific than a roadmap: each plan defines scope, ownership,
required tests, validation commands, limitations, and a completion gate.

```text
implementation-plans/
├── active/       # plans currently governing implementation work
└── completed/    # completed plans retained with date and validation evidence
```

## Plan lifecycle

1. Create a dated plan in `active/` before starting a substantial slice.
2. Keep its checklists accurate while implementing; unchecked work is not silently
   treated as complete.
3. Record validation results and known limitations before declaring the slice complete.
4. Commit each coherent, validated implementation section; do not hold a large plan for
   one final commit.
5. Add a **Completed** timestamp, commit hashes or range, and concise completion record.
6. Move the plan unchanged in substance to `completed/` so later contributors can see
   what was promised, what was delivered, and how it was verified.

Timestamps use ISO 8601 (`YYYY-MM-DDTHH:MM:SS±HH:MM`) for stable sorting and
unambiguous history.

Start a new plan from [the template](TEMPLATE.md). It is intentionally concise enough
for a UI slice, while making failure, recovery, ownership, and evidence questions
mandatory whenever the work has state or external effects.

The Computer Native follow-on order is recorded in the [follow-on queue](computer-native-follow-on-queue.md).

The completed Computer Native implementation plan is
[process execution](completed/computer-native-process-execution.md); the workspace and
filesystem capability remains archived below.

## Active plans

The next Computer Native component is selected from the
[follow-on queue](computer-native-follow-on-queue.md); the workspace and filesystem
category is complete and archived below.

The active platform work is coordinated by
[the platform batch plan](active/platform-parallel-implementation.md). Trigger.dev
and AWS Step Functions remain active; the other local platform baselines from this
batch are archived below.

The current shared model slice is tracked in the
[OpenRouter model selection plan](active/openrouter-model-selection.md).

The next context slice is tracked in the
[session context and compaction plan](active/context-management.md). It covers the
shared context semantics and first Temporal integration; long-term memory remains a
separate follow-on capability.

## Completed plans

- [Platform UI](completed/platform-ui.md) — completed 2026-09-14T17:24:17+02:00;
  established the first clean Platform workspace and configuration surface before runner
  execution existed.
- [Computer Native terminal agent](completed/computer-native-tui.md) — completed
  2026-09-15T00:54:57+02:00; delivered the first streamed, evidence-producing local
  terminal turn.
- [Computer Native reliable terminal and workspace inspection](completed/computer-native-reliable-terminal-and-workspace-inspection.md) — completed
  2026-09-15T10:21:25+02:00; delivered bounded real-provider turns, the standalone
  terminal interface, and read-only workspace inspection with durable round evidence.
- [Computer Native workspace actions](completed/computer-native-workspace-actions.md) —
  completed 2026-09-15T16:32:00+02:00; delivered approval-gated file and directory
  actions, quarantine-backed deletion and restore, multi-file patch journaling, and
  restart reconciliation.
- [Computer Native workspace and filesystem capability](completed/computer-native-workspace-filesystem.md) —
  completed 2026-09-15T16:34:52+02:00; completed the local workspace category with
  bounded directory-tree quarantine, restoration, exact-token purge, recovery, TUI,
  security, and end-to-end tests.
- [Computer Native process execution](completed/computer-native-process-execution.md) —
  completed 2026-09-15T17:48:00+02:00; delivered approval-gated, bounded local
  foreground command execution with sanitized environment, lifecycle evidence,
  cancellation, recovery, TUI activity, and real-provider acceptance.
- [Computer Native browser interaction](completed/computer-native-browser-interaction.md) —
  completed 2026-09-16T08:34:37+02:00; delivered an approval-gated managed Chromium
  capability with bounded snapshots, artifacts, dialog handling, cancellation, durable
  evidence, TUI activity, security policy, and real-model local-fixture acceptance.
- [Restate baseline](completed/restate-baseline.md) — completed
  2026-09-15T17:40:00+02:00; delivered the local durable workflow baseline, generic
  runner integration, native evidence, and shared UI execution path.
- [LangGraph baseline](completed/langgraph-baseline.md) — completed
  2026-09-15T17:40:00+02:00; delivered the local Python graph baseline, checkpointed
  service boundary, generic runner integration, and shared UI execution path.
- [Mastra baseline](completed/mastra-baseline.md) — completed
  2026-09-15T17:40:00+02:00; delivered the local TypeScript runtime baseline, lifecycle
  evidence, generic runner integration, and shared UI execution path.
- [Inngest baseline](completed/inngest-baseline.md) — completed
  2026-09-15T17:40:00+02:00; delivered the local Dev Server/function baseline,
  event-backed lifecycle evidence, and shared UI execution path.
- [DBOS baseline](completed/dbos-baseline.md) — completed
  2026-09-15T17:40:00+02:00; delivered the local PostgreSQL-backed workflow baseline,
  lifecycle projection, and shared UI execution path.
- [Hatchet baseline](completed/hatchet-baseline.md) — completed
  2026-09-15T17:40:00+02:00; delivered the embedded local worker baseline, native
  task evidence, generic runner integration, and shared UI execution path.
- [Vercel Workflows baseline](completed/vercel-workflows-baseline.md) — completed
  2026-09-15T17:40:00+02:00; delivered the local Workflow World baseline, workflow
  evidence, generic runner integration, and shared UI execution path.
- [Lab server + Temporal baseline](completed/lab-server-temporal-baseline.md) — completed
  2026-09-15T01:46:55+02:00; delivered the first end-to-end Platform UI, Fastify, local
  Temporal, worker, and evidence path.
- [Server platform foundation](completed/server-platform-foundation.md) — completed
  2026-09-15T10:22:54+02:00; established the generic runner, registry, execution-reference,
  evidence, and future-platform plan seams around the Temporal baseline.

Completed plans are retained rather than deleted because their scope, trade-offs, and
validation results remain useful project history.
