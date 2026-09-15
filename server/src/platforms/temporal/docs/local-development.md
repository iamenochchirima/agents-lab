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
npm --prefix server run dev
npm --prefix server run dev:worker
npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5173
```

The API accepts only `fake` by default. To enable the optional provider in a
local shell, set both values before starting the API and worker:

```bash
export AGENTLAB_ALLOWED_MODEL_PROVIDERS=fake,openrouter
export OPENROUTER_API_KEY='your-local-key'
```

Do not put the key in a manifest, fixture, committed file, or browser request.

## Run and inspect a deterministic request

The Platform UI's Temporal tab starts the same request as this API example:

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
npm --prefix server run test:temporal
```

This command fails if the local Temporal profile or worker is unavailable. It
does not silently skip durable-execution tests. Offline adapter and domain tests
remain under `npm --prefix server test`.

## Stop the stack

Press `Ctrl-C` in the stack terminal. The launcher stops only the Lab processes
it started. Stop Temporal separately when finished.

The development server is not a production deployment. Production Temporal
storage, access control, worker rollout, namespace policy, and operational
monitoring remain platform deployment work.
