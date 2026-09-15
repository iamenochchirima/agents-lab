# Execution semantics

The task is a regular Hatchet task. Local development defaults to Hatchet
embedded mode; remote mode uses the full Hatchet server topology. The mode
changes where the engine is hosted, not the task semantics. Hatchet owns
queueing, worker assignment, task timeout enforcement, task retries, and the
durable task/run record. The Lab owns the comparable manifest and the normalized
evidence projection.

| Situation                            | Baseline behaviour                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Duplicate start                      | Hatchet status idempotency uses `input.runId`; the existing native run is returned.                       |
| Lost admission acknowledgement       | Query by Lab metadata; if no run is found, retain `reconciliation_required`.                              |
| Accepted run not visible yet         | Keep the run queued during Hatchet's short REST projection window; inspect again rather than reporting not found. |
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
- [Embedded mode](https://docs.hatchet.run/v1/embedded)
- [Local deployment modes](https://docs.hatchet.run/v1/running-locally)
- [TypeScript SDK task reference](https://docs.hatchet.run/reference/typescript/runnables)
