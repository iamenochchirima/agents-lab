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
pnpm --filter @agent-harness-lab/lab-server run dev
pnpm --filter @agent-harness-lab/lab-server run dev:worker
```

For the first-wave platform checks, the focused commands are:

```bash
pnpm --filter @agent-harness-lab/lab-server run test:mastra
pnpm --filter @agent-harness-lab/lab-server run test:restate
pnpm --filter @agent-harness-lab/lab-server run test:langgraph
```

The LangGraph Python service and the Restate service are started separately as
described in their platform guides. `pnpm --filter @agent-harness-lab/lab-server run dev:restate` starts the
Restate service after the server dependencies are installed.

The API defaults to `http://127.0.0.1:4318`; `/ready` reports that the Fastify
process can serve requests, while `/health` reports the connectivity of registered
runnable platforms. The browser uses `/api/platforms/<platform-id>/health` so a
single ready platform is not blocked by unrelated optional services. Configuration is documented in
[.env.example](.env.example).

The Platform UI selects real OpenRouter models through `GET /api/models`; the server
keeps the API key in its process environment and platform workers use the same local
configuration. Fake models remain available only for deterministic tests and failure
experiments. A missing OpenRouter key leaves model selection unavailable; the UI does
not silently fall back to a fake response.

Run requests may include an optional provider-neutral `capabilities.tools` object with
an explicit enabled-tool list and bounded round/call limits. The server validates its
shape and freezes it into the run manifest; each platform adapter still validates the
tool against its own native execution policy. Omitting the object preserves the
single-turn baseline defaults.

Temporal baseline runs use a server-owned multi-turn context session. The session ID is
kept in the run manifest and the canonical transcript is stored under
`AGENTLAB_CONTEXT_ROOT` (default `lab/sessions`). The model request receives a bounded
snapshot assembled from that transcript. The server resolves the selected OpenRouter
model metadata, freezes its context-window value in the run manifest, and records the
estimated token count, reserved output, safety margin, remaining budget, and compaction
revision; the UI reads this projection and never calculates it in the browser. A model
context overflow gets one changed-input recovery attempt, while an ambiguous model
outcome is never retried as if it were safe.

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

Session context is a separate state boundary:

```text
lab/sessions/<session-id>/
  session.json
  transcript.jsonl
  turns.jsonl
  context-revisions.jsonl
  snapshots/<snapshot-id>.json
```

`transcript.jsonl` is canonical and is not rewritten by compaction. Each model request
uses a versioned snapshot; old history may be summarized while the active user turn,
identity instructions, and configured recent message groups are retained. Inspect the
session files after a run to compare the canonical transcript with the request-local
context that was sent to Temporal's model activity.

## Studio comparisons

Studio is an additive module in the same Fastify process. It has its own `/api/studio/`
route namespace and evidence root; it does not create Platform Lab runs or modify
`lab/runs/`.

The first executable slice compares two or three Context Management strategies against
a fixed deterministic replay case. The documented request uses two:

```bash
curl -X POST http://127.0.0.1:4318/api/studio/comparisons \
  -H 'content-type: application/json' \
  -H 'x-idempotency-key: context-comparison-1' \
  --data '{
    "system": {"id": "neutral-agent", "version": "1"},
    "environment": {"id": "deterministic-replay", "version": "1"},
    "experiment": {
      "id": "compare-context-retention",
      "version": "1",
      "scenario": {"id": "context-old-important-fact", "version": "1"},
      "subject": {
        "component": "context-management",
        "strategies": [
          {"id": "full-history", "version": "1", "parameters": {}},
          {"id": "sliding-window", "version": "1", "parameters": {"recentMessages": "4"}}
        ]
      }
    },
    "seed": "seed-1"
  }'
```

The response contains the comparison manifest, both trial projections, retained and
omitted message IDs, and replay outputs. Repeating the same idempotency key returns the
existing comparison. Inspect durable evidence under `AGENTLAB_STUDIO_RUN_ROOT`
(default `lab/studio-runs`):

```text
lab/studio-runs/<comparison-id>/
  config.json       # fixed environment, scenario, strategy versions, seed
  events.jsonl      # ordered comparison and trial observations
  trajectory.json
  metrics.json
  result.json
  trials/<trial-id>/
    config.json
    context.json
    result.json
```

The replay model only verifies whether the fixture's required fact reached the model
boundary. Its output is harness-wiring evidence, not a model-quality benchmark. Real
provider calls, tools, sandboxing, and additional component strategies are later Studio
slices.

See the [Temporal local development guide](src/platforms/temporal/docs/local-development.md)
and the [completed implementation plan](../development/implementation-plans/completed/lab-server-temporal-baseline.md)
for the current scope and recovery semantics.
