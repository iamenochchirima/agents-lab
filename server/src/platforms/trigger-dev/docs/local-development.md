# Trigger.dev development profiles

## Versions

The baseline pins `@trigger.dev/sdk`, the `trigger.dev` CLI, and the documented
runtime line to `4.5.14` and Node.js 22. The SDK and CLI must stay on the same
version line.

## Runtime shape

Trigger.dev development has two separate pieces:

1. A Trigger server/API that schedules and stores runs.
2. The official local task worker started by `trigger.dev dev start`.

The task worker is not an offline emulator. The server remains required, and the
task code runs locally in a separate Node process per task run.

The worker runs task code on this machine; scheduling and run state belong to the
Trigger server. Trigger.dev does not provide an offline development mode. Choose
one of the following server profiles.

## No-Docker profile: Trigger Cloud

This is the preferred profile for the Lab when Docker is unavailable. Create a
Trigger.dev development project and set these values in a local environment file
that is not committed:

```bash
TRIGGER_API_URL=https://api.trigger.dev
TRIGGER_SECRET_KEY=tr_dev_...
TRIGGER_PROJECT_REF=proj_...
OPENROUTER_API_KEY=...
AGENTLAB_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

The project reference and development secret come from the Trigger.dev project.
The Lab server uses the API URL and secret for admission and inspection; the task
worker uses the same project reference and receives provider credentials through
its own environment.

## Optional self-hosted profile

For a local Trigger server, use the official self-hosted deployment and keep the
worker in a separate process:

```bash
TRIGGER_API_URL=http://127.0.0.1:3040
TRIGGER_SECRET_KEY=tr_dev_...
TRIGGER_PROJECT_REF=proj_...
```

The official self-hosted profile is Docker Compose-based. It is not required for
the Lab and is intentionally not part of the default local stack.

`TRIGGER_SECRET_KEY` is never included in `config.json` or
`native/trigger-dev.json`.

## Start the task worker

From the repository root:

```bash
cd server/src/platforms/trigger-dev
pnpm dlx trigger@4.5.14 dev start --skip-update-check --env-file ../../../../.env
```

The command discovers `variants/baseline/execution/task.ts` through
`trigger.config.ts`. For the Cloud profile it connects the local worker to the
Trigger project; no local Trigger server is started. The task reads the OpenRouter
key from its own process environment; it is never included in the Lab run request.
If the server, Trigger credentials, or provider key is unavailable, the Lab runner
reports the failure and does not produce a fabricated completed run.

## Real integration check

With the Lab server and Trigger worker running in separate terminals, and either the
Cloud or self-hosted profile configured:

```bash
AGENTLAB_RUN_TRIGGER_DEV_INTEGRATION=1 \
  pnpm --filter @agent-harness-lab/lab-server run build && \
  AGENTLAB_RUN_TRIGGER_DEV_INTEGRATION=1 node \
    server/dist/integration-tests/trigger-dev-baseline.test.js
```

The integration test waits for the actual Trigger run to reach a terminal state,
then writes a temporary Lab evidence directory containing the normalized records.
It is skipped unless explicitly enabled so an ordinary server test run does not
pretend that Trigger infrastructure exists. This test is the acceptance gate that
remains to be run when a real Trigger credential and project are available.

## Local evidence

The runner stores only safe platform identity in `native/trigger-dev.json`:

- task identifier;
- Trigger run ID, when admission was confirmed;
- Lab run ID used as the idempotency key;
- API URL without credentials;
- submission outcome, status, attempt count, and timestamps.

Provider keys, public access tokens, request headers, and task payloads are not
written to native evidence.
