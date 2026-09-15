# Execution semantics

The task is a regular Hatchet task, not Hatchet embedded mode. Hatchet owns
queueing, worker assignment, task timeout enforcement, task retries, and the
durable task/run record. The Lab owns the comparable manifest and the normalized
evidence projection.

| Situation                            | Baseline behaviour                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Duplicate start                      | Hatchet status idempotency uses `input.runId`; the existing native run is returned.                       |
| Lost admission acknowledgement       | Query by Lab metadata; if no run is found, report `reconciliation_required`.                              |
| Pre-dispatch model failure           | The task throws a retryable error; Hatchet performs the configured retry.                                 |
| Provider HTTP failure                | The task returns a failed normalized result; the task itself is not blindly retried.                      |
| Provider response lost after request | Return `reconciliation_required`; no provider replay is attempted.                                        |
| Task timeout                         | Hatchet marks the task failed/timed out; inspection synthesizes a timeout error if no task output exists. |
| Cancellation                         | The runner calls Hatchet cancellation and later inspection determines the terminal result.                |
| Worker unavailable                   | The API may be reachable, but readiness is false until an active worker advertises the task.              |
| Hatchet API unavailable              | Connectivity is false; the Lab retains its last projection and does not invent a result.                  |
| Server restart                       | The common server reloads the manifest and native reference, then inspects Hatchet again.                 |

Hatchet task events are retained as normalized `hatchet` events with a local
contiguous source sequence. The original event type, worker ID, retry count, and
attempt are preserved in the event payload and native evidence. Model output is
kept in the normalized result, not copied into native identity evidence.

Useful first-party references:

- [Running a task](https://docs.hatchet.run/v1/running-your-task)
- [Workers](https://docs.hatchet.run/v1/workers)
- [Retry policies](https://docs.hatchet.run/v1/retry-policies)
- [Timeouts](https://docs.hatchet.run/v1/timeouts)
- [Cancellation](https://docs.hatchet.run/v1/cancellation)
- [Idempotency](https://docs.hatchet.run/v1/idempotency)
- [TypeScript SDK task reference](https://docs.hatchet.run/reference/typescript/runnables)
