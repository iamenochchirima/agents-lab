# Local fixture evaluation controls

The local fixture provides disposable lookup and write operations over HTTP. Native
workers use the existing connection and capability path. An evaluator that starts
`createLocalFixtureServer` can also inspect actual state through its returned handle.
These controls are not network administration endpoints.

Use a fresh namespace per trial, call `seed(namespace, records)`, then retain
`snapshot(namespace)` before and after execution. Snapshots contain values, lookup
and write request counts, and the number of committed idempotent writes. Repeating
the same write can increase request count without increasing committed effects.
This observation does not establish an exactly-once execution guarantee.

`failLookup(key, message, count)` injects one to three failures for a named key.
The HTTP connection returns a provider error with status 400 and the supplied
feedback. The evaluator controls fault placement; the native agent decides how to
respond. `resetNamespace(namespace)` removes only that namespace's values,
idempotency records, counts and pending lookup failures.

Namespaces accept 1–32 letters, digits, underscores or hyphens. A seed contains at
most 32 records; full keys are at most 64 characters and values at most 512.
Use synthetic data and an evaluator-owned server. These controls do not authorize
mutating another process's fixture or unrelated records.

The focused regression check is
`pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/capabilities/fixture-eval-controls.test.ts`.
It checks a recoverable lookup failure, duplicate write request accounting, and
namespace cleanup that preserves another trial.
