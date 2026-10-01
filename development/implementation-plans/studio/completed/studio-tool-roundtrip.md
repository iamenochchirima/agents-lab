# Studio deterministic tool round-trip

**Created:** `2026-09-25`
**Status:** Complete, 2026-09-25

## Purpose

Extend the fixed Studio chat assembly with one inspectable, deterministic tool call.
The goal is to learn whether the current role contracts can carry a model-proposed
action through validation, Safety, a scoped Execution Environment capability, and
back into Context for the next model request.

The user-provided chat screenshot shows a text message returning a deterministic
Replay response with two Context messages. That confirms the one-request path is
running. This plan adds the first action and continuation path; it does not claim to
implement a production tool system.

## User-visible outcome

From Studio, a contributor can start a named **Calculator round-trip** scenario and
inspect its complete exchange: the initial model request, proposed tool call,
Tool Use validation, Safety decision, environment invocation receipt, the next
Context request, and the final deterministic response.

The scenario uses an explicit fixture that emits one known call and a final response.
The UI labels it as a deterministic fixture. It does not infer tool calls from
free-form user text or make an LLM request.

## Entry condition

**Satisfied:** a fresh, temporary API conversation confirmed that a second turn's
Context ledger contained both previous transcript entries, and that an opted-in
Memory write was returned as a candidate to Context. The session was deleted after
inspection. This makes the current text path a checked baseline for the tool-message
work below; it does not verify API shutdown behavior.

## Proposed flow

```text
Scenario fixture prepares a task and scripted model response
  → Input normalizes the task
  → Memory recalls the session records
  → Context assembles the first model request and tool definitions
  → Control calls Model Interface
  → Tool Use validates the proposed calculator call
  → Safety evaluates the validated call before dispatch
  → Execution Environment performs one pure calculator operation
  → Control records the result and asks Context to prepare the next model request
  → Model Interface returns the fixture's final response
  → Studio returns per-request and per-action evidence to the browser
```

## Scope

- Add one Tool Use implementation with a strict schema for `calculator.add` and
  bounded input and result sizes.
- Add one Safety implementation with an explicit allow rule for this pure operation
  and a deny-by-default fallback. A denied or unavailable decision must prevent
  environment invocation.
- Add one in-process Execution Environment implementation exposing only the
  `calculator.add` capability. It must not read files, run processes, access a
  browser, or use the network.
- Extend the existing bounded Control implementation and assembly configuration to
  allow at most two model calls and one tool call for this scenario.
- Extend Context and the shared model-message representation to preserve the
  assistant tool call and its matching tool result as structured messages. Keep the
  tool-call ID, tool name, and result association intact; do not flatten them into
  uncorrelated text.
- Keep evidence for every model request and response. The current single `context`
  result is overwritten when Control prepares another request, so the round-trip
  response must retain both Context assemblies, the tool decision, and execution
  receipt.
- Add a named scenario entry to the Studio chat experience and the versioned HTTP
  contract. Keep the existing free-text Replay path clearly labeled and unchanged
  in meaning.
- Record package and implementation identities, configuration, limits, and fixture
  identity in the assembly and response evidence.

## Contract questions to settle first

- **Resolved:** shared `AgentMessage` and `AgentToolCall` protocol types represent
  assistant calls and tool-result messages. Context receives explicit
  `toolExchanges`, each pairing an assistant call with results by call ID and name.
  The exchange is required and cannot be budget-omitted on one side. On continuation,
  Context orders the current task before its assistant call and tool result.
- **Resolved:** the kernel pairs each Context result with the corresponding Model
  request and response. Control sees prepared turns and observations; it does not
  depend on Context's internal material or evidence representation.
- **Resolved:** Tool Use declares the capability and operation. The kernel verifies
  the environment advertises and grants both; Safety checks the same declaration.
  Denied and uncertain outcomes stop the run, and the kernel does not retry.
- **Resolved:** the fixed calculator model fixture belongs to the reference assembly
  package, but remains separate from the deterministic Replay adapter.

## Failure behavior and evidence

- Invalid arguments, unknown tools, Safety denial, and Safety unavailability must
  not invoke the environment capability.
- A completed calculator operation may be followed by another model request. A
  cancelled, failed, or uncertain execution must stop or follow an explicitly
  documented path; never silently dispatch it a second time.
- Reaching either call limit must produce a clear terminal error and preserve the
  exchanges that already occurred.
- Record normalized model requests and responses, tool-call validation, Safety
  decision IDs and reasons, environment receipts, cancellation, and final delivery.
- Keep the operation pure and deterministic so repeated scenario runs have the same
  expected tool result. This does not measure model quality or real-world action
  safety.

## Completion checks

- [x] Tool Use, Safety, and Execution Environment implementations build and can be
      checked independently through their package contracts.
- [x] The permitted scenario validates and executes exactly one calculator call,
      then returns a final response after the second model request.
- [x] The second Context request contains the structured assistant tool call and its
      matching tool result with source and call identity preserved.
- [x] Denied, unavailable, invalid, unknown, cancelled, and over-budget paths do not
      produce an unapproved environment invocation.
- [x] The browser evidence distinguishes every model request, tool decision, and
      execution receipt and labels the fixture as deterministic.
- [x] The simple Replay chat still makes no external model request and remains
      distinct from the scripted scenario.
- [x] API, assembly, and contributor documentation describe the selected modules,
      process-local behavior, limits, and validation results.

## Out of scope

This slice does not add a real model provider, Planning implementation, dynamic
package loading, parallel tool calls, retries, filesystem or computer-use tools,
durable run storage, a general approval UI, or a separate Output Actions or
Observability implementation. The Studio API continues to return transient evidence.

## Sequence

1. Resolve the structured assistant tool-call and matching tool-result contract.
2. Implement and independently check the Tool Use, Safety, and scoped in-process
   Execution Environment baselines.
3. Adapt Control and the kernel to validate, authorize, dispatch, record, and feed
   the tool result into the next Context request, retaining evidence for both calls.
4. Add the deterministic named scenario to the reference assembly, API, and browser.
5. Document and validate the allowed, denied, failure, cancellation, and budget
   paths before introducing a real provider or more tools. **Complete:** the
   deterministic scenario is reachable from Studio chat and the fixed API route,
   with all round-trip evidence shown in the browser.

## Validation record

- Tool Use package tests: 13 passed; Safety: 12 passed; Execution Environment: 9
  passed; Control: 5 passed; Context: 23 passed; kernel: 8 passed; Studio API: 5
  passed.
- Studio API typecheck passed, including the reference assembly and its workspace
  dependencies. The web TypeScript checks and production build passed.
- A local API request returned HTTP 200 with two model calls, one calculator call,
  the Safety allow decision, a completed environment receipt, and the final result
  `19 + 23 = 42.`. The temporary session was cleared.
- A headless Chrome run opened `/studio/chat`, started the scenario from the new
  button, displayed both Context requests and the correlated call/result, showed
  Safety and environment evidence, and cleared the chat with **New chat**.
- The ordinary API text-chat test still returns one deterministic Replay model call
  and no tool evidence. No real provider or external action was involved.
- Browser coverage used local headless Chrome against the running local stack; it
  does not cover other browsers or a real model provider.
