# Trigger.dev implementation notes

- [Development profiles](local-development.md) — pinned setup, the no-Docker Cloud
  profile, optional self-hosting, task worker, and real-run validation.
- [Execution semantics](semantics.md) — admission, retries, cancellation, recovery,
  lost acknowledgements, and evidence boundaries.

The official sources consulted for this baseline are:

- [CLI dev command](https://trigger.dev/docs/cli-dev-commands) — `trigger.dev dev`,
  task process isolation, API URL, and CLI options.
- [Manual setup](https://trigger.dev/docs/manual-setup) — matching SDK/CLI pins,
  secret configuration, `trigger.config.ts`, and task registration.
- [How Trigger.dev works](https://trigger.dev/docs/how-it-works) — local task
  execution versus server scheduling and the lack of offline mode.
- [Triggering](https://trigger.dev/docs/triggering) — task handles, run inspection,
  TTL, and trigger options.
- [Idempotency](https://trigger.dev/docs/idempotency) — task-level idempotency-key
  behavior and key scope.
- [Self-hosting overview](https://trigger.dev/docs/self-hosting/overview) — the
  distinction between self-hosted server containers and local task workers.
- [Official release metadata](https://github.com/triggerdotdev/trigger.dev/releases)
  — versioned releases and the `4.5.14` pin required by the implementation plan.

These links were reviewed on 2026-09-17. Official documentation describes the
platform contract; local observations must remain labelled as local observations.
