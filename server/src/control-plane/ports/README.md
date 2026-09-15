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
