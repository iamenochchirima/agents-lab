# Local development

## Default: embedded Hatchet

No Docker, account, worker token, or external Hatchet service is required for
the default local path. The Lab server starts Hatchet's embedded engine and
registers the baseline worker in the same Node.js process:

```sh
./scripts/run_local_stack.sh server
```

The first run downloads the pinned Hatchet embedded sidecar and initializes its
bundled Postgres. Later runs reuse the cached binary and data under
`~/.cache/agent-harness-lab/hatchet-embedded`. Set
`AGENTLAB_HATCHET_EMBEDDED_POSTGRES_DATA_DIR` to choose the local data directory
explicitly, or `AGENTLAB_HATCHET_EMBEDDED_VERSION` to pin a different compatible
engine release.

The worker-only command is also available for platform-local inspection:

From `server/`, run:

```sh
npx tsx src/platforms/hatchet/service/worker-host.ts
```

It starts its own embedded engine and registers `agentlab-hatchet-baseline`.
The normal Lab server path should be preferred when submitting Lab runs because
it owns both the runner and the embedded worker lifecycle.

## Optional: remote/full-stack Hatchet

The pinned [full local stack](../deployment/README.md) is still available when
studying a separately deployed Hatchet engine. Set the mode explicitly; the
server must not silently switch topology based on whether a token happens to be
present:

```sh
export AGENTLAB_HATCHET_RUNTIME_MODE='remote'
export AGENTLAB_HATCHET_API_URL='http://127.0.0.1:18080'
export AGENTLAB_HATCHET_HOST_PORT='127.0.0.1:17077'
export HATCHET_CLIENT_TOKEN='local-token'
```

Start the worker separately with the same variables:

```sh
npx tsx src/platforms/hatchet/service/worker-host.ts
```

## Run focused checks

Unit and adapter checks do not need Docker:

```sh
npx tsx --test tests/platforms/hatchet/*.test.ts
```

The full server/worker integration is opt-in because it starts the embedded
Hatchet engine:

```sh
AGENTLAB_RUN_HATCHET_INTEGRATION=1 npx tsx --test integration-tests/hatchet-baseline.test.ts
```

The test exercises real queueing, worker execution, status inspection, native
identity, and cleanup. If the embedded sidecar cannot start, it fails as an
unavailable dependency; it does not replace the run with a fake successful
result.

First-party references:

- [Hatchet embedded mode](https://docs.hatchet.run/v1/embedded)
- [Running Hatchet locally](https://docs.hatchet.run/v1/running-locally)
