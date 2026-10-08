# Controlled business service

This independent loopback service runs fictional release and support workflows
through real MCP/HTTP. Start with `pnpm --filter @agent-harness-lab/lab-server
dev:capability-service`. Its port is 9196; JSON state lives under
`lab/runs/.service-task/`. There are no external customer accounts or production
writes. Namespace scope is controlled fixture data, not tenant authentication.

`service.ts` preserves the Cedar release lookup/assignment contract used by older
acceptance. `support.ts` registers customer eligibility, order and policy reads,
a revision-guarded adjustment endpoint and independent state inspection. The
service owns persistence and policy checks; agent orchestration and exact-action
review remain outside it.

Support writes serialize, check revision and the cumulative 1000-cent policy
ceiling, and atomically rename their persisted record. When an Idempotency-Key is
supplied, the service records the argument digest and saved result alongside the
order. A repeat of that same operation returns its prior result, while changed
arguments under that key fail. This provider behavior is distinct from host
receipt replay. It does not authorize additional operations or guarantee exactly
once across unrelated callers.

The MCP fixture implements the selected tools-only subset. It does not establish
general third-party interoperability. Both service namespaces and reports are
inspectable generated evidence and should not be committed to source control.

See the [scenario](../../../../../lab/scenarios/business-agent/README.md) and
[package guide](../../../../../docs/guides/capability-packages.md) for controls.
