# Trigger.dev baseline playground

This walkthrough is for inspecting one real Trigger.dev task run. It is not a test
case and it does not replace the platform integration suite.

## Prerequisites

Run a Trigger server locally, set `TRIGGER_API_URL`, `TRIGGER_SECRET_KEY`, and
`TRIGGER_PROJECT_REF`, then start the official worker:

```bash
cd server/src/platforms/trigger-dev
npx trigger.dev@4.5.14 dev start --skip-update-check --env-file ../../../../.env
```

In a second terminal, run the explicit integration check:

```bash
AGENTLAB_RUN_TRIGGER_DEV_INTEGRATION=1 \
  npm --prefix server run build && \
  AGENTLAB_RUN_TRIGGER_DEV_INTEGRATION=1 node \
    server/dist/integration-tests/trigger-dev-baseline.test.js
```

The test creates a temporary evidence directory and removes it after assertions.
For a durable run record to inspect manually, set `AGENTLAB_RUN_ROOT` to a
dedicated local directory in the command that runs the Lab server and submit a
`trigger-dev/baseline` prompt through the server API after the primary agent has
registered this runner.

## What to inspect

1. The Trigger dashboard/server shows a task run with the stable task identifier.
2. The task payload's `runId` is also the idempotency key used by the adapter.
3. `native/trigger-dev.json` contains the Trigger run identity without a secret.
4. `events.jsonl` preserves task events and the comparable lifecycle projection.
5. `trajectory.json`, `metrics.json`, and `result.json` show what the common Lab
   projection knows, without claiming hosted or offline equivalence.

Useful fixtures are `fake-success`, `fake-retry`, `fake-provider-failure`,
`fake-slow`, and `fake-ambiguous`. Use `fake-slow` to observe cancellation; do not
interpret a cancelled run as a successful model response.
