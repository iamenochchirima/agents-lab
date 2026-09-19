# Local Restate development

## Requirements

- Node.js 22 or newer.
- Dependencies installed in this platform package:

```bash
pnpm install
pnpm --filter @agent-harness-lab/lab-server run build
```

The platform package pins `@restatedev/restate-sdk` and
`@restatedev/restate-sdk-clients` to `1.17.0` and the self-contained
`@restatedev/restate-server` binary to `1.7.10`.

## Start the local dependency without Docker

Restate is distributed as a self-contained server binary. The default local path
uses that binary, so it does not require Docker, PostgreSQL, or a Restate account:

```bash
pnpm --filter @agent-harness-lab/restate-platform run dev:server
```

The command stores local Restate state in `lab/restate-native-data/` by default. Set
`AGENTLAB_RESTATE_DATA_DIR` to use another persistent local directory. Runtime state
must not be committed. The server exposes ingress on
`127.0.0.1:8080` and the Admin API/UI on `127.0.0.1:9070`.

Record the service process PID if it is started in the background. For a foreground
process, `Ctrl-C` is the normal shutdown path. Stop only the process you started; do
not delete the persistent data directory when testing replay.

Check readiness:

```bash
curl --fail http://127.0.0.1:9070/health
```

## Optional Docker profile

Docker remains useful when reproducing the pinned container profile or the
testcontainers replay suite, but it is no longer the only local path.

From the repository root:

```bash
docker compose -f server/src/platforms/restate/deployment/docker-compose.yml up -d
curl --fail http://127.0.0.1:9070/health
```

The server exposes ingress on `127.0.0.1:8080` and the Admin API/UI on
`127.0.0.1:9070`. Compose binds its persistent data to `lab/restate-data` so a
server restart can replay the journal. That directory is local runtime state and
must not be committed.

## Start and register the service

In a second terminal:

```bash
pnpm install
pnpm --filter @agent-harness-lab/lab-server run build
node --enable-source-maps server/dist/src/platforms/restate/service-entry.js
```

In a third terminal, register the host service with the local Restate server:

```bash
curl --fail --request POST \
  --url http://127.0.0.1:9070/deployments \
  --header 'content-type: application/json' \
  --data '{"uri":"http://127.0.0.1:9080"}'
```

If the Restate server is running in Docker while the service runs on the host,
register `http://host.docker.internal:9080` instead. Registration is a Restate
deployment operation; the runner reports a healthy server and an unregistered
service separately.

## Checks

Offline unit checks:

```bash
pnpm --filter @agent-harness-lab/lab-server run typecheck
pnpm --filter @agent-harness-lab/lab-server run build
cd server
node --import tsx --test tests/platforms/restate/*.test.ts
```

The real local integration test is explicit and requires the server, service, and
registration above:

```bash
cd server
AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION=1 node --import tsx --test integration-tests/restate-baseline.test.ts
```

It submits real workflows through Restate, verifies normalized evidence through the
generic HTTP contract, checks an ambiguous provider outcome, and replaces the Lab
HTTP server while a delayed workflow remains active. If Restate is unavailable, the
test fails; it does not mark an in-memory substitute as passing. The Docker-backed
replay test remains opt-in with `AGENTLAB_RUN_RESTATE_INTEGRATION=1` and requires
Docker.

To inspect a retained invocation without exposing provider data, use the invocation ID
from `native/restate.json` and request only bounded lifecycle columns:

```bash
curl --fail --request POST http://127.0.0.1:9070/query \
  --header 'content-type: application/json' \
  --data '{"query":"select id, status, completion_result, retry_count, modified_at from sys_invocation where id = '\''<invocation-id>'\''"}'
```

Use the Admin API for deployment and readiness checks:

```bash
curl --fail http://127.0.0.1:9070/health
curl --fail http://127.0.0.1:9070/deployments
```

If a dependency is unavailable, distinguish the cases in this order: Admin health,
service registration, service TCP readiness, then invocation inspection. A healthy
Admin API with no registered service is not a runnable agent. A temporary inspection
failure preserves the last Lab projection; an accepted invocation whose outcome cannot
be determined remains recovery-required.

## Rollback and disablement

To disable the baseline locally without deleting evidence, stop the Restate service and
leave the Lab server running. The platform health endpoint will report Restate as
unavailable, while completed Lab run records remain readable. Do not remove
`lab/runs/<run-id>/` or the Restate data directory when the goal is to inspect a prior
run.

For a code rollback, revert only the focused Restate commits and restart the Lab server,
service, and native Restate process. Existing evidence is versioned independently of
the service process; preserve it for comparison. A native journal created by a newer
profile must not be reused with an older binary unless the pinned Restate version is
known to support that downgrade. The safe local rollback is a new temporary data
directory plus the previous application version.

For an isolated restart exercise, use a temporary `AGENTLAB_RESTATE_DATA_DIR` and
non-default ingress, Admin API, and service ports. Stop the Restate server only after
the service has stopped accepting new work, then start the same binary with the same
data directory and register the service again. The Lab must report a retained native
execution as queued or running while the dependency is unavailable, and must reconcile
it after the Admin API and service return. A missing native execution is reported as
`reconciliation_required`; it is not converted into a successful or ordinary model
failure.

The repository includes a Docker-free replacement exercise. It allocates an isolated
Restate message-fabric port as well as isolated ingress, Admin API, service, and data
locations, then replaces the service during an active workflow and replaces both the
service and Restate server while another workflow is active:

```bash
AGENTLAB_RUN_RESTATE_NATIVE_RESTART_INTEGRATION=1 \
  pnpm --filter @agent-harness-lab/lab-server run test:restate
```

The test uses the deterministic `fake-delay` fixture so the replacement window is
reproducible. It removes its temporary data directory after the run. The fixture is
not a claim about OpenRouter exactly-once billing; provider ambiguity is covered by
the native baseline test and remains `reconciliation_required`.

## Optional OpenRouter path

Set `OPENROUTER_API_KEY` in the Lab server and Restate service environments (the
ignored `server/.env` is loaded into both by the local launcher). The server uses
it for the safe model catalog; the Restate service uses it for model completion.
It is never sent in a Lab manifest, workflow input, native reference, event, or
result. The default deterministic tests and failure exercises use the fake
provider explicitly; the Platform UI exposes only OpenRouter models.
