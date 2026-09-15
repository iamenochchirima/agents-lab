# Local development

## Start the dependency

Use the pinned [local stack](../deployment/README.md), then create a worker token
and export it as `HATCHET_CLIENT_TOKEN`. The worker needs both the HTTP API and
gRPC addresses:

```sh
export AGENTLAB_HATCHET_API_URL='http://127.0.0.1:18080'
export AGENTLAB_HATCHET_HOST_PORT='127.0.0.1:17077'
export HATCHET_CLIENT_TOKEN='local-token'
```

## Start the worker

From `server/`, run:

```sh
npx tsx src/platforms/hatchet/service/worker-host.ts
```

The worker registers `agentlab-hatchet-baseline`, waits for Hatchet readiness,
and then remains a separate process. Stopping it while a task is queued or
running is intentional: the next inspection should show Hatchet's native
requeue/retry state rather than a fabricated Lab result.

## Run focused checks

Unit and adapter checks do not need Docker:

```sh
npx tsx --test tests/platforms/hatchet/*.test.ts
```

The full server/worker integration is opt-in because it contacts local Hatchet:

```sh
AGENTLAB_RUN_HATCHET_INTEGRATION=1 npx tsx --test integration-tests/hatchet-baseline.test.ts
```

The integration test assumes the server and a worker token are available. If
Hatchet is unavailable, it must fail as an unavailable dependency; it must not
replace the run with a fake successful result.
