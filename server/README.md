# Lab server

The server coordinates Agent Harness Lab. It validates a run request, creates the
immutable Lab manifest, dispatches a registered platform runner, and projects safe
platform evidence into `lab/runs/<run-id>/`. The common server does not own a
platform's execution model. Each platform implements the runner seam in its own
directory.

The first runnable path is `temporal/baseline`. It uses a local Temporal development
server and a separate worker process. The browser talks to Fastify only. Planned
platforms remain visible in the registry but cannot be run until their adapter exists.

## Local start

Install dependencies, start Temporal in a separate terminal, then run the API and
worker from the repository root:

```bash
temporal server start-dev
npm --prefix server run dev
npm --prefix server run dev:worker
```

The API defaults to `http://127.0.0.1:4318`; its health endpoint reports the
connectivity of registered runnable platforms. Configuration is documented in
[.env.example](.env.example).

The server may start while a platform dependency is unavailable so the health response
can explain the dependency failure. It does not fabricate a run result; a submission
made during that condition is retained as a failed dispatch record.

Normalized evidence is platform-neutral:

```text
lab/runs/<run-id>/
  config.json
  events.jsonl
  trajectory.json
  metrics.json
  result.json
  native/<platform>.json
```

The platform adapter owns native execution details. The server owns the normalized
projection and never imports platform SDK types.

See the [Temporal local development guide](src/platforms/temporal/docs/local-development.md)
and the [completed implementation plan](../development/implementation-plans/completed/lab-server-temporal-baseline.md)
for the current scope and recovery semantics.
