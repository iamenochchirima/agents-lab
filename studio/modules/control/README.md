# Control module

Control chooses the order of agent operations and decides when the model's response ends the run. The kernel composes the ports with selected Memory, Context, Planning, Model, Tool Use, Safety, Output, and Observability modules. The kernel owns run status, cancellation delivery, global time and call limits, and evidence publication.

## Interface

An implementation exposes `ControlModule.run(input, ports, signal)`. The first task shape is normalized prompt text plus a protocol `RunScope`. Control requests an explicit prepared model turn containing a model selection, messages, tool definitions, and parameters; it generates a response, dispatches each returned tool call serially, records typed observations, and delivers a final text response. The kernel adapts Context and Planning outputs into that request. `ControlResult` reports the terminal reason and local operation counts. It does not claim that the kernel accepted or durably stored evidence.

The initial config fixes `toolCallOrder` to `serial`. This keeps the first contract explicit; it does not claim to cover parallel tool calls or a graph scheduler.

```ts
const result = await control.run({ scope, task: { prompt: "Summarize this note" } }, ports, signal);
```

## Lifecycle and failures

The host creates the module for an assembly and calls `run` for a run. The host passes an `AbortSignal`; Control stops starting new work after it aborts and propagates it to every port call. The kernel enforces global limits. A port can raise `ControlPortError` with `budget-exhausted`, `module-failed`, or `invalid-transition`; Control must not turn an exhausted budget into a successful completion.

Control does not perform external side effects itself. Tool and output ports may do so. A rejected or uncertain tool receipt is recorded as an observation before Control decides whether to continue. A final delivery receipt of `uncertain` ends with `delivery-uncertain`; the module must not retry delivery on its own because the output may already have been committed. Port failures are not retried unless a future policy explicitly declares the operation safe to repeat.

The kernel records evidence and owns recovery across process restarts. This package defines no durable Control state and makes no resumability claim.

## Configuration and checks

`parseControlConfig` rejects non-object values, unknown fields, and unsupported call ordering. No external package is required beyond the shared protocol types.

```sh
pnpm --filter @agent-harness-lab/agent-protocol build
pnpm --filter @agent-harness-lab/module-control build
pnpm --filter @agent-harness-lab/module-control typecheck
pnpm --filter @agent-harness-lab/module-control test
```

Build the shared protocol package first in a fresh checkout because the emitted declarations are a package dependency.

The contract package has no executable loop implementation yet. Its check covers the public config parser; later Control plans must exercise ordering, termination, cancellation, and port failures through a concrete implementation.
