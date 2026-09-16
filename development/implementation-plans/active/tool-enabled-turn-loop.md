# Tool-enabled turn loop

**Created:** `2026-09-16T13:37:32+02:00`
**Last updated:** `2026-09-16T19:12:18+02:00`
**Status:** Active
**Owner:** Agent Harness Lab

## Start here

Read these before changing code:

- [`AGENTS.md`](../../../AGENTS.md)
- [`docs/contributing/documentation.md`](../../../docs/contributing/documentation.md)
- [`development/implementation-plans/TEMPLATE.md`](../TEMPLATE.md)
- [`server/src/capabilities/tools/README.md`](../../../server/src/capabilities/tools/README.md)
- [`server/src/control-plane/ports/runner.ts`](../../../server/src/control-plane/ports/runner.ts)
- [`server/src/control-plane/application/evidence-store.ts`](../../../server/src/control-plane/application/evidence-store.ts)
- [`server/src/platforms/restate/docs/semantics.md`](../../../server/src/platforms/restate/docs/semantics.md)
- [`server/src/platforms/restate/variants/baseline/README.md`](../../../server/src/platforms/restate/variants/baseline/README.md)
- [`docs/research/tool-execution-reference.md`](../../../docs/research/tool-execution-reference.md)

Reference implementations, inspected for behaviour rather than copied literally:

- Hermes: `/home/enoch/aworkspace/agents/hermes-agent/agent/turn_tool_round.py`, `agent/turn_tool_validation.py`, and `agent/tool_executor.py`
- OpenClaw: `/home/enoch/aworkspace/agents/openclaw/docs/concepts/context.md`, `docs/gateway/tools-invoke-http-api.md`, `src/agents/agent-tools.before-tool-call.policy.ts`, and `src/agents/embedded-agent-tool-results.ts`
- Waku: `/home/enoch/aworkspace/agents/waku-agent/waku/loop/agent.py`, `waku/tools/registry.py`, `waku/app.py`, and `evals/deterministic/test_tool_trigger.py`

The existing Lab decision to preserve platform-specific execution remains in force. The shared layer defines common meaning. Restate owns durable execution of its loop. The first slice must not turn the common server into a framework-specific agent runtime.

## Purpose

Add the first real tool-enabled agent turn to the platform side. A browser user will submit a prompt to the Restate baseline, the selected model may request a safe calculator tool, the platform will validate and execute that call as durable work, feed the result back to the model, and return a final answer with inspectable events, trajectory, metrics, and context usage.

This slice answers a concrete question: can the Lab execute and explain one complete model → tool → model cycle with production-grade lifecycle and failure semantics, without pretending that high-risk tools are ready?

## Definition of done

The finished browser flow is:

```text
Platform Chat → Restate baseline → OpenRouter or deterministic tool-call fixture
  → validated calculator call → durable tool result → final model answer
  → browser tool activity/context meter + lab/runs/<run-id> evidence
```

The flow is real when:

- the model request contains the calculator schema;
- a tool-call response is parsed into a provider-neutral call with a stable ID;
- invalid names and arguments are rejected before execution;
- the calculator executes through a named Restate durable step;
- the matching tool result is included in the next model request;
- a no-tool response completes without an extra tool round;
- the browser shows the tool lifecycle and final answer from server state;
- the run directory contains ordered lifecycle events, a trajectory, metrics, and result; one-shot Restate records context usage in events/run projection, while a canonical `context.json` is written only for a session-owning platform;
- tests prove the same behaviour with a deterministic model and a real local Restate service.

## Scope

- [x] Define a provider-neutral tool contract and registry for schemas, call identity, validation, policy decisions, execution results, and lifecycle events.
- [x] Add one safe, deterministic `calculator` tool with a strict JSON input schema and bounded output.
- [x] Extend the Restate baseline model contract to support assistant tool calls and matching tool results, while preserving text-only completion.
- [x] Implement the Restate model/tool loop with explicit round and tool-call limits.
- [x] Make model requests and tool executions observable through normalized Lab events and native Restate evidence.
- [x] Preserve provider-reported context accounting across tool rounds and expose the latest request usage in the existing browser chat panel. Canonical session context/compaction remains a separate platform integration step.
- [x] Render tool activity in the browser without exposing secrets or implying success before the server records it.
- [x] Add unit, platform integration, and failure/recovery coverage. Browser acceptance remains an operational gate.
- [x] Update platform and capability documentation, the playground walkthrough, and the active plan as implementation progresses.

