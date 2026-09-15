# Inngest platform

This directory contains the Lab's TypeScript Inngest baseline. It is a real
event-driven function service behind the generic runner seam, not a simulation of a
completed run.

## Boundary

```text
Lab runner adapter
  -> Inngest service HTTP boundary
      -> official `inngest@4.20.0` client
          -> Inngest Dev Server v1.44.0
              -> /api/inngest function endpoint
                  -> durable `step.run()` model operation
```

The service owns the Inngest client and function definitions. The runner owns only
the HTTP adapter and translates the service's safe native projection into the Lab
runner contract. The common evidence store remains the writer of
`lab/runs/<run-id>/` after shared registration is added by the composition owner.

## Local operation

Install the platform-local SDK dependency:

```bash
npm install --prefix server/src/platforms/inngest
```

Start the platform service first so the Dev Server can register its function
endpoint. The version is pinned for this baseline rather than using `latest`:

```bash
AGENTLAB_INNGEST_DEV_SERVER_URL=http://127.0.0.1:8288 \
AGENTLAB_INNGEST_SERVICE_URL=http://127.0.0.1:9091 \
npx --prefix server tsx server/src/platforms/inngest/service-entry.ts
```

In another terminal, start the official Dev Server:

```bash
npx --yes inngest-cli@1.44.0 dev \
  --no-discovery \
  -u http://127.0.0.1:9091/api/inngest
```

The Dev Server UI is available at `http://127.0.0.1:8288`.

The service exposes:

| Endpoint | Purpose |
| --- | --- |
| `GET /ready` | Process readiness; does not claim the Dev Server is reachable. |
| `GET /health` | Reports service and Dev Server reachability. |
| `GET /api/inngest` | Official SDK function registration/execution endpoint. |
| `POST /runs/admit` | Creates an idempotent local projection before event dispatch. |
| `POST /runs/:runId/dispatch` | Sends the stable-id event to Inngest. |
| `GET /runs/:runId` | Returns safe native status and event projection. |
| `POST /runs/:runId/cancel` | Sends the matching cancellation event. |

The service and Dev Server are separate processes. Start them in the order above;
with `--no-discovery`, the Dev Server must be able to register the endpoint before
events are dispatched.

## Baseline semantics

- The event ID is `agentlab:run:<run-id>`. Inngest documents event-ID deduplication
  for 24 hours; it is not a permanent Lab execution identity.
- The function uses an explicit `step.run("model-request-<run-id>", ...)` boundary.
  Inngest may replay a step after a lost acknowledgement, so the fake model and
  local projection are idempotent. No exactly-once provider-call claim is made.
- `fake-retry` throws only before model dispatch on its first attempt, allowing
  Inngest's configured retry policy to demonstrate safe retry. `fake-failure`,
  `fake-unknown`, `fake-delay`, `fake-wait`, and `fake-success` make other states
  deterministic.
- Cancellation is event-based with `cancelOn`. Inngest cancels between step
  boundaries; a currently executing step is allowed to finish. The cancellation
  projection is recorded by the `inngest/function.cancelled` handler.
- The service persists only safe run metadata, status, event intents, trajectory,
  metrics, and result. Prompts, API keys, provider headers, and raw provider
  responses are not written to native state.
- A send or cancellation acknowledgement can be unknown. Repeating the operation
  reuses the same event ID; the service never fabricates a successful result.

## Layout

- `runner-adapter/inngest-runner.ts` — generic runner boundary and reconciliation.
- `service/platform-service.ts` — Inngest client, function host, and HTTP controls.
- `variants/baseline/store.ts` — atomic local native projection.
- `variants/baseline/models/` — deterministic fake and explicit OpenRouter adapters.
- `variants/baseline/contracts.ts` — platform-local wire and native-state types.
- `docs/` — local operation and semantic limits.

## First-party references

- [TypeScript SDK v4 `createFunction`](https://www.inngest.com/docs/reference/typescript/v4/functions/create)
- [Sending events](https://www.inngest.com/docs/events)
- [Event idempotency](https://www.inngest.com/docs/guides/handling-idempotency)
- [Function cancellation](https://www.inngest.com/docs/features/inngest-functions/cancellation)
- [SDK environment variables](https://www.inngest.com/docs/sdk/environment-variables)
- [Local development](https://www.inngest.com/docs/local-development)
- [Dev Server architecture and production differences](https://github.com/inngest/inngest/blob/main/docs/DEVSERVER_ARCHITECTURE.md)
- [`inngest-js` package releases](https://github.com/inngest/inngest-js/releases)
- [Inngest Dev Server Docker tags](https://hub.docker.com/r/inngest/inngest/tags)
