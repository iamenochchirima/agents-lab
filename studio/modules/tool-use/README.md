# Tool Use module

This package provides tool listing, call validation, and dispatch through an
injected executor. Tool definitions are model-facing descriptions; raw proposed
arguments remain `unknown` until validated. The first registration is
`calculator.add`, which accepts exactly two finite numeric fields, `left` and
`right`, matching the execution-environment calculator input.
The caller can inspect the validation result, ask Safety to evaluate the validated
call, then dispatch that `ValidatedToolCall` through the assembly's `ToolExecutor`.
The definition also carries the explicit capability descriptor
`{ id: "calculator", version: "1.0.0", kind: "pure", operations: ["add"] }`
and `capabilityOperation: "add"`. Safety and the execution environment can use
these fields directly without deriving identity or operation from the tool name.

```ts
import {
  createCalculatorAddToolUse,
} from "@agent-harness-lab/module-tool-use";

// The assembly supplies this executor from its selected Execution Environment.
const toolUse = createCalculatorAddToolUse({}, calculatorExecutor);
const proposal = toolUse.validate({
  callId: "call-1",
  name: "calculator.add",
  arguments: { left: 20, right: 22 },
});
if (proposal.accepted) {
  // Safety approval occurs before dispatch; scope and signal come from the run.
  const receipt = await toolUse.dispatch(proposal.call, scope, signal);
}
```

`calculator.add` is registered here; its arithmetic is performed by the injected
executor. Tool Use validates and bounds the executor's receipt but does not execute
the operation itself.

Tool Use does not authorize risk or grant environment access. The caller must run
the Safety decision before dispatch and must supply only the executor selected by
the assembly. This ordering is a caller invariant until the kernel owns composition.
Completed, failed, cancelled, timed-out, and unknown outcomes are distinct; an
unknown result after a side effect must not be retried automatically. The module
owns no durable state. Validation and dispatch have no per-turn counter: this
interface has no turn start/end lifecycle, so Control or the kernel must enforce
the assembly's call limit. `maxCallsPerTurn` was removed from Tool Use config
rather than keeping an unenforceable limit or retaining per-turn counters in an
unbounded map.

Use `parseToolUseConfig` before construction. The parser rejects unsupported fields,
non-integer values, and limits outside the declared bounds.

| Setting | Default | Accepted range |
| --- | ---: | ---: |
| `maxArgumentBytes` | 16,384 | 1–10,000,000 |
| `maxResultBytes` | 65,536 | 1–100,000,000 |
| `timeoutMs` | 30,000 | 1–3,600,000 |

Argument size is measured from the UTF-8 bytes of the validated JSON object before
and after registration normalization. Result size is measured from the UTF-8 bytes
of the complete normalized `ToolExecutionReceipt`, including output and error
details.

## Failures and side effects

Invalid proposals are returned as typed validation rejections and never reach the
executor. Dispatch revalidates the call so a caller cannot forge or mutate a
`ValidatedToolCall`. A pre-cancelled call is rejected before execution. During
execution, Tool Use passes a child `AbortSignal`; caller cancellation or timeout
aborts that signal and ends the wait. Since the executor may have started a side
effect, an in-flight cancellation, timeout, executor exception, malformed receipt,
or oversized receipt is reported as a `ToolUseError` that callers must treat as an
uncertain outcome and must not retry blindly. A valid executor receipt is returned
unchanged in meaning after validation and freezing.

```sh
pnpm --filter @agent-harness-lab/module-tool-use typecheck
pnpm --filter @agent-harness-lab/module-tool-use test
```

The package checks cover the `calculator.add` registration, strict validation,
argument and receipt limits, cancellation, timeout, and executor failures. The
baseline does not supply an execution environment or Safety policy, and the
executor remains responsible for reporting the operation's actual outcome.
