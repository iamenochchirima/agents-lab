# Scripts

Small, named scripts for setup, validation, experiment support, and maintenance belong here.

Scripts should state their inputs, side effects, required tools, and safe cleanup behaviour.

## Local stack

Run the local UI, Lab server, and Temporal worker from the repository root. Start
Temporal separately first:

```bash
temporal server start-dev
./scripts/run_local_stack.sh
```

The launcher checks Temporal, starts each Lab process with separate temporary logs,
waits for the server, web app, and worker readiness checks, and stops only the processes
it started when interrupted. Temporal remains separately managed. Services can also be
selected explicitly:

```bash
./scripts/run_local_stack.sh frontend
./scripts/run_local_stack.sh server
# `api` remains a compatibility alias:
./scripts/run_local_stack.sh api
./scripts/run_local_stack.sh worker
./scripts/run_local_stack.sh check-temporal
./scripts/run_local_stack.sh --help
```

The launcher checks for installed frontend/server dependencies and prints the temporary
log directory when the stack stops. If Temporal is unavailable, it exits with the exact
local start command instead of starting a non-functional worker.

The frontend defaults to `127.0.0.1:5173`. Override the bind address or port
without editing the script:

```bash
AGENTLAB_WEB_HOST=0.0.0.0 AGENTLAB_WEB_PORT=5174 ./scripts/run_local_stack.sh
```
