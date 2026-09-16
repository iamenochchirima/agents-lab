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

The baseline supports the real OpenRouter task path when `OPENROUTER_API_KEY` is
available in the Trigger task process. Deterministic fake models remain available
only for tests and failure experiments. Provider requests stay inside the task
boundary and retain Trigger's retry and unknown-outcome semantics.

Start with [`docs/local-development.md`](docs/local-development.md).
