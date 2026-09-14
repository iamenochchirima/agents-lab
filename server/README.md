# Lab server

The server is the control plane for Agent Harness Lab. It validates a run request,
creates the immutable Lab manifest, dispatches a registered platform runner, and
projects safe platform evidence into `lab/runs/<run-id>/`.

The first runnable path is `temporal/baseline`. It uses a local Temporal development
server and a separate worker process. The browser talks to Fastify only.

## Local start

Install dependencies, start Temporal in a separate terminal, then run the API and
worker from the repository root:

```bash
temporal server start-dev
npm --prefix server run dev
npm --prefix server run dev:worker
```

The API defaults to `http://127.0.0.1:4318`; its health endpoint reports whether
Temporal is reachable. Configuration is documented in [.env.example](.env.example).

The server may start while Temporal is unavailable so the health response can explain
the dependency failure. It does not fabricate a run result; a submission made during
that condition is retained as a failed dispatch record.

See the [Temporal local development guide](src/platforms/temporal/docs/local-development.md)
and the [active implementation plan](../development/implementation-plans/active/lab-server-temporal-baseline.md)
for the current scope and recovery semantics.
