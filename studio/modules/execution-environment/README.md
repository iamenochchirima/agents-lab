# Execution environment module

This module declares what an agent may access and opens a scoped session that enforces those grants. The controlled reference implementation exposes pure in-process addition and a small accessibility-tree computer fixture. It does not include filesystem, process, real browser, network, or remote execution access.

## Interface

The host asks `describe()` for the environment identity and available capabilities. It then calls `openSession` with a run scope and requested grants. The result either contains a session or states whether a failed open left a resource in an uncertain state. A session exposes only its granted capabilities. Each invocation names a capability, version, operation, operation ID, JSON input, and optional idempotency key.

```ts
const opened = await environment.openSession({ scope, requestedCapabilities }, signal);
if (opened.outcome === "opened") {
  const receipt = await opened.session.invoke(invocation, signal);
  await opened.session.close();
}
```

## Controlled reference implementation

`createControlledReferenceExecutionEnvironment(config?)` implements two separate capabilities:

- `calculator@1.0.0`, kind `pure`, operation `add`, exported as `CALCULATOR_CAPABILITY`.
- `computer@1.0.0`, kind `computer`, operations `observe` and `click`, exported as `COMPUTER_FIXTURE_CAPABILITY`.

`createCalculatorExecutionEnvironment(config?)` remains as a compatibility factory name for existing call sites. The descriptor lists what this implementation can provide. Both the environment config and `openSession` request must grant an operation before it is usable:

```ts
const environment = createControlledReferenceExecutionEnvironment({
  allowedCapabilities: [CALCULATOR_CAPABILITY],
});
const opened = await environment.openSession({
  scope,
  requestedCapabilities: [{ id: "calculator", version: "1.0.0", operations: ["add"] }],
}, signal);
if (opened.outcome === "opened") {
  const receipt = await opened.session.invoke({
    operationId: "add-1",
    capabilityId: "calculator",
    capabilityVersion: "1.0.0",
    operation: "add",
    input: { left: 19, right: 23 },
  }, signal);
  // A successful receipt has output { sum: 42 }.
  await opened.session.close();
}
```

The `add` input must contain exactly two finite numeric fields, `left` and `right`; a non-finite sum is rejected. The computer fixture exposes one `say-hello` button. `observe` returns its controlled accessibility tree, and `click` changes only that session's in-memory page state. A fresh session starts with the button unchanged. Operation IDs and idempotency keys are tracked for the session lifetime; reusing an identifier with different input is rejected. These fixture effects do not reach a real browser or external state. The general `operationTimeoutMs` setting is not exercised by these synchronous operations; it does not simulate a slow or interruptible environment.

The config allowlist defaults to empty. `describe()` reports both supported descriptors; a capability is usable only if the config and session request both grant it. The host and Safety module must still independently check the requested operation and granted session capability.

## Lifecycle and failure semantics

The host opens a session for a run and closes it during cleanup. A close may be repeated and should return `already-closed`; it must not reopen resources. Cleanup does not reuse the aborted run signal, so an implementation applies its own bounded close timeout. Cancellation is passed with `AbortSignal` to opening and invocation. An operation rejected before it starts has outcome `rejected`. If the environment cannot tell whether an external operation completed, it returns `uncertain` and the caller must reconcile before retrying. Idempotency depends on the specific operation and environment; the interface does not promise exactly-once effects.

The initial config grants no capabilities and sets a 30 second operation timeout. `allowedCapabilities` is an explicit allowlist, not a claim that an implementation can provide those capabilities. Callers must check `describe()` and the opened session grants before dispatch.

## Configuration and checks

`parseExecutionEnvironmentConfig` rejects malformed capability descriptors, duplicate IDs or operations, unknown fields, and timeouts outside 1–300000 milliseconds.

```sh
pnpm --filter @agent-harness-lab/agent-protocol build
pnpm --filter @agent-harness-lab/module-execution-environment build
pnpm --filter @agent-harness-lab/module-execution-environment typecheck
pnpm --filter @agent-harness-lab/module-execution-environment test
```

Build the shared protocol package first in a fresh checkout because the emitted declarations are a package dependency. Tests cover capability discovery and grants, deterministic addition, the controlled computer state change, invalid operations and inputs, cancellation, identifier reuse, and close behavior. This implementation does not exercise external side effects, timeouts, or uncertain outcomes.
