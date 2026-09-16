# Completed implementation plans

**Last updated:** 2026-09-16T23:26:41+02:00

Completed plans are an archive of delivered implementation slices. Each archived plan
must retain its original scope and checklists, plus:

- **Completed:** ISO 8601 timestamp, including timezone.
- **Validation:** exact commands, test results, and manual checks performed.
- **Known limitations:** deliberate exclusions or follow-up work.

Do not move a plan here because work paused or because an implementation is merely
partially functional.

- [One-command local comparison stack](local-stack-launcher.md) — completed
  2026-09-16T12:35:00+02:00; starts the priority local platform services, shared Lab
  server, worker, and web app behind readiness gates.
- [Platform Lab completion wave](platform-completion-wave.md) — completed
  2026-09-16T23:26:41+02:00; closed the connected context, Restate tool-loop, and
  browser Chat slices with native no-Docker validation and focused commits.
- [Session context, token budgets, and bounded compaction](context-management.md) —
  completed 2026-09-16T23:26:41+02:00; added the first Temporal session/context adapter,
  bounded compaction, keyed turn admission, and safe context projections.
- [Tool-enabled turn loop](tool-enabled-turn-loop.md) — completed
  2026-09-16T23:26:41+02:00; completed the bounded Restate calculator loop, native
  restart evidence, and browser activity presentation.
- [Browser Chat surface](browser-chat-surface.md) — completed 2026-09-16T23:26:41+02:00;
  added browser-first Chat routes, Temporal continuity, safe evidence links, and
  registered-platform route coverage.

Archived validation records keep the exact command names used when they were run. The
repository now uses the root pnpm workspace, so use the current package scripts and
`pnpm-lock.yaml` for new work rather than copying an old npm command verbatim.
