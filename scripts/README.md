# Scripts

Small, named scripts for setup, validation, experiment support, and maintenance belong here.

Scripts should state their inputs, side effects, required tools, and safe cleanup behaviour.

## Local stack

Run the local comparison stack from the repository root:

```bash
./scripts/run_local_stack.sh
```

The default command starts or reuses local Temporal, then starts native Restate and
registers its service, the LangGraph Python service, Vercel Workflows, the Lab server,
the Temporal worker, and the web app. It waits for every required local service before
printing the ready message. Each process has a separate temporary log file. Running the
launcher again stops an existing Agent Harness Lab stack on its configured ports before
starting a fresh one, including stale Temporal workers that do not own a port; an
already-running Temporal server is left alone.

The default stack covers the runnable local comparison profiles. Inngest, DBOS, and
Trigger.dev remain explicit commands because they require their own dev server,
PostgreSQL, or credentials respectively. The server's aggregate `/health` endpoint can
therefore report `degraded` while `/ready` and the priority platform health endpoints
are ready. Services can also be selected explicitly:

```bash
./scripts/run_local_stack.sh frontend
./scripts/run_local_stack.sh server
# `api` remains a compatibility alias:
./scripts/run_local_stack.sh api
./scripts/run_local_stack.sh worker
./scripts/run_local_stack.sh restate-server
./scripts/run_local_stack.sh restate
./scripts/run_local_stack.sh langgraph
./scripts/run_local_stack.sh vercel-workflows
./scripts/run_local_stack.sh check-temporal
./scripts/run_local_stack.sh --help
```

The Hatchet baseline is also available as an optional service command. It uses
Hatchet's embedded runtime by default and does not require Docker:

```bash
./scripts/run_local_stack.sh hatchet
```

The full Hatchet Compose profile is only needed when studying a separately
deployed Hatchet server; see the platform's [local-development guide](../server/src/platforms/hatchet/docs/local-development.md).

The launcher checks for installed frontend/server dependencies and prints the temporary
log directory when the stack stops. If the local LangGraph environment is missing, it
creates the ignored `server/src/platforms/langgraph/.venv` and installs the locked
requirements automatically. Set `AGENTLAB_LANGGRAPH_PYTHON` to use an already prepared
environment instead.

If a required local service fails to become ready, the launcher stops the processes it
started and points to the relevant log files instead of claiming that the stack works.

Port replacement is limited to processes whose command belongs to this repository. If
an unrelated application owns a configured port, the launcher leaves it untouched and
reports the conflict.

The launcher fails before starting if the requested web or server port is already in
use. This prevents Vite from silently moving to another port while the launcher still
reports the configured URL, which can otherwise produce stale HMR and duplicate-stack
errors in the browser.

The server and Temporal worker load `server/.env` when it exists. That file is ignored by
Git; use `server/.env.example` as the safe configuration reference. Explicit environment
variables take precedence over values in the local file.

The frontend defaults to `127.0.0.1:5173`. Override the bind address or port
without editing the script:

```bash
AGENTLAB_WEB_HOST=0.0.0.0 AGENTLAB_WEB_PORT=5174 ./scripts/run_local_stack.sh
```
