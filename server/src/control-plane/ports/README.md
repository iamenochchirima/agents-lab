# Ports

Defines the server's small interfaces for runner clients, event storage, run
storage, artifacts, and event delivery.

The runner interface is the platform seam. An adapter supplies safe manifest
configuration and implements validation, availability, start, inspection, and
cancellation. The common server treats the returned execution reference as opaque
apart from its platform, variant, and stable execution identity.

An execution reference may contain a platform-native evidence object. That object is
for persistence and inspection. It is not a second common lifecycle model, and common
code must not branch on fields such as workflow IDs, graph checkpoints, or service
object keys.

Future platform implementations should begin with the
[platform implementation-plan template](../../../../development/implementation-plans/templates/platform-baseline.md)
and must pass the runner contract tests before they are marked runnable.

## Runner invariants

- `manifestConfiguration()` returns the safe, effective platform settings captured
  in the immutable run manifest. It must not contain credentials or raw provider
  headers.
- `start()` must use the manifest's stable run identity. If the platform can lose a
  start acknowledgement, the adapter must define whether repeating `start()` is safe
  and how it finds the existing execution.
- `inspect()` is the source of lifecycle reconciliation. A temporary platform outage
  must be reported as unavailable to the caller; it must not be converted into a
  fabricated terminal result.
- `cancel()` is an explicit platform operation. Adapters must report whether a
  request was accepted or the execution was already terminal, including races with
  completion.
- `PlatformExecutionReference` is opaque to common code. The adapter owns the
  interpretation of `native` fields after restart, cancellation, and inspection.
