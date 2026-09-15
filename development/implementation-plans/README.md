# Implementation plans

**Last updated:** 2026-09-15T09:43:41+02:00

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

## Active plans

- [Computer Native reliable terminal and workspace inspection](active/computer-native-reliable-terminal-and-workspace-inspection.md) — reliable
  real-model turns, the expanded standalone terminal interface, and the first bounded
  read-only workspace inspection loop.

## Completed plans

- [Platform UI](completed/platform-ui.md) — completed 2026-09-14T17:24:17+02:00;
  established the first clean Platform workspace and configuration surface before runner
  execution existed.
- [Computer Native terminal agent](completed/computer-native-tui.md) — completed
  2026-09-15T00:54:57+02:00; delivered the first streamed, evidence-producing local
  terminal turn.
- [Lab server + Temporal baseline](completed/lab-server-temporal-baseline.md) — completed
  2026-09-15T01:46:55+02:00; delivered the first end-to-end Platform UI, Fastify, local
  Temporal, worker, and evidence path.

Completed plans are retained rather than deleted because their scope, trade-offs, and
validation results remain useful project history.