## Explicitly out of scope

- Shell, arbitrary subprocesses, filesystem writes/deletes, browser automation, VM/container execution, or remote computer actions.
- MCP transport, OAuth, direct social/API connectors, plugins, skills, subagents, human approval UI, or scheduled delivery.
- Parallel tool execution. The contract may carry a batch, but the first implementation executes one validated calculator call at a time so ordering and evidence are easy to inspect.
- A generic cross-platform execution engine. Temporal, LangGraph, Mastra, and Vercel adapters get their own follow-up plans after the Restate contract is proven.
- Automatic retries of an OpenRouter request after the provider request was sent and the acknowledgement is ambiguous.
- Streaming token delivery. Tool lifecycle events are visible after they are durably observed; streaming can use the same event contract later.

Do not add placeholder versions of these features to make the UI look complete. Keep them unavailable and say so in the relevant documentation.

## Design decisions

### The first tool

Use `calculator` because it proves schema validation, model tool-call parsing, tool-result serialization, the second model request, lifecycle events, context accounting, and the Restate durable-step seam without creating an external side effect. It should accept a small expression form or an explicitly structured operation, not JavaScript, `eval`, shell syntax, or arbitrary code.

The implementation must reject division by zero, unknown operations, non-finite values, extra properties, oversized input, and oversized output. The model receives a safe error result for a rejected call when the protocol can continue. The run fails with a classified error when the call cannot be represented safely.

### The shared seam

Keep the shared interface small and deep. Callers should not know how a platform journals, retries, or cancels a tool.

Proposed provider-neutral types under `server/src/capabilities/tools/`:

```text
ToolDefinition
  name, description, inputSchema, riskClass, executionKind, limits

ToolCall
  toolCallId, name, arguments, round

ToolValidation
  accepted | rejected, normalizedArguments, code, message

ToolPolicyDecision
  allow | deny, code, message, requiresApproval=false

ToolExecutionResult
  status, content, error, durationMs, attemptCount
```

The registry exposes definitions and resolves an allowlisted name. It does not know about Restate, Temporal, HTTP, OpenRouter, or the browser. The calculator implementation is registered by the platform adapter, while the adapter owns execution context, deadlines, abort signals, retries, and the durable call boundary.

Do not add an abstraction merely because a future platform might need it. Add only the provider-neutral information required by the Restate slice and the normalized evidence contract. A second platform adapter can deepen the seam later.

### The model/tool loop

For each round:

1. Assemble the current context snapshot and the enabled calculator definition.
2. Call the selected model through the platform model adapter.
3. Normalize a text-only response or a response containing tool calls.
4. Validate each call ID, name, argument object, schema, size, and round budget.
5. Apply the deny-by-default policy. The calculator is allowed because the run manifest explicitly enables it and its risk class is `pure`.
6. Record `ToolCallRequested`, `ToolCallValidated`, or `ToolCallRejected` in the platform result.
7. Execute the accepted calculator call through a named Restate durable step.
8. Record `ToolExecutionStarted` and exactly one terminal `ToolExecutionCompleted`, `ToolExecutionFailed`, or `ToolExecutionCancelled` event for that call.
9. Append the assistant tool call and matching tool result to the next model input.
10. Continue until the model returns final text, the round limit is reached, the context service requires compaction/recovery, or a terminal failure occurs.

Every assistant tool call must have one matching tool result, including a rejected or failed call. The loop must never send a user-role message where the provider protocol requires a tool result. Duplicate call IDs in one response are rejected before execution. A repeated durable step is safe only because its name and input are stable and Restate journals completed steps. This is not an exactly-once guarantee for external providers.

### Restate placement

Keep Restate-specific implementation under:

```text
server/src/platforms/restate/variants/baseline/
  contracts.ts
  workflow.ts
  models/
```

The shared definitions and calculator remain under
`server/src/capabilities/tools/`. The Restate workflow constructs a registry
from the explicitly enabled names and invokes the registry only inside its
durable tool step. The workflow may assemble deterministic values and inspect
durable results, but it must not make provider network calls, read mutable
process state, or run external tools directly. Each model request is a named
`ctx.run` step. Each calculator call is a separate named `ctx.run` step using a
stable sanitized call identity. The workflow passes the current message list
and enabled definitions into the model step and receives a serializable result.
Safe pre-dispatch retries use separate names such as
`model.request.<round>.attempt.<attempt>` so the attempt sequence is durable and
visible rather than hidden inside an opaque SDK retry counter.

