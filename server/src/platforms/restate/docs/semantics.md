# Restate baseline semantics

| Situation | Baseline behaviour |
| --- | --- |
| Accepted workflow submission | Retain the workflow key and invocation ID; inspect through Restate. |
| Accepted submission but native reference persistence fails | Keep the run queued and mark the projection stale; never convert an already accepted platform execution into `DISPATCH_FAILED`. If the reference cannot later be recovered, require explicit reconciliation. |
| Lost submission acknowledgement | Retry/reconcile with the same workflow key; never create a second key. |
| Definite ingress rejection | Return a dispatch error to the common server. |
| Unknown submission outcome | Preserve `reconciliation_required` with `outcome_unknown`; do not report success or ordinary failure. |
| Pending or ready invocation | Map to `queued`. |
| Running, suspended, or backing-off invocation | Map to `running`. |
| Completed workflow output | Project the durable result and event intents. |
| Completed invocation with `completion_result=failure` | Map the native terminal failure to `failed`, not `completed`. |
| Text-only model response | Record `ModelCompleted`, then `AgentCompleted` and `RunCompleted` without a tool step. |
| Structured calculator call | Validate and authorize the call, execute it in a named durable action, append a matching tool message, then request the next model round. |
| Invalid or unknown tool call | Record `ToolCallRejected` and append a bounded tool-role error when the call ID can be paired; unsafe provider call identity fails the run closed. |
| Duplicate tool-call ID in one response | Reject the response before any execution and fail with `INVALID_TOOL_CALL_RESPONSE`. |
| Tool execution timeout/failure | Record one terminal tool execution event, append its bounded error result, and fail the run without continuing the model loop. |
| Tool round/call limit | Record the limit failure and stop; no unbounded model/tool loop is allowed. |
| Context usage observation | Record the provider-reported input usage and configured model window after each model response; this is a run projection, not canonical session compaction. |
| Terminal provider failure | Return a non-retryable model failure when the provider has rejected the request. |
| Pre-dispatch retryable failure | Record a `ModelRetryScheduled` event and issue the next numbered model action. The retry is safe because the adapter has not sent a provider request. |
| Post-dispatch transport failure | Return `outcome_unknown`; retrying could duplicate a provider request. |
| Cancellation request | Send the Admin cancellation request; report terminal cancellation only after Restate confirms it. |
| Cancelled workflow output | Restate may expose cancellation as a terminal HTTP 409 (`Cancelled`) while the invocation row is `completed` with a failure outcome; map that native combination to one normalized `cancelled` result and stable cancellation events. |
| Admin/ingress outage during inspection | Preserve the common server's last projection and retry later. |
| Temporary evidence write outage | Return the last readable run view with `projection.state=stale`; do not fabricate a terminal result. |
| Confirmed missing workflow before retention | Mark reconciliation required, not successful and not silently deleted. |
| Confirmed terminal result after native retention | Serve the retained Lab result without re-inspecting a purged native workflow. |

The model/provider boundary is at-least-once under an ambiguous acknowledgement
window. Restate journal replay prevents ordinary replay from re-running a completed
`ctx.run` step, but it cannot prove whether an external provider received a request
when the response was lost.

The fake provider supports `fake-success`, `fake-delay`, `fake-failure`,
`fake-unknown`, `fake-pre-dispatch-retry`, `fake-pre-dispatch-retry-once`, `fake-tool-call`,
`fake-tool-malformed`, `fake-tool-unknown`, `fake-tool-duplicate`, `fake-tool-loop`,
and `fake-tool-call-delay`. Unknown fake model names are configuration failures. OpenRouter
uses the same provider-neutral messages and tool definition, and reports missing
credentials as a safe configuration failure.

`fake-delay` waits five seconds and remains abortable. It exists so cancellation
can be observed through the native Restate Admin API and the browser playground.
`fake-tool-call-delay` runs the normal calculator first round, then waits fifteen
seconds before its continuation model request. It is reserved for controlled
service interruption and recovery exercises; it is not a production model
provider.

Model actions use names such as `model.request.<round>.attempt.<attempt>` so
safe pre-dispatch retries are individually journaled and visible in evidence.
The model request is at-least-once across an ambiguous provider acknowledgement
window. Restate prevents ordinary replay from re-running a completed durable
action, but it cannot prove whether OpenRouter received a request when the
response was lost.
