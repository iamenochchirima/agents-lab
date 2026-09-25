# Execution environment module

This module declares what an agent may access and opens a scoped session that enforces those grants. The first interface defines capability discovery, session opening, invocation, and close receipts. It does not include a filesystem, process, browser, or remote execution implementation.

## Interface

The host asks `describe()` for the environment identity and available capabilities. It then calls `openSession` with a run scope and requested grants. The result either contains a session or states whether a failed open left a resource in an uncertain state. A session exposes only its granted capabilities. Each invocation names a capability, version, operation, operation ID, JSON input, and optional idempotency key.

```ts
const opened = await environment.openSession({ scope, requestedCapabilities }, signal);
if (opened.outcome === "opened") {
  const receipt = await opened.session.invoke(invocation, signal);
  await opened.session.close();
}
```

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

Build the shared protocol package first in a fresh checkout because the emitted declarations are a package dependency.

The package contains contracts and config validation only. Later environment plans must add an honest local implementation and test resource cleanup, cancellation, capability denial, duplicate calls, and interrupted side effects.