## Finished behaviour

### User-visible behaviour

On a successful calculator prompt, the browser shows:

- the user message;
- a compact tool activity entry with the calculator name and status;
- the final assistant answer;
- the context window meter updated from the server projection;
- run details that identify the model rounds and tool count.

On rejection or failure, the browser shows the classified error and leaves the run inspectable. It must not show a successful answer when the final run result is failed, cancelled, or reconciliation-required.

On cancellation, the UI shows cancellation after the platform confirms it. An in-flight external model request may remain outcome-unknown if the provider acknowledgement was lost. The browser must not silently retry it.

### Ownership and boundaries

```text
capabilities/tools       → definitions, safe validation, policy vocabulary
platform/restate         → model/tool loop and Restate durable-step execution
platform model adapter   → provider wire format and provider outcome classification
Lab server               → run manifest, normalized evidence, context projection, HTTP reads
Platform Chat            → renders server state; never executes tools or calculates usage
```

- `RunEvidenceStore` remains the sole writer for `lab/runs/<run-id>/` normalized files.
- The Restate workflow is the sole owner of in-flight platform execution and native workflow state.
- The model adapter is the sole owner of OpenRouter request/response translation and provider request identity.
- The browser reads run views and events. It must not derive terminal state from a local optimistic placeholder.
- No Restate SDK type may leak into `server/src/capabilities/tools/` or the common run domain.

## State, persistence, and evidence

The common Lab evidence remains:

```text
lab/runs/<run-id>/
  config.json       # immutable manifest, including enabled tool names and limits
  events.jsonl      # ordered normalized control and platform/tool lifecycle events
  trajectory.json   # model/tool round phases
  metrics.json      # model calls, tool calls, attempts, tokens, duration
  result.json       # terminal output/error and usage
  context.json      # canonical session snapshot when the platform owns one
  native/restate.json # Restate workflow and invocation identity
```

The run manifest must record the selected tool set, tool contract/schema version, round limit, tool-call limit, per-tool timeout, and redaction policy version. It must not record API keys or raw authorization headers. Restate's current one-shot baseline has no canonical session snapshot, so it records `ContextUsageObserved` events and exposes a run-level request projection instead of manufacturing `context.json`; the file is required only when a platform owns a persisted context session.

The platform result may carry framework-native event intents, but the common server owns projection into `events.jsonl`. Event identities must be `${runId}:${source}:${sourceSequence}` or an equivalent stable identity. Replaying inspection must return the same event content for the same identity. Out-of-order source sequences remain an error, not an invitation to reorder silently.

Write order for a tool call:

1. persist the model response/tool-call intent in the Restate journal;
2. record validation and policy outcome;
3. run the tool step;
4. persist the serializable tool result in the journal;
5. return the tool result to the workflow;
6. project normalized evidence in the Lab server.

The tool result sent to the model is bounded and redacted. The full calculator result is safe to retain, but the generic contract must support redacted summaries and a result reference for future tools.

## Failure, retry, and recovery semantics

- [x] Model calls use the existing provider outcome classification. Missing credentials and invalid responses fail as configuration/provider errors. A transport failure after request dispatch becomes `outcome_unknown` and is never retried as if no request was sent.
- [x] Pre-dispatch failures use a bounded, numbered durable model-attempt sequence. The run records each attempt and retry reason; requests already sent to a provider are never retried by this policy.
- [x] Calculator execution is pure and deterministic. The durable action is configured with one attempt in this slice; a future retry with the same validated input is safe, and one logical terminal call result is retained.
- [x] A tool timeout becomes a bounded `timeout` result and stops the run. No background calculator task may continue after the workflow reports terminal failure.
- [x] Cancellation before a model or tool step prevents that step from starting. Cancellation during a provider request uses the abort signal and reports whether the provider request had started; the native delayed-model test confirms asynchronous cancellation before a terminal result is projected.
- [x] A server-side reconciliation restart resumes from the retained workflow key and does not create a second run. Native worker restart has also been exercised; Docker-backed journal replay remains an optional compatibility gate.
- [x] A duplicate workflow submission uses the existing run ID/workflow key. It does not duplicate the model/tool cycle.
- [x] Duplicate tool-call IDs in one model response are rejected before execution. A duplicate event identity with different content fails evidence projection.
- [x] A missing retained workflow is `reconciliation_required`, not successful and not silently deleted. Once a definitive terminal/reconciliation result is retained, later reads do not re-inspect a purged native execution or rewrite that result.
- [x] If evidence projection is temporarily unavailable, the platform result remains in Restate and the common server retains its last known projection. The API and UI mark that projection stale rather than inventing completion.
- [x] If the platform accepts a run but the server cannot retain its native execution reference, the run remains a stale queued projection rather than being mislabeled `DISPATCH_FAILED`; if the reference cannot be recovered, the run requires explicit reconciliation.
- [x] The implementation and tests use `at-least-once` language for external model requests. No exactly-once claim is made.

