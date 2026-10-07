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

The additive shared `progress` handler exposes workflow-owned events before a
final output exists. The workflow journals a bounded snapshot after recording
each native event: at most 256 recent events and 1 MiB of event content. Full
original events remain in the final workflow result. Progress includes a
truncation flag; its absence never means that zero work occurred.

The runner retains these native events during inspection and combines them with
an observed native cancellation if cancellation prevents the workflow from
returning an output. It does not derive model-dispatch events from administrative
status. Older deployments without the handler remain readable but cannot expose
in-flight event evidence. Register the updated service manifest after changing
handlers; re-registering the same URI needs an explicit refresh, for example
`POST /deployments` with `{"uri":"http://127.0.0.1:19080","force":true}` in an
isolated local development deployment.
