# Local Restate development

## Requirements

- Node.js 22 or newer.
- Docker with the Compose plugin.
- Dependencies installed in this platform package:

```bash
npm --prefix server/src/platforms/restate install
npm --prefix server run build
```

The platform package pins `@restatedev/restate-sdk` and
`@restatedev/restate-sdk-clients` to `1.17.0`. The root server package pins the same
runtime dependencies for the composed Lab server. The local server image is pinned to
`docker.restate.dev/restatedev/restate:1.7.10` in the platform Compose file.

## Start the local dependency

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

In a third terminal, register the host service with the containerized Restate
server:

```bash
curl --fail --request POST \
  --url http://127.0.0.1:9070/deployments \
  --header 'content-type: application/json' \
  --data '{"uri":"http://host.docker.internal:9080"}'
```

If the service and Restate server both run directly on the host, register
`http://127.0.0.1:9080` instead. Registration is a Restate deployment operation;
the runner reports a healthy server and an unregistered service separately.

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