## Security and configuration

- [x] Tool availability is deny-by-default. The run manifest explicitly enables `calculator`; future tools cannot become available by merely registering a definition.
- [x] Validate the tool name, call ID, JSON object shape, schema, maximum argument bytes, maximum output bytes, round number, and call count before execution.
- [x] Do not use `eval`, `Function`, a shell, subprocesses, filesystem access, network access, or dynamic imports in the calculator.
- [x] Keep OpenRouter credentials in the server/platform process environment. Never include them in manifests, tool arguments, tool results, events, browser state, or error messages.
- [x] Redact sensitive fields before structured logs and UI events. Log sizes rather than raw arguments in the normalized tool events.
- [x] Bound untrusted provider response bodies, assistant text, tool batches, identities, and raw arguments before durable workflow state is assembled.
- [x] Apply final evidence size limits and conservative credential-shaped field redaction in `RunEvidenceStore`; oversized evidence is rejected rather than silently truncated.
- [x] Set explicit defaults for maximum model rounds, maximum tool calls per run, model timeout, tool timeout, argument bytes, and result bytes. Reject invalid configuration at startup or manifest validation.
- [x] Keep local-service-unavailable behaviour honest. The server can start, but the run becomes a classified dispatch/connectivity failure when Restate cannot accept it.

## Implementation checklist

### 1. Contracts and configuration

- [x] Extend `server/src/capabilities/tools/README.md` with ownership, risk classes, allowlisting, and the no-side-effect rule for this slice.
- [x] Add provider-neutral tool contracts, stable call identity, validation outcomes, policy outcomes, and normalized tool lifecycle payloads under `server/src/capabilities/tools/`.
- [x] Add a registry that exposes only explicitly enabled definitions and rejects duplicate names or schema versions.
- [x] Add strict calculator input/output schemas and deterministic implementation.
- [x] Add run configuration for enabled tool names and limits. Freeze the effective values in `config.json`.
- [x] Extend Restate model request/response contracts to carry message history, enabled tool definitions, text content, tool calls, tool results, usage, provider request ID, and request-sent state.

### 2. Core Restate implementation

- [x] Add a provider-neutral to OpenRouter chat-completions projection for system, user, assistant tool-call, and tool-result messages.
- [x] Parse OpenRouter responses without assuming `message.content` is always a non-empty string. Support text-only completion and a response with one or more structured tool calls.
- [x] Add deterministic fake model fixtures that request the calculator, return a final answer after the result, return malformed arguments, request an unknown tool, repeat a call ID, and exceed the loop limit.
- [x] Implement the bounded Restate model/tool loop with explicit step names, serializable inputs/outputs, and no provider calls in workflow code.
- [x] Emit model, validation, policy, tool, round, context, and terminal events with monotonic source sequences.
- [x] Update Restate metrics and trajectory to count model calls, model attempts, logical tool calls, tool attempts, failures, cancellations, and context usage observations. Context revision counts do not apply until the Restate session-context adapter exists.
- [x] Preserve existing text-only fake/OpenRouter completion behaviour and existing baseline recovery semantics.

### 3. Lab server and API integration

- [x] Include effective tool configuration in the run manifest without leaking secrets.
- [x] Project Restate tool events through `RunService` and `RunEvidenceStore` with idempotent event writes.
- [x] Expose tool summaries and context usage through the existing `RunView`/run-events responses. Keep native Restate details under the platform-native record.
- [x] Expose a bounded `RunView.projection` state so temporary platform/evidence outages are visible as stale without changing the retained run status.
- [x] Return classified errors for unavailable, denied, invalid, failed, cancelled, and outcome-unknown states.
- [x] Ensure repeated polling is idempotent and never appends duplicate events or creates duplicate assistant messages.

### 4. Browser chat surface

