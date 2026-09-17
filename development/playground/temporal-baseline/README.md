# Temporal baseline recovery exercise

This exercise is for learning how one Lab run crosses the server, a
Temporal workflow, a worker, and the local evidence projection. It uses the
real baseline implementation and deterministic model fixtures. It is not part
of the automated benchmark suite.

## Question

What survives when the server or worker disappears at different points
in one model-backed run?

## Setup

From the repository root, start Temporal with persistent local history:

```bash
temporal server start-dev --db-filename /tmp/agent-harness-lab-temporal.db
```

In another terminal, start the Lab stack:

```bash
./scripts/run_local_stack.sh
```

The stack uses `default`, task queue `agentlab-temporal-baseline`, API port
`4318`, and run records under `lab/runs/`.

## Normal run

Open the Temporal platform tab in the UI, keep the `fake` provider and
`fake-success` model selected, enter a short prompt, and run it. Then inspect:

```text
lab/runs/<run-id>/config.json
lab/runs/<run-id>/events.jsonl
lab/runs/<run-id>/trajectory.json
lab/runs/<run-id>/metrics.json
lab/runs/<run-id>/result.json
lab/runs/<run-id>/native/temporal.json
```

Compare the workflow ID in `native/temporal.json` with the workflow shown in the
Temporal Web UI at `http://localhost:8233`. The Lab record is a normalized
projection; it is not a replacement for Temporal history.

## Failure and cancellation exercises

The UI starts with `fake-success`. For repeatable failure observations, submit
the equivalent API requests with one of these model names:

| Model | Expected observation |
| --- | --- |
| `fake-pre-dispatch-retry` | One `ModelFailed`, one `ModelRetryScheduled`, a second `ModelRequested`, then completion. |
| `fake-ambiguous` | One model attempt and a terminal `outcome_unknown` failure. No retry. |
| `fake-timeout` | A terminal `timeout` failure after the configured activity timeout. |
| `fake-cancel` | A running activity receives cancellation and ends with `RunCancelled`. |

The exact API shape is documented in
[`server/contracts/run-api/README.md`](../../../server/contracts/run-api/README.md).

## Controlled worker restart

1. Set `AGENTLAB_TEMPORAL_PRE_DISPATCH_RETRY_BACKOFF_MS=5000` before starting the API and worker.
2. Start a `fake-pre-dispatch-retry` run and wait until `ModelRetryScheduled` appears in the UI or `events.jsonl`.
3. Stop only the Temporal worker process. Leave Temporal and the API running.
4. Confirm that the run does not create a second workflow ID while the worker is down.
5. Start the worker again with `pnpm --filter @agent-harness-lab/lab-server run dev:worker`.
6. Wait for the retry timer to fire and the run to complete.
7. Inspect the final `events.jsonl` and `native/temporal.json`.

The expected result is the same Lab run ID and Temporal workflow ID as before
the restart, two model attempts, one `ModelRetryScheduled` event, and one
`RunCompleted` event. The worker restart is the recovery point for this
exercise. Temporal replays workflow history and resumes the timer; the Lab does
not recreate the run.

Do not use an in-flight `fake-cancel` activity for this recovery proof. Stopping
the worker while a model activity is executing creates an ambiguous provider
outcome. The baseline should fail that run as `outcome_unknown` rather than
silently replaying the request.

## Server restart

1. Start a `fake-timeout` run and note its run ID after the initial request is accepted.
2. Stop the API process while the workflow is still running.
3. Leave Temporal and the worker running until the workflow reaches its terminal state.
4. Start the API again with the same `AGENTLAB_RUN_ROOT` and Temporal profile.
5. Refresh the run in the UI or call `GET /api/runs/<run-id>`.

The API should project the retained workflow intents and terminal files. A
second status read must not duplicate events or change an existing result.

## Automated version

Run the local integration suite when Temporal and the worker are available:

```bash
pnpm --filter @agent-harness-lab/lab-server run test:temporal
```

It covers success, retry classification, ambiguous outcomes, timeout,
cancellation, complete evidence, and server reconciliation. It fails
explicitly if the local durable-execution profile is not usable.

## Record observations

Keep personal observations in `notes.md` beside this file if useful. Separate
what the files show from what you infer about Temporal. Do not commit API keys,
personal prompts, or large generated run directories.
