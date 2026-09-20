# Platform capability walkthrough

This playground answers one question: what does a selected capability profile become
before a platform runs it?

It is a learning walkthrough, not a regression suite, scenario, experiment, or published
run. It uses the production capability catalog, context session, tool policy, and local
MCP/direct-API/OAuth fixtures. No credentials, Docker service, or external account is
needed.

## Run the local walkthrough

From the repository root:

```bash
./scripts/run_local_stack.sh
# keep this terminal open, then in another terminal:
curl http://127.0.0.1:9191/health
AGENTLAB_LOCAL_FIXTURE_URL=http://127.0.0.1:9191 \
AGENTLAB_CONTEXT_ROOT="$PWD/lab/sessions" \
pnpm --filter @agent-harness-lab/lab-server run test:platform-capability-matrix
```

Open `http://127.0.0.1:5173/platforms/temporal` and use Chat. Select a capability
profile, send a short prompt, and open the run details. Then open Compare and select
Temporal, Restate, LangGraph, and Mastra. The same profile is submitted as independent
runs; a failure or unavailable platform must remain visible instead of becoming a fake
success.

For the focused protocol and storage checks:

```bash
pnpm --filter @agent-harness-lab/lab-server run build
node --test \
  server/dist/tests/capabilities/integrations.test.js \
  server/dist/tests/capabilities/http-boundaries.test.js \
  server/dist/tests/capabilities/oauth-secret-store.test.js \
  server/dist/tests/capabilities/catalog.test.js \
  server/dist/tests/context/context-service.test.js
```

## Inspect

- `local-safe` resolves `calculator`, `fixture_lookup`, and the untrusted
  `research-summary` skill.
- the skill appears in a request snapshot as `source: "skills"`, with no authority;
  `context.json` redacts its body.
- `fixture_write` is denied until an approval matches the capability version and
  operation.
- local connection tests expose MCP request IDs, direct-API retry attempts, OAuth state
  and refresh behaviour, while keeping credentials out of results.
- `logs/operations.jsonl` contains classifications for resolution, tool execution,
  retries, unknown outcomes, and provider request IDs without prompts or tokens.

## Inspect evidence

For a completed run, inspect the run directory shown by the server configuration:

```text
lab/runs/<run-id>/
  config.json          immutable request and model configuration
  capabilities.json    redacted grants and policy decisions
  events.jsonl         ordered normalized lifecycle events
  trajectory.json      bounded model/tool trajectory
  metrics.json         usage, duration, retries, tool, approval, and unknown counts
  result.json          terminal result when the outcome is known
  logs/operations.jsonl safe operational classifications
  native/<platform>.json
```

Try one approved write, one missing approval, one cancellation, and one unavailable
fixture. Observe that denied, unknown, and reconciliation-required states remain explicit.
Restart the Lab server after dispatching a durable platform run and inspect the native
reference plus the server projection; absence of a result is not treated as success.

## Observations and limits

Observed behaviour is that the four priority runners can consume the same bounded local
profile while retaining platform-native execution identities and lifecycle events. This
does not prove equivalent durability or external-provider correctness. The local fixture
is a deterministic protocol boundary, not a social account. Real OAuth providers, remote
MCP servers, hosted secret stores, and provider quotas require separate acceptance work.

The automated tests are the durable safety net. This directory is for stepping through
the same boundaries while learning and recording observations.