- [x] Show tool activity from normalized run events with stable React keys based on event ID or tool-call ID plus lifecycle kind. Never key repeated assistant content by a constant run ID.
- [x] Keep the current concise chat layout. Do not add a new configuration page or a noisy tool catalog for this slice.
- [x] Show the context window percentage, token estimate, model window, and compaction/recovery status from `RunView.context`. One-shot runs show provider-reported request usage; session compaction remains platform-specific.
- [x] Show a compact calculator status while a run is active and a classified error when it fails. Do not render a successful assistant bubble until `result.status` is `completed`.
- [x] Preserve cancellation and New chat behaviour, including refresh/reopen of a run URL.
- [x] Verify desktop, tablet, and mobile layout, including the completed tool flow and an active delayed run in Chromium. Long event/error text remains bounded and wraps within the chat surface; cross-browser acceptance remains open below.

### 5. Documentation and learning material

- [x] Update `server/src/platforms/restate/variants/baseline/README.md` and `server/src/platforms/restate/docs/semantics.md` with the actual tool-loop scope and guarantees.
- [x] Update `server/src/platforms/restate/variants/baseline/models/README.md` with provider message mapping and ambiguous OpenRouter outcome rules.
- [x] Add a short architecture note explaining why tool definitions are shared while durable execution stays under each platform.
- [x] Add `development/playground/restate-tool-loop/README.md` with a runnable browser procedure, expected events, evidence paths, and failure exercises.
- [x] Record exact validation results, manual observations, and known limitations in this plan before moving it to `completed/`.

## Parallel execution and handoff

The slice may be delegated, but the work is divided by ownership rather than by
file fragments. Each agent works in an isolated worktree or branch and returns
the listed files, tests, assumptions, and validation output. No agent edits a
file owned by another workstream without an explicit handoff.

| Workstream | Owns | Must not own | Handoff gate |
| --- | --- | --- | --- |
| Tool boundary | `server/src/capabilities/tools/`, capability tests, capability README | Restate workflow, common evidence projection | Contract/schema and registry tests pass; no framework imports in the shared layer |
| Restate runtime | `server/src/platforms/restate/variants/baseline/`, Restate runner/model tests | Shared tool contracts, browser components | Text-only and tool-call fixtures pass; native Restate test identifies the durable action sequence |
| Server projection | `server/src/control-plane/`, run-service/evidence tests | Platform workflow internals, UI state rendering | Polling, duplicate projection, outage, and evidence-boundary tests pass |
| Browser surface | `apps/web/src/features/platforms/`, browser-facing tests | Server contracts and platform execution | Typecheck/build pass; UI renders only normalized server state |
| Documentation/playground | platform READMEs, semantics, playground, this plan | Runtime code and tests | Every command/path matches the checked-in implementation and known limits are recorded |

The primary agent owns the shared contract decisions, integration order, final
diff review, and completion gate. Parallel agents must not create speculative
cross-platform abstractions or mark operational checks complete based only on
unit tests. Integration is ordered as: tool boundary → Restate runtime → server
projection → browser surface → documentation/playground. A workstream may run
its own tests in parallel once its inputs are fixed, but the primary agent runs
the cross-boundary suites after each merge.

For this repository's dirty worktree, do not stage or commit another agent's
unrelated changes. If isolated worktrees are unavailable, use disjoint file
ownership and make no edits while another agent is changing the same boundary.

## Test coverage

The implementation currently has deterministic unit/in-process coverage and a
native local Restate tool-flow check. Docker replay and full browser
compatibility remain open until those prerequisites are exercised. The native
worker-restart exercise below is complete; the plan stays active until the
remaining checks are either completed or explicitly deferred with evidence.

### Unit tests

- [x] Registry rejects duplicate names, missing schema metadata, disabled tools, and unsupported schema versions.
- [x] Calculator accepts valid operations and rejects invalid operations, extra properties, non-finite values, division by zero, oversized input, and oversized output.
- [x] Tool-call normalization accepts valid provider payloads, rejects malformed JSON/object shapes, rejects empty/unsafe IDs, and preserves text-only responses.
- [x] Provider message projection preserves the assistant tool-call and matching tool-result pairing.
- [x] Policy denies unknown or unenabled tools and allows only the explicitly enabled pure calculator. Enabled non-pure tools are denied by the first-slice policy.
- [x] Round/call budgets stop runaway tool loops with a classified partial failure.
- [x] Duplicate and out-of-order events are rejected or deduplicated according to the evidence-store contract.
- [x] Tool event payloads redact secrets and cap untrusted text.
- [x] Cancellation classification distinguishes not-started, started, timed-out, and cancelled requests at the model and tool boundaries; live active-run cancellation remains in the acceptance checks below.
- [x] An accepted platform submission whose native execution reference cannot be retained is not converted into a synthetic dispatch failure; the recovery path is explicit and tested.

