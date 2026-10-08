# Connected support adjustment

## Task and controls

A fictional customer, Avery, requests exactly 500 cents for a late-delivered order.
The agent must load the `customer-support` skill, read customer eligibility,
order state and the policy through MCP, then propose a permitted adjustment using
the current order revision. The policy ceiling is 1000 cents, not the requested
amount. The write is subject to invocation review. The agent must read the saved
order afterward and report its actual amount and revision.

Each task has a fresh `cap-...` namespace. The starting order has total 5000 cents,
no adjustments and revision 1. Successful completion produces adjustmentCents 500,
one adjustment and revision 2. The customer, total and delivery state stay unchanged.
The native platform chooses all model/tool decisions; the driver never supplies
or selects tool calls and does not preload the required skill.

## Services and authorization

The separate controlled service at loopback port 9196 owns customer/order/policy
records, persistent writes and provider-supported idempotency. It has no external
account. Its namespace identifies fictional trial data, not a production tenant.
The Lab capability host owns tool grants and exact-action review.

`server/capability-packages/customer-support.json` supplies the `support-agent`
profile through MCP reads, an HTTP operation and procedural skills. The same file
also supplies an optional external-document profile. The default business profile
continues to require no connected service.

| Interface | Behavior |
| --- | --- |
| MCP `support.customer` | Read customer eligibility |
| MCP `support.order` | Read current order and saved adjustments |
| MCP `support.policy` | Read maximum amount and eligibility constraints |
| HTTP `POST /support/adjustments` | Save a revision-guarded permitted adjustment |
| HTTP `GET /support/order` | Independent trial inspection |

An optional Idempotency-Key header enables provider-owned durable replay for the
same arguments. Changed arguments under that key are rejected. Without the header,
revision checks prevent repeating the same observed revision, but this is not a
universal exactly-once guarantee. Stale revisions and policy violations are
rejected before writes. The provider persists receipts and records together.

## Run and review policy

Start the release/support service and optional document provider. Load
`customer-support.json` in the control plane. Configure the same host credentials
and API URL for the native workers. Use the package guide for provider startup.

```sh
pnpm --filter @agent-harness-lab/lab-server dev:capability-service
pnpm --filter @agent-harness-lab/lab-server eval:capabilities -- \
  --api http://127.0.0.1:4318 --tasks support,workspace \
  --platforms mastra,langgraph,temporal,restate
```

The unattended driver has an explicit local-fixture review policy. It approves
only `support_adjust` for the assigned namespace, order-cedar, current revision 1,
reason late_delivery and exactly 500 cents, after independently observing that
no adjustment occurred. It denies a proposal outside that policy and records the
failure. This is controlled test authorization, not a production approval policy.
The report retains proposal IDs, revisions, argument digests and decisions.

The driver verifies final service state independently, named skill activation,
all three business reads, exact review and a verification read after the write.
The companion document scenario requires a report and a subsequent correction
through the external provider. Actual provider files establish its outcome.

The model must pass the existing current-catalog free-price and tool-support gate.
No paid fallback is allowed. Reports retain exact model routing, platform native
execution, prompts, budgets and failures. Eight workflow observations are not a
statistical benchmark or proof of general business competence. Deterministic
checks establish separate lifecycle and fault-boundary behavior.
