# Agent kernel

The kernel connects role-specific module contracts for one text turn. The first
Studio assembly uses Input, Memory, Context, Planning, Control, Model Interface,
Tool Use, Computer Use, Safety, Execution Environment, Output Actions, and
Observability.

## Turn flow

1. Input normalizes the submitted task. Memory recalls session-scoped records.
2. Context assembles the initial model-visible messages. Planning receives that
   context and proposes one bounded plan. Context adds the proposal as untrusted
   user-level material; it is not an instruction or permission.
3. Control owns model/action ordering and termination. It asks Context for each
   model request and receives action results before continuing.
4. Tool Use validates calls. The kernel checks Safety before dispatching through a
   scoped Environment session. Computer Use adapts its observe/action contract to
   that session and records before/after observations and verification.
5. Safety checks requested Memory writes and final output. Output Actions prepares
   and delivers the final response to a host-provided sink. A committed receipt
   means the sink accepted it; it does not claim that a browser displayed it.
6. The kernel projects accumulated inputs, decisions, module evidence, and terminal
   status to ordered protocol events and asks Observability to append and flush
   them. Cancellation remains the terminal run status and does not cancel this
   cleanup attempt.

The first Planner proposal is advisory and is not refreshed after actions. The
reference Control implementation is bounded to two model calls and one tool call.
Module errors retain the partial evidence collected before failure in
`TextTurnExecutionError`. Side effects that may have happened before an
acknowledgement was lost remain unknown; the kernel does not retry them.

## Replacing a module

The kernel consumes each selected module through its public role contract. A
contract-conforming replacement can be supplied for one role while leaving the
other module instances unchanged. The module owns its configuration and
implementation behavior; the kernel supplies run scope, cancellation, selected
capabilities, lifecycle coordination, and evidence collection.

The kernel package can be built and checked independently:

```sh
pnpm --filter @agent-harness-lab/agent-protocol build
pnpm --filter @agent-harness-lab/agent-kernel typecheck
pnpm --filter @agent-harness-lab/agent-kernel test
```

The kernel does not load arbitrary packages. The reference assembly has a static
registry of known selections. Studio's API host chooses the trusted run directory;
the browser only receives the HTTP response and safe run projection.
