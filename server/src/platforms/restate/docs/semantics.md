# Restate baseline semantics

| Situation | Baseline behaviour |
| --- | --- |
| Accepted workflow submission | Retain the workflow key and invocation ID; inspect through Restate. |
| Lost submission acknowledgement | Retry/reconcile with the same workflow key; never create a second key. |
| Definite ingress rejection | Return a dispatch error to the common server. |
| Unknown submission outcome | Preserve `reconciliation_required` with `outcome_unknown`; do not report success or ordinary failure. |
| Pending or ready invocation | Map to `queued`. |
| Running, suspended, or backing-off invocation | Map to `running`. |
| Completed workflow output | Project the durable result and event intents. |
| Terminal provider failure | Return a non-retryable model failure when the provider has rejected the request. |
| Pre-dispatch retryable failure | Let the bounded Restate durable-step policy retry it. |
| Post-dispatch transport failure | Return `outcome_unknown`; retrying could duplicate a provider request. |
| Cancellation request | Send the Admin cancellation request; report terminal cancellation only after Restate confirms it. |
| Admin/ingress outage during inspection | Preserve the common server's last projection and retry later. |
| Confirmed missing workflow before retention | Mark reconciliation required, not successful and not silently deleted. |

The model/provider boundary is at-least-once under an ambiguous acknowledgement
window. Restate journal replay prevents ordinary replay from re-running a completed
`ctx.run` step, but it cannot prove whether an external provider received a request
when the response was lost.

The fake provider supports `fake-success`, `fake-delay`, `fake-failure`,
`fake-unknown`, and `fake-pre-dispatch-retry`. Unknown fake model names are
configuration failures. OpenRouter is optional and reports missing credentials as a
safe configuration failure.