### Restate and server integration tests

- [x] Text-only fake model completes in one model round and does not execute a tool.
- [x] Deterministic tool-call fixture executes calculator, performs the second model request, and returns the final answer through the native local Restate service and generic HTTP API.
- [x] The actual OpenRouter request body contains the tool schema and, on the second request, the assistant tool call plus matching tool result. Use a local fetch fixture, not a live API key, in automated tests.
- [x] Unknown tool, malformed arguments, duplicate IDs, calculator failure, and loop-limit paths produce model-visible tool results or terminal classified failures as specified.
- [ ] Restate journal replay does not execute a completed model/tool step twice. Native worker restart and post-restart Lab projection passed; the exact completed-step non-duplication assertion remains deferred to the Docker `alwaysReplay` profile because Docker is unavailable in this environment.
- [x] Duplicate run submission reuses the same workflow key and does not duplicate logical tool calls; the native test submits the completed tool workflow again and confirms `already_accepted`, the same output, and one logical tool call.
- [x] An accepted workflow that disappears is classified as `reconciliation_required`; repeated reads preserve the same retained result.
- [x] Restart the Restate worker between model/tool steps, then inspect the run and verify recovery from native state. The persistent native Restate 1.7.10 probe replayed `restate-worker-restart-1789577191093` after the node restarted; it completed with two model rounds, one logical calculator call, and the same final answer. Service-process interruption remains recorded as a separate observed limitation below.
- [x] Stop an active run and verify the platform confirms cancellation before the server projects a cancelled terminal result; the native local Restate test uses the long `fake-delay` fixture.
- [x] Temporarily make the Lab evidence path unavailable and verify the server preserves the last projection without fabricating completion; the automated acceptance uses an `EIO` write failure, then restores the store and verifies reconciliation.
- [x] Verify `config.json`, `events.jsonl`, `trajectory.json`, `metrics.json`, `result.json`, and `native/restate.json` are complete, stable, and free of credentials in the native generic-API test. Verify that `context.json` is present for session-owning platforms and intentionally absent—not fabricated—for this one-shot Restate projection.

### API and browser acceptance checks

- [x] Start the local stack with the existing launcher and local Restate service; the launcher now forwards `AGENTLAB_RESTATE_DATA_DIR` so native journal persistence is explicit and reproducible.
- [x] Open the Restate Chat page with a real OpenRouter model that supports tool calling and run a calculator prompt.
- [x] Inspect the request/run events and verify the UI shows the calculator lifecycle, final answer, token usage, and context percentage.
- [x] Repeat the same run URL after a refresh and verify no duplicate assistant messages or tool activity appear.
- [x] Run a prompt that needs no tool and verify the assistant answers directly.
- [x] Run malformed/unknown-tool fixtures and verify the browser shows the error state without a fake answer.
- [x] Cancel a delayed fixture from the browser Stop action and verify the UI settles without blinking or duplicate keys. Chromium run `ff9ab8a0-1ff9-41ba-92af-77e89c2c0830` rendered `Working…`, accepted the click, and settled to one cancellation result with no Stop action remaining.
- [x] Use Firefox and Chromium at desktop and narrow widths. Firefox WebDriver loaded the Restate chat route at requested `1440`, `768`, and `390` widths (Firefox enforced a 500px minimum content viewport at the narrowest size), with no route error, frozen state, native dialog, or application duplicate-key warning; the model modal search and Escape close were also exercised.
- [x] Inspect the run directory manually and verify no API key, authorization header, raw secret, or unbounded tool output was retained.

## Required validation commands

Run the narrow checks after each coherent section, then the full relevant checks:

```bash
pnpm --filter @agent-harness-lab/lab-server run typecheck
pnpm --filter @agent-harness-lab/lab-server run test:restate
pnpm --filter @agent-harness-lab/lab-server run test:temporal
pnpm --filter @agent-harness-lab/web run typecheck
pnpm --filter @agent-harness-lab/web run build
git diff --check
```

