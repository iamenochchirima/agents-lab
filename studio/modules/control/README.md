# Control module

Control chooses the order of agent operations and decides when the model's response ends the run. The kernel composes the ports with selected Memory, Context, Planning, Model, Tool Use, Safety, Output, and Observability modules. The kernel owns run status, cancellation delivery, global time and call limits, and evidence publication.

## Initial implementation: bounded single turn

`createSingleTurnControl(config?)` implements one user task as a bounded run. It
prepares a model turn, records the response, dispatches tool calls serially, and
asks the kernel to prepare another model turn after tool results. A response with
no tool calls must contain non-empty text; Control passes it to final delivery and
records the delivery receipt. Rejected delivery is reported as `delivery-rejected`;
uncertain delivery is reported as `delivery-uncertain` and is never retried here.

Tool calls are bounded as a batch before execution. If a response exceeds the
remaining tool budget, or arrives on the last allowed model call, Control rejects
the work before executing it. An uncertain or rejected tool receipt is recorded
and stops the run before another model call. An uncertain result may already have
taken effect; a rejected result must not be treated as permission to continue as
though the requested action succeeded. A completed tool receipt is recorded
before Control requests the next model turn. Cancellation stops new port calls; it
does not undo a port operation that already completed.

This implementation is stateless and does not persist or resume runs. The
kernel-supplied `prepareModelTurn` port is responsible for incorporating prior
tool observations into the next model request. Control does not itself validate
tool arguments or authorize side effects; those remain responsibilities of the
Tool Use, Safety, and execution-environment modules.

## Interface

An implementation exposes `ControlModule.run(input, ports, signal)`. The first task shape is normalized prompt text plus a protocol `RunScope`. Control requests an explicit prepared model turn containing a model selection, messages, tool definitions, and parameters; it generates a response, dispatches each returned tool call serially, records typed observations, and delivers a final text response. The kernel adapts Context and Planning outputs into that request. `ControlResult` reports the terminal reason and local operation counts. It does not claim that the kernel accepted or durably stored evidence.

The config fixes `toolCallOrder` to `serial` and bounds the run with
`maxModelCalls` (default 4, range 1–16) and `maxToolCalls` (default 8, range
0–32). This implementation does not claim to cover parallel tool calls, a graph
scheduler, durable state, or resumption.

```ts
import { createSingleTurnControl } from "@agent-harness-lab/module-control";

const control = createSingleTurnControl({ maxModelCalls: 3, maxToolCalls: 4 });
const result = await control.run({ scope, task: { prompt: "Summarize this note" } }, ports, signal);
```

## Lifecycle and failures

The host creates the module for an assembly and calls `run` for a run. The host passes an `AbortSignal`; Control stops starting new work after it aborts and propagates it to every port call. The kernel may enforce additional global limits. A port can raise `ControlPortError` with `budget-exhausted`, `module-failed`, or `invalid-transition`; Control must not turn an exhausted budget into a successful completion. Rejected and uncertain tool results are recorded before Control raises `invalid-transition`.

Control does not perform external side effects itself. Tool and output ports may do so. A rejected or uncertain tool receipt is recorded as an observation before Control stops. A final delivery receipt of `uncertain` ends with `delivery-uncertain`; the module must not retry delivery on its own because the output may already have been committed. Port failures are not retried unless a future policy explicitly declares the operation safe to repeat.

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

The executable baseline is a small loop for one user task, with serial tools and
explicit model/tool-call bounds. More advanced Control strategies can implement
the same interface independently.

The current implementation is `bounded-single-turn-control@0.2.0` in package
version `0.3.0`. This release replaces the earlier callback-shaped model port
with explicit prepared turns, structured tool calls, and typed observations so
the same Control loop can continue after a tool result.
