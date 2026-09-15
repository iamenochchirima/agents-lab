# Execution semantics

The baseline is one AWS Step Functions **Standard** execution per Lab run. A
state machine contains one Activity task. The platform-owned worker receives a
task token, performs the model call, and reports success or failure with the
token APIs. The common server owns the normalized manifest and evidence
projection; it does not interpret the AWS history directly.

| Situation | Baseline behaviour |
| --- | --- |
| Native identity | `executionName` is deterministic from `runId` and the native `executionArn` is retained. The common `executionId` remains `aws-step-functions:<runId>` and is intentionally different. |
| Duplicate start | Standard `StartExecution` idempotency is reconciled by deterministic execution name and canonicalized input. Same input returns `already_accepted`; different input is a conflict. |
| Lost start acknowledgement | The runner retains an unknown submission. Inspection searches the deterministic native identity; no success or failure is invented. If no matching execution is visible, the result is `reconciliation_required` with `outcome_unknown`. |
| Native ARN returned but not inspectable | The ARN is retained and the result remains `reconciliation_required`, so a later inspection can retry the same native execution. |
| Provider failure | The Activity reports a structured failure. Only failures marked retryable match the ASL retry policy. |
| Activity timeout | Step Functions owns the timeout. The model timeout is bounded below the Activity timeout, and the native timeout status is mapped to a normalized timeout failure. |
| Cancellation | The platform calls `StopExecution`; completion is asynchronous and later inspection maps `ABORTED` to `cancelled`. |
| Service/emulator outage | Inspection reports unavailable transport to the caller. The common server retains its last durable projection rather than fabricating a terminal result. |
| Restart | The state machine and execution identity are resolved again from retained configuration/reference. Native history is re-read and event intents are deduplicated by the common evidence store. |
| Orphan execution | A visible execution is only matched by the deterministic state-machine ARN and execution name. No unrelated execution is adopted. |

Step Functions Local does not establish hosted AWS guarantees. AWS documents
the emulator as unsupported and not feature-complete, so local observations are
kept separate from hosted validation. Express is intentionally not included:
its execution, cancellation, and inspection semantics differ from this Standard
baseline.

Useful first-party references:

- [Step Functions workflow types](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)
- [`StartExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html)
- [`DescribeExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_DescribeExecution.html)
- [`GetExecutionHistory`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_GetExecutionHistory.html)
- [`StopExecution`](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StopExecution.html)
- [Error handling and retry](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
