# Trigger.dev platform

This directory contains the isolated Trigger.dev baseline. It uses the official
`@trigger.dev/sdk@4.5.14` client to admit a task, inspect the Trigger run, and
project the result through the Lab runner port.

The platform boundary is deliberately local to this directory:

- `config.ts` parses the local Trigger profile and produces redacted manifest data.
- `variants/baseline/execution/task.ts` is the real task discovered by
  `trigger.dev dev`.
- `runner-adapter/trigger-dev-runner.ts` owns SDK calls, idempotent admission,
  status mapping, cancellation, and native references.
- `docs/` records local operation and failure semantics.

The baseline currently supports deterministic fake models only. An OpenRouter task
adapter is intentionally deferred until its provider-call and duplicate-call rules
are defined.

Start with [`docs/local-development.md`](docs/local-development.md).
