# Safety module

Safety evaluates a proposed tool call, environment operation, output action, or Memory write. It returns `allow`, `deny`, or `approval-required`. It does not execute the action and does not treat an approval request as approval.

## Interface

`SafetyModule.evaluate` receives a run scope and a checkpoint with the proposed JSON action, optional capability descriptor, and evidence. It returns an evaluated decision with a stable decision ID and reason, or an explicit `unavailable` result. The host must bind any human or policy approval to the checkpoint and re-check it before execution.

```ts
const result = await safety.evaluate({ scope, checkpoint }, signal);
if (result.status === "evaluated" && result.decision.decision === "allow") {
  // The host may dispatch the action through its separate execution modules.
}
```

## Lifecycle and failure semantics

The host calls Safety before each protected side effect. Cancellation aborts evaluation; the host must not interpret cancellation as permission. An unavailable evaluator or unrecognized checkpoint must fail closed. The default config decision is `deny`; setting another fallback is an explicit policy choice. Evaluation should be read-only and safe to repeat. Safety owns no durable state, and this interface does not define an approval UI or a policy rule language.

Decisions and bounded checkpoint evidence should be recorded by the host's Observability module. The evaluator must not include secrets or hidden model reasoning in its explanation. Evidence retention and redaction are host responsibilities.

## Configuration and checks

`parseSafetyConfig` accepts `allow`, `deny`, or `approval-required` as the fallback and bounds checkpoint payload size to 1–1048576 bytes. Invalid types, values, and unknown fields are rejected.

```sh
pnpm --filter @agent-harness-lab/agent-protocol build
pnpm --filter @agent-harness-lab/module-safety build
pnpm --filter @agent-harness-lab/module-safety typecheck
pnpm --filter @agent-harness-lab/module-safety test
```

Build the shared protocol package first in a fresh checkout because the emitted declarations are a package dependency.

This package contains the interface and config parser only. A concrete policy implementation must test each checkpoint kind, fail-closed behavior, cancellation, approval expiry, and evidence redaction.
