# Restate runner adapter

`RestateBaselineRunner` implements the Lab `PlatformRunner` port without exposing
Restate SDK types to the common server. It uses the workflow key as the durable
reconciliation identity and retains the invocation ID when Restate supplies one.

The adapter deliberately distinguishes:

- a definite validation or connection failure;
- an accepted or already-accepted workflow submission;
- an ambiguous submission acknowledgement that must be reconciled by workflow key;
- a temporary inspection outage, which must not become a fabricated run failure.

See [semantics](../docs/semantics.md) for the native reference and status rules.
