# Hatchet baseline architecture

The baseline is one Hatchet standalone task. The Lab server submits the task;
the Hatchet engine persists and schedules it; a TypeScript worker executes the
task; the runner inspects the task and projects its result into Lab evidence.
In the default local mode, the embedded Hatchet engine and worker are started
inside the Lab server process. Remote mode keeps the engine and worker as
separate services for a full deployment topology.

```text
Lab run manifest
  -> HatchetBaselineRunner.runNoWait()
  -> Hatchet API / embedded or remote engine / PostgreSQL
  -> Hatchet worker
  -> model adapter
  -> Hatchet run details
  -> normalized Lab records + native/hatchet.json
```

Ownership is intentionally split:

- `runner-adapter/hatchet-runner.ts` owns admission, reconciliation, inspection,
  cancellation, and safe native references.
- `service/worker-host.ts` owns engine selection, worker lifecycle, and task
  registration. Embedded mode is an in-process application boundary around a
  Hatchet sidecar; it is not a fake scheduler.
- `variants/baseline/execution/task.ts` owns the task's model call and normalized
  task output.
- `variants/baseline/models/` owns fake and OpenRouter provider behaviour.
- the common evidence store remains the only writer of `lab/runs/<run-id>`.

The Lab `executionId` is always `hatchet:<runId>`. Hatchet workflow/task IDs,
worker IDs, attempts, retries, and native status are stored under `native` and
are not substituted for the Lab identity.

The task uses Hatchet's status-based idempotency with `input.runId`. This keeps a
duplicate admission attached to the existing run until it reaches a terminal
state, subject to the configured fallback TTL. A transport failure after
submission produces a stable reference with unknown acknowledgement; inspection
queries Hatchet before any retry is considered.