The Restate integration checks require the checked-in local Restate profile. The live OpenRouter browser check requires `OPENROUTER_API_KEY` in the server process and a model with structured tool-call support. Do not put that key in the repository or automated fixtures. If the local Restate service is unavailable, record the exact failed prerequisite rather than weakening the tests.

## Current validation checkpoint

Recorded `2026-09-16T19:08:34+02:00`. These results cover the deterministic
implementation, repository integration, the running native Restate service, and
the live OpenRouter tool flow. The Docker replay remains the only unavailable
runtime-profile check; browser acceptance is recorded as complete below.

- `pnpm --filter @agent-harness-lab/lab-server run typecheck` — passed after the concurrent Studio work-in-progress became syntactically complete.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/control-plane/evidence-store.test.ts tests/control-plane/run-service.test.ts tests/platforms/restate/runner.test.ts tests/platforms/restate/models.test.ts` — 38 passed.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/control-plane/evidence-store.test.ts tests/control-plane/run-service.test.ts tests/platforms/restate/workflow.test.ts tests/platforms/restate/models.test.ts` — 37 passed.
- `pnpm --filter @agent-harness-lab/lab-server run test:temporal` — 1 passed.
- `pnpm --filter @agent-harness-lab/lab-server run test` — 219 passed, 0 failed. This includes the Studio tests that were previously blocked by the concurrent untracked route file; the expected failure-fixture logs did not fail the suite.
- `AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION=1 pnpm --filter @agent-harness-lab/lab-server run test:restate` — 33 passed, 1 skipped. Native workflow and generic HTTP checks passed; the one skipped test is the Docker-backed replay test because Docker is unavailable in this environment.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/platforms/restate/models.test.ts tests/platforms/restate/workflow.test.ts tests/platforms/restate/runner.test.ts` — 29 passed after adding the abortable `fake-tool-call-delay` recovery fixture.
- The earlier combined typecheck/test attempt was blocked by concurrent untracked Studio work-in-progress at `server/src/studio/http/routes.ts`; that blocker is cleared and the full checks above now pass.
- `pnpm --filter @agent-harness-lab/web run typecheck` — passed; documentation catalog generated 63 documents.
- `pnpm --filter @agent-harness-lab/web run build` — passed; Vite reported only the existing large-chunk warning.
- `git diff --check` — passed.
- `bash -n scripts/run_local_stack.sh` — passed after wiring the documented `AGENTLAB_RESTATE_DATA_DIR` through the full-stack Restate-server process.
- Chromium headless smoke — passed for `/platforms/restate/chat` and a live local completed calculator run; the rendered page showed the tool activity, context panel, and final answer without a route error.
- Live OpenRouter API/browser smoke — run `0bc49412-7170-4112-8c03-6925090cface` completed with `cohere/north-mini-code:free`; the event sequence contained one calculator lifecycle and two model rounds, and the run projection reported `100 / 256000` input tokens with `97%` remaining. The Chromium refresh DOM contained one final answer and one completed calculator activity entry.
- Chromium responsive smoke — completed tool flow rendered at `1440x1000`, `768x900`, and `390x844`; active run `ff9ab8a0-1ff9-41ba-92af-77e89c2c0830` rendered its working state, the real Stop button was clicked, and the page settled to one cancellation result with no duplicate activity or blinking state.
- Deterministic browser/API fixtures — text-only `fake-success` completed directly; malformed and unknown tool fixtures ended in `RunFailed` with no fake assistant output.
- Live run evidence inspection — the OpenRouter run contained `config.json`, `events.jsonl`, `trajectory.json`, `metrics.json`, `result.json`, and `native/restate.json`; a credential-shaped scan found no API key, authorization header, or raw provider secret.
- Isolated native restart probe — the temporary service deployment used `fake-tool-call-delay`; the service was killed after submission and restarted on the same port. Restate continued returning connection-refused for the in-flight invocation, even after the endpoint was healthy again, so the deployment was force-removed afterward. This is an observed failed recovery exercise, not a recovery claim; the user’s `9080` service and deployment were not touched.
- Isolated native worker-restart probe — with the temporary service left running and Restate 1.7.10 using the persistent base directory `/tmp/agentlab-restate-restart-data-2`, the node was stopped during `restate-worker-restart-1789577191093` and restarted on the same ingress/admin/message-fabric ports. Restate replayed the invocation and the service completed the tool loop; inspection returned two model rounds, one calculator call, and `The calculator returned {"value":42}.` The temporary probe used ports `18080`, `19070`, `19080`, and `19522`, and did not touch the user’s `8080`/`9080` stack.
- Post-restart Lab projection — a fresh `RunService` and `RunEvidenceStore` connected to the restarted native journal and projected the retained run above into the common evidence contract. It returned `completed`, the same calculator result, and the ordered 13-event sequence from `AgentStarted` through `RunCompleted`.
- Firefox WebDriver smoke — passed in an isolated headless session using Firefox 155. The Restate chat route loaded at desktop and requested narrow sizes without a route error; the model-selection dialog filtered `Claude Sonnet 5` to four matching models and closed on Escape. The existing user Firefox process was not touched. Firefox's 390px request produced a 500px minimum content viewport, which is recorded as the browser constraint rather than treated as a 390px layout claim.

Follow-up repository checks on `2026-09-16T19:10:43+02:00` — server typecheck,
the full server test command (219 passed, 0 failed), web typecheck, web build,
`git diff --check`, and `bash -n scripts/run_local_stack.sh` all passed. The web
build retained only the existing large-chunk warning.

The release-process document referenced by the repository guidance is not
present in this checkout, so no release, migration, rollout, or rollback claim
is made for this active slice. That reference must be resolved before the plan
is archived.

## Completion gate

Before moving this plan to `completed/`:

- [x] Every applicable checkbox is complete or has a written reason for deferral. The only remaining unchecked implementation check is the Docker-only `alwaysReplay` assertion; the native worker-restart and post-restart projection checks passed, and the exact Docker prerequisite is recorded below.
- [x] The browser flow is real and inspectable, not simulated.
- [x] Model/tool protocol pairing, validation, policy, limits, redaction, cancellation, retry, restart, and ambiguous-outcome semantics are implemented and tested.
- [x] Normalized evidence and native Restate evidence agree after polling and restart. A fresh `RunService`/`RunEvidenceStore` projection of `restate-worker-restart-1789577191093` after the persistent native node restart returned the completed result and the ordered 13-event tool-loop sequence.
- [x] The context meter remains correct across model/tool rounds. For this Restate slice it uses provider-reported request usage; canonical session compaction is a later adapter boundary.
- [x] Documentation, playground instructions, and examples match the code.
- [x] Exact validation results, manual checks, and known limitations are recorded below.
- [x] No unrelated dirty work was staged or changed. The focused commits below staged only files owned by this plan; the remaining dirty worktree belongs to other active platform, context, Studio, and UI work.

## Commit discipline and handoff

Use separate reviewable commits. Do not wait until the end for one large commit:

- [x] Commit the shared tool contract, registry, calculator, unit tests, and capability documentation in `cb6c430` (`feat(tools): add bounded calculator capability`).
- [x] Commit the Restate model protocol and durable tool-loop implementation with Restate tests in `8c78c73` (`feat(restate): add durable tool-enabled model loop`).
- [ ] Commit Lab evidence/API projection and server integration tests. The Restate runner and native integration portion is in `9b41bb5`; common `RunService`/`RunEvidenceStore` changes remain in the existing shared worktree and must be separated from other agents' changes before committing.
- [ ] Commit browser tool activity/context presentation and browser-facing tests. These files still overlap with the active model-picker, chat, and Studio work and remain intentionally unstaged.
- [x] Commit playground and platform documentation updates in `2a7194c` (`docs(restate): record tool loop operations and recovery`).
- [x] Before each completed commit, inspect `git status`, stage only files owned by the section, run the narrow validation, and record the result in the validation checkpoint above.
- [ ] Record the final contiguous commit set in the completion record when the remaining shared/server and browser sections are committed and the plan is archived. Preserve existing user and other-agent changes in the dirty worktree.

Focused commits already landed: `cb6c430`, `8c78c73`, `9b41bb5`, `2a7194c`,
`0788d37`, and `43607f2`.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`
**Commits:** `[commit hashes or contiguous range]`

### Validation

- `[command]` — `[passed/failed and concise result]`
- `[manual check]` — `[what was observed]`

### Known limitations

- The first tool is a pure calculator. External side-effecting tools require separate security and idempotency plans.
- `[additional limitation discovered during implementation]`

### Historical-scope note

This plan records the first tool-enabled Restate slice. Later platform adapters may preserve the shared tool contract while choosing different durable execution and recovery mechanisms.
