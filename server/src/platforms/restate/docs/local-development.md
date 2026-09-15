# Local Restate development

## Requirements

- Node.js 22 or newer.
- Dependencies installed in this platform package:

```bash
npm --prefix server/src/platforms/restate install
npm --prefix server run build
```

The platform package pins `@restatedev/restate-sdk` and
`@restatedev/restate-sdk-clients` to `1.17.0` and the self-contained
`@restatedev/restate-server` binary to `1.7.10`.

## Start the local dependency without Docker

Restate is distributed as a self-contained server binary. The default local path
uses that binary, so it does not require Docker, PostgreSQL, or a Restate account:

```bash
npm --prefix server/src/platforms/restate run dev:server
```

The command stores local Restate state in `lab/restate-native-data/`. That directory is
runtime state and must not be committed. The server exposes ingress on
`127.0.0.1:8080` and the Admin API/UI on `127.0.0.1:9070`.

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
npm --prefix server install
npm --prefix server run build
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
npm --prefix server run typecheck
npm --prefix server run build
cd server
node --import tsx --test tests/platforms/restate/*.test.ts
```

The real local integration test is explicit and requires the server, service, and
registration above:

```bash
cd server
AGENTLAB_RUN_RESTATE_INTEGRATION=1 node --import tsx --test integration-tests/restate-baseline.test.ts
```

It submits a real workflow through Restate, verifies normalized evidence, runs a
deterministic provider failure, and reads the completed workflow again through a
replacement runner. If Restate is unavailable, the test fails; it does not mark an
in-memory substitute as passing.

## Optional OpenRouter path

Set `OPENROUTER_API_KEY` only in the service process environment. It is never sent
in a Lab manifest, workflow input, native reference, event, or result. The default
and all tests use the deterministic fake provider.
