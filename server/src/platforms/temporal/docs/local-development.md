# Temporal local development

The first Temporal slice uses a local Temporal development server. The Lab
does not own the Temporal server lifecycle and does not use its database or Web
UI as the Lab run-record store.

## Start the dependency

Check that the CLI is installed:

```bash
temporal version
```

Start Temporal in a separate terminal:

```bash
temporal server start-dev --db-filename /tmp/agent-harness-lab-temporal.db
```

The local profile is:

| Setting | Value |
| --- | --- |
| Frontend gRPC endpoint | `localhost:7233` |
| Web UI | `http://localhost:8233` |
| Namespace | `default` |
| Task queue | `agentlab-temporal-baseline` |

The database path is deliberately outside the repository. Remove it only when
you want to discard the local Temporal history.

## Start the Lab

From the repository root:

```bash
./scripts/run_local_stack.sh
```

The launcher starts these Lab processes and checks each one:

| Process | Default address or state |
| --- | --- |
| React/Vite UI | `http://127.0.0.1:5173` |
| Fastify server | `http://127.0.0.1:4318` |
| Temporal worker | connected to the task queue above |

The launcher leaves Temporal running when the Lab processes stop. It keeps
temporary per-process logs and prints their directory on shutdown.

To start individual processes instead:

```bash
pnpm --filter @agent-harness-lab/lab-server run dev
pnpm --filter @agent-harness-lab/lab-server run dev:worker
pnpm --filter @agent-harness-lab/web run dev --host 127.0.0.1 --port 5173
```

The API accepts only `fake` by default. To enable the optional provider, copy
the values into the ignored `server/.env` file or set them in the shell before
starting the API and worker:

```bash
export AGENTLAB_ALLOWED_MODEL_PROVIDERS=fake,openrouter
export OPENROUTER_API_KEY='your-local-key'
```

Do not put the key in a manifest, fixture, committed file, or browser request.

Context sessions are stored separately from run evidence. The default is
`lab/sessions`; override it with `AGENTLAB_CONTEXT_ROOT` when running an isolated
exercise. The Platform UI keeps the returned Temporal session ID and reuses it for the
next turn. To exercise the same boundary from the shell, send the first run, copy its
`manifest.context.sessionId`, and include that value in a second request:

```bash
curl --fail --silent --show-error -X POST http://127.0.0.1:4318/api/runs \
  -H 'content-type: application/json' \
  --data '{"platform":"temporal","variant":"baseline","task":{"kind":"prompt","prompt":"Remember that the project uses a server-owned context session."},"model":{"provider":"fake","model":"fake-success","contextWindowTokens":128000}}'
```

Inspect the session after the run:

```bash
find lab/sessions/<session-id> -maxdepth 2 -type f -print
cat lab/sessions/<session-id>/transcript.jsonl
cat lab/sessions/<session-id>/context-revisions.jsonl
```

The snapshot records the request-local messages, count quality, server-resolved
context-window limit, reserved output, safety margin, pressure, and any compaction
source IDs. The canonical transcript remains intact when a summary is created.

To force a deterministic compaction exercise, use the fake model with a deliberately
small but usable window such as `6000`, complete one short turn, then send a second
turn with enough repeated fixture text to cross the 20% threshold. Reuse the first
run's `manifest.context.sessionId` in the second request. The second run should contain
`ContextPrepared` with a `compaction` record, and the session should contain the original
messages plus a new snapshot/ledger entry. This tests the policy without spending
provider tokens; it is separate from the real-provider acceptance path.

## Run and inspect a deterministic request

The Platform UI's Temporal tab starts the same request as this API example. For normal
end-to-end testing, use the browser Chat surface at
`http://127.0.0.1:5173/platforms/temporal/chat`. Select an OpenRouter model, send a
prompt, inspect the assistant response and expandable run activity, then send a
follow-up without refreshing. The page keeps the Temporal session ID and displays the
server-owned context budget when the run provides one. Use the controlled Run surface
for scenario/comparison experiments; use the API examples below for diagnostics and
deterministic fixture exercises:

```bash
curl --fail --silent --show-error \
  -X POST http://127.0.0.1:4318/api/runs \
  -H 'content-type: application/json' \
  --data '{"platform":"temporal","variant":"baseline","task":{"kind":"prompt","prompt":"Explain durable execution in one sentence."},"model":{"provider":"fake","model":"fake-success"}}'
```

Use the returned `runId` with:

```bash
curl --fail --silent --show-error http://127.0.0.1:4318/api/runs/<run-id>
curl --fail --silent --show-error http://127.0.0.1:4318/api/runs/<run-id>/evidence/events.jsonl
```

The run directory is `lab/runs/<run-id>/` when the root launcher starts the
stack. It contains the manifest, normalized events, trajectory, metrics, result,
and `native/temporal.json`.

## Run automated local integration coverage

With Temporal and the worker running, execute:

```bash
pnpm --filter @agent-harness-lab/lab-server run test:temporal
```

This command fails if the local Temporal profile or worker is unavailable. It
does not silently skip durable-execution tests. Offline adapter and domain tests
remain under `pnpm --filter @agent-harness-lab/lab-server test`.

To exercise the real Temporal workflow and activity against a deterministic local
provider boundary, run the opt-in native OpenRouter test:

```bash
AGENTLAB_RUN_TEMPORAL_NATIVE_OPENROUTER=1 \
  pnpm --filter @agent-harness-lab/lab-server exec tsx --test \
  tests/platforms/temporal/native-openrouter.test.ts
```

The test starts an isolated Temporal task queue and a local HTTP server that implements
the OpenRouter chat-completion response shape. It verifies the selected model, provider
usage, native workflow execution, normalized evidence, and secret redaction without
making an external provider request. The normal test suite leaves this check skipped
unless the flag is set.

## Stop the stack

Press `Ctrl-C` in the stack terminal. The launcher stops only the Lab processes
it started. Stop Temporal separately when finished.

The development server is not a production deployment. Production Temporal
storage, access control, worker rollout, namespace policy, and operational
monitoring remain platform deployment work.
