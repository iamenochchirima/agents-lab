# Lab server

The server coordinates Agent Harness Lab. It validates a run request, creates the
immutable Lab manifest, dispatches a registered platform runner, and projects safe
platform evidence into `lab/runs/<run-id>/`. The common server does not own a
platform's execution model. Each platform implements the runner seam in its own
directory.

The first runnable paths are `temporal/baseline`, `restate/baseline`,
`langgraph/baseline`, and `mastra/baseline`. Temporal uses a local development
server and a separate worker; Restate and LangGraph use separate platform services;
Mastra runs its direct-agent baseline in the Lab server process. The browser talks to
Fastify only. Remaining platforms stay visible in the registry as planned until their
adapters exist.

## Local start

Install dependencies, start Temporal in a separate terminal, then run the API and
worker from the repository root:

```bash
temporal server start-dev
npm --prefix server run dev
npm --prefix server run dev:worker
```

For the first-wave platform checks, the focused commands are:

```bash
npm --prefix server run test:mastra
npm --prefix server run test:restate
npm --prefix server run test:langgraph
```

The LangGraph Python service and the Restate service are started separately as
described in their platform guides. `npm --prefix server run dev:restate` starts the
Restate service after the server dependencies are installed.

The API defaults to `http://127.0.0.1:4318`; `/ready` reports that the Fastify
process can serve requests, while `/health` reports the connectivity of registered
runnable platforms. Configuration is documented in
[.env.example](.env.example).

The server may start while a platform dependency is unavailable so the health response
can explain the dependency failure. The deterministic Mastra baseline can run without
Temporal, Restate, or LangGraph. A submission made while an external platform service
is unavailable is retained as a failed dispatch record; the server does not fabricate a
run result.

Start the first-wave services independently when their native runtime is needed:

- [Restate local development](src/platforms/restate/docs/local-development.md)
- [LangGraph local service](src/platforms/langgraph/docs/README.md)
- [Mastra local development](src/platforms/mastra/docs/local-development.md)

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

The normalized files make runs comparable; the native file keeps the selected
platform's own execution identity and diagnostics:

| Lab record | Common meaning | Platform-native detail retained separately |
| --- | --- | --- |
| `config.json` | Effective safe run configuration | Platform settings captured by the selected adapter |
| `events.jsonl` | Ordered lifecycle projection | Native event payloads and source names |
| `trajectory.json`, `metrics.json`, `result.json` | Comparable execution outcome | Platform history, checkpoints, retry metadata, or provider detail |
| `native/<platform>.json` | Selected execution reference | Platform-specific identifiers needed for inspection and recovery |

The platform adapter owns native execution details. The server owns the normalized
projection and never imports platform SDK types.

See the [Temporal local development guide](src/platforms/temporal/docs/local-development.md)
and the [completed implementation plan](../development/implementation-plans/completed/lab-server-temporal-baseline.md)
for the current scope and recovery semantics.
