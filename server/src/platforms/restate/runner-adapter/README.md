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

## Readiness and terminal observations

Readiness checks the Admin API's current service binding and its deployment URI,
then reads that endpoint's `/discover` manifest within the configured HTTP timeout.
The manifest must declare `AgentLabBaselineWorkflow`. The installed SDK uses HTTP/2;
the probe closes its connection on completion or timeout. An older deployment at
the configured URI cannot make a different current binding ready. When older Admin
responses lack the binding, the highest declared service revision is used; missing
URI information remains explicitly unverified rather than ready. Discovery is
read-only and does not start a workflow or call a model.

If output retrieval rejects, inspection still asks Admin for the invocation state.
A confirmed terminal native failure produces `RESTATE_NATIVE_TERMINAL_FAILURE`
while retaining available workflow progress. An unavailable Admin API, nonterminal
state or transport error alone cannot establish failure. Cancellation wording in a
transport exception cannot establish cancellation either; the native cancelled
state or a terminal SDK cancellation response must confirm it.

At the common HTTP boundary, a thrown cancellation exception returns 503 with
`RUN_CANCELLATION_UNCONFIRMED` and retains a `RunCancellationUnconfirmed` event.
The existing run status and result remain unchanged until inspection observes a
terminal state. The public response and event exclude private native error bodies;
this response does not establish whether cancellation took effect.
