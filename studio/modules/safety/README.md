# Safety module

Safety evaluates a proposed tool call, environment operation, output action, or
Memory write. This package includes `createAllowlistSafetyModule`, a small
stateless implementation for deterministic Studio assemblies. It permits only
explicitly configured pure tool operations, non-pure environment operations,
output action kinds, and Memory observation kinds. Every other checkpoint is
denied or returned as unavailable. It never dispatches an action, grants an
environment capability, or treats an approval request as approval.

## Calculator allowlist

`allowedToolCapabilities` contains exact capability descriptors and allowed
operations. The default list is empty, so the default implementation denies all
calls. For an allow decision, all of these must be true:

- the checkpoint kind is `tool-call`;
- the action contains a non-empty `callId` and canonical `name`, an explicit
  `capabilityOperation`, and an argument object;
- the action name is the declared capability ID plus the operation, such as
  `calculator.add`;
- the checkpoint's capability has the same ID and version as an allowlisted
  descriptor, `kind: "pure"`, and includes the named operation;
- the allowlisted descriptor itself lists that operation.

The action name is retained as evidence and must match the descriptor ID plus the
explicit operation. Safety uses `capabilityOperation` to check both the supplied
descriptor and configured grant; it does not derive the operation from the tool
name. The explicit reference rule pins capability `calculator` at version
`1.0.0` and grants only `add`.

## Other side-effect checkpoints

`allowedEnvironmentCapabilities` is separate from the pure-tool allowlist. It
accepts exact, non-pure capability descriptors. An `environment-operation`
checkpoint is allowed only when the action's explicit operation, capability ID,
version, and kind match the configured grant. This is intended for actions such
as a controlled computer click; a tool-call grant does not authorize it.

`allowedOutputActionKinds` names exact output operations such as `text-response`.
Safety validates the action ID, kind, and JSON payload before allowing the host
sink to receive it. `allowedMemoryWriteKinds` names exact observation kinds such
as `episode`. The kernel evaluates Memory policy before it calls `observe`.
All three lists default to empty, so their actions remain denied until explicitly
configured. Tool and environment capability IDs must be distinct.

```ts
import { createAllowlistSafetyModule } from "@agent-harness-lab/module-safety";

const safety = createAllowlistSafetyModule({
  allowedToolCapabilities: [{
    id: "calculator",
    version: "1.0.0",
    kind: "pure",
    operations: ["add"],
  }],
});

const result = await safety.evaluate({
  scope,
  checkpoint: {
    checkpointId: "tool-call-1",
    kind: "tool-call",
    action: {
      callId: "call-1",
      name: "calculator.add",
      capabilityOperation: "add",
      arguments: { left: 20, right: 22 },
    },
    capability: {
      id: "calculator",
      version: "1.0.0",
      kind: "pure",
      operations: ["add"],
    },
  },
}, signal);

if (result.status === "evaluated" && result.decision.decision === "allow") {
  // The host still dispatches through its separately scoped environment module.
}
```

`defaultDecision` must remain `deny` for this implementation. The package config
parser can represent other decisions for future policies, but this allowlist
implementation rejects a non-deny fallback so a miss cannot grant permission.
It does not issue approval requests. A host must stop dispatch for both `deny`
and `unavailable` results.

## Lifecycle and failure semantics

The evaluator is read-only, stateless, and safe to repeat. Its decision ID is
stable for a run and checkpoint ID pair; checkpoint IDs therefore need to identify
one proposed action within a run. The full serialized checkpoint, including
evidence, is limited by `maxCheckpointBytes` (default 32,768 bytes). An oversized,
unserializable, or unrecognized checkpoint returns `unavailable`; it never falls
through to an allow decision. Cancellation rejects with an `AbortError`.

Explanations contain policy reasons only; they do not echo action arguments or
checkpoint evidence. The host's Observability module should record the decision
and bounded evidence, with any required redaction. The allowlist does not validate
tool arguments, inspect operation purity, or confirm that the execution environment
enforces the same capability descriptor. Tool Use and the host must provide those
separate guarantees. A Memory allow decision only authorizes the specified
observation kind; Memory still enforces its own scope and write semantics. An
output allow decision is not a delivery receipt; Output Actions reports whether
the sink committed, rejected, or returned an uncertain result.

## Configuration and checks

`parseSafetyConfig` accepts `allow`, `deny`, or `approval-required` for general
policy configuration and bounds checkpoint JSON to 1–1,048,576 bytes. It accepts
up to 32 unique pure tool descriptors and 32 unique non-pure environment
descriptors, with 1–32 unique operations per descriptor. It accepts up to 32
unique output action kinds and 32 unique Memory observation kinds. IDs, versions,
and operations are limited to 128 characters. This concrete allowlist
implementation accepts only the `deny` fallback. Unknown config fields and
malformed descriptors are rejected.

```sh
pnpm --filter @agent-harness-lab/agent-protocol build
pnpm --filter @agent-harness-lab/module-safety build
pnpm --filter @agent-harness-lab/module-safety typecheck
pnpm --filter @agent-harness-lab/module-safety test
```

Build the shared protocol package first in a fresh checkout because the emitted
declarations are a package dependency.
