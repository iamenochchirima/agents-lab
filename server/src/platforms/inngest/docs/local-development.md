# Inngest baseline local development

## Pinned dependencies

This baseline uses:

- `inngest@4.20.0` — the platform-local TypeScript SDK.
- Inngest Dev Server/CLI `v1.44.0` — the local event and function runtime.
- Node.js `>=22.13.0` — matching the Lab server runtime.

The SDK and CLI pins were checked against the official npm registry and first-party
release/tag sources on 2026-09-15. The Dev Server image is also available as
`inngest/inngest:v1.44.0` for a Docker-based setup.

## Start the two local processes

The function service must be reachable before the Dev Server registers it. Start
the service on the host first:

```bash
AGENTLAB_INNGEST_DEV_SERVER_URL=http://127.0.0.1:8288 \
AGENTLAB_INNGEST_SERVICE_URL=http://127.0.0.1:9091 \
npx --prefix server tsx server/src/platforms/inngest/service-entry.ts
```

Then, in another terminal, start the pinned Dev Server:

```bash
npx --yes inngest-cli@1.44.0 dev \
  --no-discovery \
  -u http://127.0.0.1:9091/api/inngest
```

Check readiness separately from platform health:

```bash
curl -sS http://127.0.0.1:9091/ready
curl -i http://127.0.0.1:9091/health
```

`/ready` only means the service process loaded its local store. `/health` is the
check used by the runner and is degraded until the Dev Server responds.

## Run the playground

With both processes running:

```bash
node development/playground/inngest-baseline/run.mjs
```

The playground prints the native service projection. A common Lab run and its
normalized evidence files are produced only after the primary composition owner
registers this runner in the shared server; this platform-owned change does not
edit that boundary.

The opt-in integration test uses the same topology: a function service and Dev
Server must already be running before the test dispatches events.

## Docker option

The official Dev Server documentation provides this equivalent container command:

```bash
docker run --rm -p 8288:8288 -p 8289:8289 \
  inngest/inngest:v1.44.0 \
  inngest dev -u http://host.docker.internal:9091/api/inngest
```

The local Dev Server is intended for development and comparison. The first-party
architecture notes describe its in-memory state and differences from hosted
production execution; local success must not be presented as proof of production
durability.
