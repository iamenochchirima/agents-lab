# Trigger.dev baseline semantics

## Admission

`TriggerDevBaselineRunner.start()` sends one task trigger with the Lab `runId` as
the global task idempotency key. A duplicate `start()` therefore asks Trigger.dev
for the same task identity instead of creating a second task. The adapter never
changes the key during recovery.

If the first response is ambiguous, the adapter repeats the exact request once.
If the second request is also ambiguous, it returns a reference with
`submissionOutcome: "unknown"` and the Lab result becomes
`reconciliation_required`. This is evidence of an unknown external outcome, not a
new run and not a claimed success.

## Status and result mapping

| Trigger status | Runner status | Lab result |
| --- | --- | --- |
| `PENDING_VERSION`, `QUEUED`, `DELAYED` | `queued` | no terminal result |
| `DEQUEUED`, `EXECUTING`, `WAITING` | `running` | no terminal result |
| `COMPLETED` | `completed` | task output is normalized |
| `CANCELED` | `cancelled` | cancellation error |
| `FAILED` | `failed` | task/provider failure |
| `EXPIRED`, `TIMED_OUT` | `failed` | timeout error |
| `CRASHED`, `SYSTEM_FAILURE` | `failed` | `reconciliation_required` / unknown outcome |

The task output carries task-native event intents, trajectory, and metrics. When
the task has not produced output, the adapter synthesizes only the lifecycle facts
visible from the retrieved Trigger run.

## Retries and model calls

The baseline task allows two Trigger attempts for the deterministic fake fixtures.
`fake-retry` fails on the first task attempt and succeeds on the second. OpenRouter
requests run inside the task and therefore remain subject to Trigger's task retry
boundary. A lost response is classified as an unknown provider outcome; this does
not claim that an external provider call is safe to repeat.

## Cancellation and restart

Cancellation calls Trigger's run cancellation API and is cooperative: the task's
AbortSignal is the task-side cancellation boundary. A cancellation race is reported
from the status that Trigger returns. It cannot undo a provider side effect that has
already completed.

The adapter keeps no in-flight state in memory. After a Lab-server restart, a
confirmed Trigger run can be inspected by its stored run ID. A lost admission
acknowledgement with no later confirmation remains reconciliation-required because
the run ID is not safely knowable from the client error alone.

## Limits of this baseline

- It validates local Trigger execution, not hosted scale, availability, or security.
- It does not implement tools, schedules, child tasks, or production
  deployment.
- The common server currently persists the initial execution reference; updated
  native status remains observable through the runner inspection and normalized
  evidence rather than being treated as a separate mutable native record.
