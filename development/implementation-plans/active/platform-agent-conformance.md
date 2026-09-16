# Cross-platform agent conformance — implementation plan

**Created:** `2026-09-17T00:35:55+02:00`
**Last updated:** `2026-09-17T00:35:55+02:00`
**Status:** Active
**Owner:** Primary platform integration owner with one owner per platform
**Platforms:** Temporal, Restate, LangGraph, Mastra
**Priority:** Complete this before adding another platform or a larger agent capability

## Start here

Read these before changing code:

- [repository rules](../../../AGENTS.md)
- [documentation rules](../../../docs/contributing/documentation.md)
- [server ownership](../../../server/README.md)
- [platform ownership](../../../server/src/platforms/README.md)
- [runner interface and invariants](../../../server/src/control-plane/ports/README.md)
- [shared context capability](../../../server/src/capabilities/context/README.md)
- [shared tool capability](../../../server/src/capabilities/tools/README.md)
- [run evidence layout](../../../lab/runs/README.md)
- [completed platform batch](../completed/platform-parallel-implementation.md)
- [first-party platform source audit](../../../docs/research/platform-plan-source-audit.md)
- [Temporal baseline](../completed/lab-server-temporal-baseline.md)
- [Restate baseline](../completed/restate-baseline.md)
- [LangGraph baseline](../completed/langgraph-baseline.md)
- [Mastra baseline](../completed/mastra-baseline.md)

The platform baselines are the implementation starting points, not proof that the four
platforms already provide equivalent agent behaviour. Preserve their existing platform
boundaries, local dependency decisions, native identifiers, retry rules, and known
limitations. Do not turn this plan into a new generic platform runtime.

### Upstream references

The source audit was performed on `2026-09-15`. Before implementation, each platform
owner must re-check the exact SDK/runtime versions and the relevant official API pages
against the installed package versions. A URL being listed here is not permission to
assume that an API has remained unchanged.

- [Temporal Workflows](https://docs.temporal.io/workflows), [Activities](https://docs.temporal.io/activities), and [TypeScript cancellation](https://docs.temporal.io/develop/typescript/cancellation)
- [Restate TypeScript services](https://docs.restate.dev/develop/ts/services), [durable steps](https://docs.restate.dev/develop/ts/durable-steps), and [error handling](https://docs.restate.dev/guides/error-handling)
- [LangGraph local server](https://docs.langchain.com/oss/python/langgraph/local-server), [persistence](https://docs.langchain.com/oss/python/langgraph/persistence), and [fault tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance)
- [Mastra agents](https://mastra.ai/docs/agents/overview), [tools](https://mastra.ai/docs/agents/tools), and [OpenRouter gateway](https://mastra.ai/models/gateways/openrouter)
- [OpenClaw code map](../../../docs/research/harness-code-maps/openclaw.md), [Hermes code map](../../../docs/research/harness-code-maps/hermes.md), and [Waku code map](../../../docs/research/harness-code-maps/waku.md) for optional design comparison only

## Purpose

Close the gap between “each platform has a runnable baseline” and “the Lab can run a
comparable agent task through each platform.” The slice gives us one real, observable
agent flow that exercises model context, a safe tool call, platform-native execution,
lifecycle handling, and retained evidence without erasing the differences between
Temporal, Restate, LangGraph, and Mastra.

This is a conformance workload and acceptance matrix, not a claim that the platforms
have identical durability. The result should make those differences easier to inspect.

### Contract decision: optional capability declaration

The existing generic request had no provider-neutral way to say which tools a workload
enabled. This plan adds optional `RunRequest.capabilities.tools`, which is copied into
the immutable manifest and contains only an enabled-name list plus bounded round/call
limits. An omitted field preserves existing platform-baseline defaults.

Using `scenarioId` alone was rejected because platform adapters would have to infer
capabilities from a scenario name. Reusing `platformConfig.tools` was rejected because
that field is platform-owned and already has different shapes. A central agent loop was
also rejected: the declaration is shared, but tool lookup, model mapping, execution,
retry, and evidence remain inside each platform implementation.

## Definition of done

With the required local services available, a contributor can select one of the four
priority platforms in the browser, select an OpenRouter model, open Chat, and run the
same conformance workload. The workload can also be run deterministically in automated
tests without a network credential.

```text
browser Chat or conformance test
  → Lab server RunRequest and context session
  → selected platform runner
  → native agent/model/tool execution
  → normalized lifecycle evidence + platform-native evidence
  → browser result, context projection, and inspectable lab/runs/<run-id>/ records
```

The finished slice must demonstrate:

- a prompt-only turn on all four platforms;
- a calculator tool turn on all four platforms using the existing provider-neutral
  `calculator` definition and deny-by-default registry;
- a two-turn session on all four platforms where the second turn receives the first
  turn's context through the existing server-owned context capability;
- a real OpenRouter request path for manual acceptance, with no automatic model
  substitution and no provider secret crossing a platform protocol boundary;
- truthful queued, running, completed, failed, cancelled, and
  reconciliation-required behaviour;
- normalized `config.json`, `events.jsonl`, `trajectory.json`, `metrics.json`, and
  `result.json`, plus safe `native/<platform>.json` evidence for every completed run;
- browser-visible assistant output, tool activity, run status, context-window usage,
  and an honest unavailable or unknown state when a dependency cannot be reached;
- focused failure and recovery tests that show where the platforms differ instead of
  reporting all failures as one generic error.

No successful run, tool call, token count, context percentage, or dependency health may
be simulated to satisfy this gate. Fake models are allowed only as deterministic test
fixtures and must be named as such in tests and documentation.

## Scope

### Shared conformance workload

- [x] Add a documented `platform-agent-conformance` scenario under `lab/scenarios/`.
- [x] Define one bounded prompt-only case with a stable expected evidence shape.
- [x] Define one calculator case that asks the model to use the enabled pure calculator
      tool and records whether the model requested it, whether the platform executed it,
      and how the final response incorporated the result.
- [x] Define one two-turn session case with an explicit session ID and client turn IDs;
      the second turn must be able to use the first turn's retained context.
- [x] Keep the scenario inputs, model settings, enabled tools, context policy, and
      expected observations explicit so the workload is reproducible across platforms.
- [x] Add a test-only conformance harness that submits the existing `RunRequest` shape
      and asserts common semantics without becoming production execution code.

### Priority platform implementations

- [ ] Extend the Temporal baseline locally to consume the conformance context snapshot,
      expose the calculator tool, and retain its workflow/activity/retry semantics.
- [ ] Extend the Restate baseline locally to consume the conformance context snapshot,
      expose the calculator tool, and retain durable-step/journal replay semantics.
- [ ] Extend the LangGraph baseline locally to consume the conformance context snapshot,
      add the bounded graph/tool path, and retain checkpoint/thread/restart semantics.
- [ ] Extend the Mastra baseline locally to consume the conformance context snapshot,
      add its bounded native tool path, and retain its explicitly process-local limits.
- [ ] Keep provider adapters, SDK types, native status mapping, and platform-specific
      retries inside each platform directory.
- [ ] Reuse the existing shared context and tool definitions; do not create a second
      calculator, second context store, or platform-specific copy of the common registry.

### Server and browser integration

- [ ] Keep `PlatformRunner` as the only server-to-platform execution seam unless a
      concrete conformance case proves that an existing field is insufficient.
- [ ] Make the common server pass the correct context snapshot identity and safe tool
      configuration to each selected runner without importing SDK-specific types.
- [ ] Ensure the existing Platform Chat flow works for all four platforms without
      Temporal-specific assumptions.
- [ ] Show context-window tokens, remaining percentage, pressure, and compaction state
      from the server-owned projection. Show `unknown` when the token basis or model
      window is unknown; never render `0%` as a fallback.
- [ ] Show tool activity only for tool events that actually occurred.
- [ ] Preserve the existing Compare surface as an acceptance aid, adding only the
      fields required to submit the same scenario to multiple selected platforms.
- [ ] Keep platform-native detail behind expandable run/evidence inspection rather than
      adding a dense platform dashboard to the main Chat surface.

### Local operation without Docker

- [ ] Document and test the native local profile for Temporal.
- [ ] Document and test the native Restate server binary/service profile.
- [ ] Document and test the LangGraph Python service with an isolated local SQLite
      state directory.
- [ ] Run Mastra in the Lab server process as its existing direct-agent baseline.
- [ ] Make Docker optional for profiles that already have a native local path. Do not
      make Docker a prerequisite for this conformance slice.
- [ ] Keep unavailable services visibly unavailable; do not replace a missing service
      with an in-memory stand-in in an integration test marked as real.

## Explicitly out of scope

- New platforms, including AWS Step Functions, in this plan.
- Real Trigger.dev server/worker acceptance; the existing implementation-ready plan
  records that external prerequisite separately.
- Long-term memory, retrieval, observational memory, or a new compaction algorithm.
  The existing shared context implementation is consumed and tested here; deeper memory
  remains a separate capability.
- Skills, plugins, MCP, OAuth, social connections, gateways, cron, daemon supervision,
  computer-native tools, browser automation, sandboxes, or VM execution.
- Subagents, parallel agent orchestration, human approval, streaming token UX, and
  side-effecting tools.
- A shared cross-platform agent loop that hides durable execution differences.
- Production hosting, multi-user authentication, tenancy, managed platform deployment,
  autoscaling, or claims that local services are production-equivalent.
- Exactly-once model or external tool execution. A durable surrounding workflow does
  not establish exactly-once delivery to OpenRouter.
- Automatic provider fallback, silent model substitution, or automatic retry after an
  ambiguous billable model request.

## Finished behaviour

### User-visible behaviour

The user selects Temporal, Restate, LangGraph, or Mastra, chooses a model, and opens the
same Chat surface. A prompt-only message produces a normal assistant response. A tool
turn shows a concise calculator activity row and then the final response. A follow-up
message in the same session can use the earlier turn.

The side panel shows the selected platform and model, current run status, context-window
usage, and safe run details. It distinguishes:

- platform unavailable;
- run queued or running;
- tool requested, validated, executing, completed, or rejected;
- completed, failed, cancelled, or reconciliation-required outcome;
- stale projection while the platform is temporarily unreachable.

The UI does not call a platform SDK, read a platform database, read `lab/runs/` directly,
or label a process-local Mastra call as durable. It does not show a fake assistant
message after a failed or unknown model request.

### Ownership and boundaries

```text
apps/web/src/features/platforms/
  owns platform selection, Chat presentation, polling, context projection, and evidence links

server/src/control-plane/
  owns RunRequest validation, immutable manifests, dispatch, common lifecycle projection,
  and the normalized Lab evidence store

server/src/capabilities/context/
  owns canonical sessions, snapshots, budgets, compaction policy, and context projections

server/src/capabilities/tools/
  owns provider-neutral tool definitions, validation, allowlisting, risk vocabulary,
  and bounded calculator implementation

server/src/platforms/<platform>/
  owns SDK/runtime integration, native agent loop, model/tool boundary, platform state,
  retries, cancellation, native telemetry, and platform-native evidence

lab/scenarios/platform-agent-conformance/
  owns workload inputs, expected observations, fixtures, and scenario documentation
```

`RunEvidenceStore` remains the sole writer for `lab/runs/<run-id>/` normalized records.
Platform services may write their own local state, checkpoints, journals, or process
registries, but they return safe event intents and native references to the server rather
than writing Lab evidence directly. Platform directories must not import one another.

The conformance harness may share test utilities, but it must not become a production
agent abstraction. Platform-specific behaviour remains visible in native evidence and
documentation.

## State, persistence, and evidence

Use the existing run and context stores. Do not introduce a second run database for this
slice.

```text
lab/runs/<run-id>/
  config.json             # immutable manifest and safe effective configuration
  events.jsonl            # ordered normalized lifecycle events
  trajectory.json         # ordered execution phases, including context/model/tool phases
  metrics.json            # duration, model/tool counts, usage, and known nulls
  result.json             # one terminal outcome for the run
  native/<platform>.json  # safe platform identity, status, attempts, and native detail
  logs/                   # retained diagnostics when configured
  artifacts/              # empty for this slice unless a declared artifact exists
```

- [ ] Define event identity, source sequence, and payload limits for the conformance
      events before adding platform-specific event mapping.
- [ ] Use common lifecycle kinds consistently where the observation is genuinely shared:
      `RunCreated`, `RunDispatched`, `AgentStarted`, `ContextPrepared`,
      `ModelRequested`, `ModelCompleted`, `ToolCallRequested`, `ToolCallValidated`,
      `ToolExecutionStarted`, `ToolExecutionCompleted`, `ToolExecutionFailed`,
      `AgentCompleted`, `AgentFailed`, `AgentCancelled`, and terminal run events.
- [ ] Preserve native workflow IDs, invocation IDs, graph/thread/checkpoint IDs, or
      process-scoped execution references only in safe platform-native records.
- [ ] Record context snapshot ID, model ID, token-count quality, input/output/total token
      values, and compaction metadata when actually known.
- [ ] Keep canonical transcript/session state separate from request-local snapshots.
      A second turn must not overwrite the first turn's context evidence.
- [ ] Make repeated inspection and event projection idempotent. Conflicting duplicate
      events remain evidence errors rather than being silently merged.
- [ ] Keep raw authorization headers, API keys, cookies, provider request headers, and
      unbounded provider/tool payloads out of all retained records.
- [ ] Verify that `result.json` is written once for a confirmed terminal result, while a
      provisional reconciliation-required observation can be replaced only by a later
      confirmed platform result under the existing evidence-store rules.

### Conformance observations

The matrix must record both common observations and platform-specific semantics:

| Observation | Common assertion | Native detail that must remain visible |
| --- | --- | --- |
| Prompt completion | one final output and terminal result | workflow/run, invocation, graph, or process identity |
| Tool turn | calculator is allowlisted, bounded, and recorded | activity/step/node/direct-call placement and retries |
| Session continuation | second turn uses the correct snapshot/session | Temporal session signal/input, Restate workflow key, LangGraph thread/checkpoint, or Mastra process session |
| Cancellation | UI/API reports the actual accepted or terminal state | platform cancellation/drain/abort semantics |
| Restart/unavailability | unknown state is not converted into success | native recovery, checkpoint, journal, or process-loss evidence |
| Model usage | values are provider/platform observations or null | native usage/attempt metadata where supplied |

## Failure, retry, and recovery semantics

- [ ] Define the maximum model/tool rounds and per-call deadlines for the conformance
      workload. A platform may implement the limit natively, but the limit must remain
      visible in its configuration and evidence.
- [ ] Define whether a model call is retried by each platform. Record every attempt;
      never infer that a workflow retry did not repeat an external model request.
- [ ] Treat a lost acknowledgement after an OpenRouter request may have been sent as
      `outcome_unknown` or `reconciliation_required`, not as a safe automatic retry.
- [ ] Permit calculator retries only within the explicit platform policy and record
      duplicate attempts; do not generalize its pure-tool safety to future side effects.
- [ ] Cancellation is cooperative and platform-specific. Record requested, observed,
      and terminal states separately when the native platform supports that distinction.
- [ ] A platform outage during inspection returns the last readable projection as stale;
      it does not create a fabricated terminal result.
- [ ] A process restart must follow the platform's real semantics:
      Temporal may recover from durable workflow state, Restate may replay journaled
      steps, LangGraph may expose a persisted checkpoint or unknown active work, and
      Mastra must report process-local loss as reconciliation-required.
- [ ] Define the orphan rule for accepted executions that no longer have an in-memory
      registry entry or whose native service cannot be queried.
- [ ] Reject or deduplicate duplicate/out-of-order events using stable event identity and
      source sequence; conflicting content is an evidence conflict.
- [ ] Test a crash before context snapshot publication, after snapshot publication but
      before model dispatch, after model dispatch, before tool execution, after tool
      execution, and before final result projection where the platform permits it.
- [ ] Document which outcomes are confirmed, provisional, or unknown. Do not use
      “exactly once” for model or external tool execution.

## Security and configuration

- [ ] Read `OPENROUTER_API_KEY` only from the process environment that owns the model
      transport. Never include it in a RunRequest, manifest, context snapshot, protocol
      message, native reference, log, or browser response.
- [ ] Keep automated tests offline and deterministic by injecting platform-local fake
      model fixtures. The fixture must exercise the real platform agent lifecycle and
      tool boundary; it must not bypass the runner with a prebuilt result.
- [ ] Expose only the existing pure `calculator` tool for this slice. It must remain
      deny-by-default, schema-validated, bounded, and free of filesystem, network,
      subprocess, or external side effects.
- [ ] Validate model, platform, variant, context window, prompt size, tool list, timeout,
      and scenario settings before dispatch.
- [ ] Bind local platform services and administrative endpoints to loopback unless a
      platform's documented local profile requires another explicit address.
- [ ] Use isolated temporary state directories in tests. Do not commit SQLite files,
      journals, server databases, generated evidence, credentials, or machine-specific
      runtime state.
- [ ] Report missing dependencies and invalid configuration as actionable errors. A
      planned or unavailable platform must not appear to have completed a run.

## Implementation checklist

### 1. Conformance contract and scenario

- [x] Re-read the four completed plans and the first-party source audit; record any
      version/API correction required by the installed packages.
- [x] Freeze the three workload cases, expected common events, terminal states, tool
      policy, context policy, and comparison fields.
- [x] Confirm that existing `RunRequest`, `RunManifest`, `PlatformRunner`, context, tool,
      and evidence contracts are sufficient. If not, write a focused contract decision
      before changing them.
- [x] Add the scenario README and safe fixtures under `lab/scenarios/`.
- [x] Add reusable test-only conformance assertions under `server/tests/platform-conformance/`.
- [x] Define how unavailable platform prerequisites are reported in automated and manual
      matrices; never turn an unavailable real profile into a passing fixture run.

### 2. Platform-local implementations

For each of Temporal, Restate, LangGraph, and Mastra:

- [ ] Freeze the platform-owned file list and handoff before parallel work begins.
- [ ] Map the server-owned context snapshot into the native model request without
      duplicating or mutating canonical session messages.
- [ ] Pass the calculator definition only when enabled by the workload/configuration.
- [ ] Implement the native model/tool loop with a bounded round count and explicit
      timeout/cancellation policy.
- [ ] Return normalized event intents and safe native execution references through the
      existing runner adapter.
- [ ] Record provider usage and tool counts when supplied; use `null` when unknown.
- [ ] Preserve native retries, replay/checkpoint/journal details, and process-loss rules.
- [ ] Add unit tests and a platform-local integration test before shared registration is
      changed.
- [ ] Update the platform README, semantics/local-development docs, and playground
      notes with actual commands, versions, limits, and known gaps.

Platform-specific decisions that must not be flattened:

| Platform | Required native distinction |
| --- | --- |
| Temporal | Workflow history, activity boundary, worker recovery, cancellation signal, and model-call retry/ambiguity |
| Restate | Workflow key, invocation identity, durable step, journal replay, retry policy, and cancellation observation |
| LangGraph | Graph/node boundary, thread ID, checkpoint ID, SQLite local limit, service restart, and cooperative graph cancellation |
| Mastra | Direct `Agent.generate()`/tool API, in-process execution identity, abort behavior, and explicit non-durable process-loss outcome |

### 3. Shared server and browser surface

- [ ] Integrate only the smallest proven contract changes in the common server.
- [ ] Register each extended baseline only when its platform-local tests pass and its
      availability check is honest.
- [ ] Make Chat submit the selected scenario/prompt, model, context/session, and tool
      configuration through the common API.
- [ ] Render the context-window projection for every registered platform and keep the
      display stable during polling.
- [ ] Render unique message keys based on event/message identity, not role plus a reused
      run ID, to prevent duplicate assistant rows during polling.
- [ ] Verify Compare submits independent runs with distinct run and turn identities and
      does not merge event streams across platforms.
- [ ] Keep UI copy short and factual; no platform-specific promises that the runtime has
      not verified.

### 4. Local operation and evidence

- [ ] Add or update native no-Docker startup/readiness/reset instructions for the four
      profiles.
- [ ] Ensure the local stack can start the required Lab processes without requiring a
      platform that is not selected for the current test.
- [ ] Run one prompt-only, one calculator, and one two-turn case per platform locally.
- [ ] Inspect all normalized files and the relevant `native/<platform>.json` file for each
      run; verify no platform writes the normalized directory directly.
- [ ] Record the exact runtime/package versions and the local service prerequisites.
- [ ] Add a development playground walkthrough for one successful tool turn, one context
      continuation, one cancellation, and one unavailable-service observation.

### 5. Documentation and release impact

- [ ] Update the platform architecture/index documentation to describe conformance as an
      acceptance workload, not a claim of equivalent durability.
- [ ] Update relevant platform READMEs and local-development docs in the same change.
- [ ] Update `lab/scenarios/` documentation with inputs, fixtures, expected evidence,
      controls, and limits on interpretation.
- [ ] Keep the active-plan index current while work is in progress and record exact
      validation results before archiving this plan.
- [ ] Record release impact explicitly: no database migration, public API version change,
      or deployment change is intended; any contract or dependency change must be listed
      with rollout and rollback notes before completion.
- [ ] Record analytics/telemetry impact: normalized run events and existing usage metrics
      are extended for tool/context observations; no new product analytics event is
      required unless the UI adds a new user action.
- [ ] Record rollback: disable the extended platform variant or unregister it while
      retaining already-written evidence and preserving existing baseline reads.

## Parallel work and file ownership

The four platform workstreams can proceed concurrently after the conformance workload
and expected evidence assertions are frozen. Shared files are integration-owned and
must not be edited independently by platform agents.

| Workstream | Owned paths | Must not change | Handoff |
| --- | --- | --- | --- |
| Conformance contract/scenario | `lab/scenarios/platform-agent-conformance/`, `server/tests/platform-conformance/` | platform runtime directories, shared bootstrap, UI | frozen cases, assertions, expected event/result rules |
| Temporal | `server/src/platforms/temporal/`, `server/tests/platforms/temporal/`, Temporal-specific integration/docs/playground | Restate, LangGraph, Mastra, shared server/bootstrap/UI | native semantics, tests, versions, evidence examples, known limits |
| Restate | `server/src/platforms/restate/`, `server/tests/platforms/restate/`, Restate-specific integration/docs/playground | Temporal, LangGraph, Mastra, shared server/bootstrap/UI | native semantics, tests, versions, evidence examples, known limits |
| LangGraph | `server/src/platforms/langgraph/`, `server/tests/platforms/langgraph/`, LangGraph-specific integration/docs/playground | Temporal, Restate, Mastra, shared server/bootstrap/UI | protocol changes, Python versions, checkpoint/restart evidence, known limits |
| Mastra | `server/src/platforms/mastra/`, `server/tests/platforms/mastra/`, Mastra-specific integration/docs/playground | Temporal, Restate, LangGraph, shared server/bootstrap/UI | SDK versions, direct-agent/tool semantics, process-loss evidence, known limits |
| Primary integration | `server/src/control-plane/`, `server/src/capabilities/`, shared bootstrap/registry, `apps/web/src/features/platforms/`, root launcher | platform-internal implementation details | registration, API/UI integration, full matrix, conflict resolution |

If a platform owner believes a shared contract is insufficient, stop that local change,
write the concrete failing case and proposed seam, and hand it to the primary integration
owner. Do not edit a common type in parallel with three other platform implementations.

## Test coverage

### Unit tests

- [ ] Conformance fixture validation, stable IDs, case selection, and expected observation
      rules.
- [ ] Context snapshot identity, two-turn ordering, token-count quality, projection, and
      compaction metadata handling.
- [ ] Tool allowlisting, calculator schema validation, bounded arguments/results, and
      tool lifecycle event mapping.
- [ ] Common event identity, source sequencing, duplicate/out-of-order rejection, and
      evidence redaction.
- [ ] Each platform's model request mapping, tool loop, lifecycle translation, retry
      count, cancellation, timeout, and native reference.
- [ ] Provider failure, empty response, invalid tool call, tool timeout, and context
      budget failure.
- [ ] Duplicate client turn submission does not create a second canonical turn or run;
      conflicting reuse is rejected.

### Integration tests

- [ ] Submit the prompt-only case through the generic server API for every platform.
- [ ] Submit the calculator case through every platform and assert tool events, final
      output, metrics, and native evidence.
- [ ] Submit the two-turn session case through every platform and assert the second
      context snapshot references the correct session and prior turn.
- [ ] Verify every completed run contains the full normalized evidence set and a safe
      platform-native record.
- [ ] Exercise platform unavailable, malformed protocol/SDK response, timeout, and
      dispatch/inspection errors without fabricated success.
- [ ] Exercise cancellation before dispatch, during model work, during tool work where
      supported, and after terminal completion.
- [ ] Exercise duplicate submission, lost start acknowledgement, repeated inspection,
      duplicate events, and out-of-order events.
- [ ] Exercise restart at the defined points and assert each platform's documented
      recovery or reconciliation-required outcome.
- [ ] Verify a service replacement or server restart cannot expose another run's context,
      native identity, tool result, or terminal result.
- [ ] Keep the real OpenRouter call opt-in and manual; automated coverage uses a local
      deterministic provider boundary or platform-injected fixture.

### Cross-platform acceptance matrix

- [ ] Run all three workload cases with the deterministic fixture on Temporal, Restate,
      LangGraph, and Mastra.
- [ ] Run at least one prompt-only case with the real configured OpenRouter model on each
      locally available platform; record model ID, runtime versions, result status, usage,
      and evidence path.
- [ ] Run the calculator case with the real model where the selected model/provider
      supports tool calls; if it does not, record the capability limitation rather than
      marking a non-tool response as a successful tool test.
- [ ] Run the same selected case through Compare and verify distinct run IDs, independent
      status transitions, and separate evidence directories.
- [ ] Run one unavailable-dependency check and verify the UI/API explains the prerequisite.

### Manual browser checks

- [ ] Open Chat for each priority platform and verify the platform/model labels are
      correct and no unsupported durability claim is shown.
- [ ] Send a prompt and observe the actual assistant response, status, and context-window
      usage percentage.
- [ ] Send a calculator request and observe only actual tool activity followed by the
      final response.
- [ ] Send a follow-up in the same session and verify context usage changes without
      duplicating prior assistant messages.
- [ ] Cancel a slow run and verify the UI settles without blinking, duplicate React keys,
      or repeated assistant rows.
- [ ] Stop a required platform service, refresh, and verify the UI shows unavailable or
      stale state instead of a false completed run.
- [ ] Inspect run evidence links and confirm normalized plus native evidence are present
      and secret-free.

## Required validation commands

Run the narrow platform checks first, then the combined checks:

```bash
pnpm --filter @agent-harness-lab/lab-server run typecheck
pnpm --filter @agent-harness-lab/lab-server run test
pnpm --filter @agent-harness-lab/lab-server run test:temporal
pnpm --filter @agent-harness-lab/lab-server run test:restate
pnpm --filter @agent-harness-lab/lab-server run test:langgraph
pnpm --filter @agent-harness-lab/lab-server run test:mastra
pnpm --filter @agent-harness-lab/web run typecheck
pnpm --filter @agent-harness-lab/web run build
git diff --check
```

Platform service integration commands must be documented in each platform's local
development guide and run with explicit opt-in flags. They must fail when a required
native service is unavailable; a skipped test is not a passing real integration.

The real OpenRouter matrix requires the ignored local environment and a valid key. It is
not a CI prerequisite. If the key or a native service is unavailable, record the exact
manual check as deferred and keep the deterministic acceptance results separate.

## Completion gate

Before moving this plan to `completed/`, verify:

- [ ] The three conformance cases run through Temporal, Restate, LangGraph, and Mastra
      using their native execution paths.
- [ ] The same common request, context, calculator policy, and evidence assertions are
      used without copying one platform's loop into another.
- [ ] Real OpenRouter manual acceptance is recorded where credentials and dependencies
      are available; unavailable cases are explicitly documented, not faked.
- [ ] Context-window projection and session continuation are visible and correct in the
      browser for all four platforms.
- [ ] Tool activity, output, metrics, normalized events, and native evidence are
      inspectable for successful and failed runs.
- [ ] Retry, duplicate, cancellation, timeout, restart, stale, orphan, and unknown
      outcome semantics are tested and documented for each platform.
- [ ] Docker is not required for the priority local path.
- [ ] Existing platform baseline behaviour remains runnable and its prior evidence is
      still readable.
- [ ] Documentation, scenario instructions, playground material, validation results,
      release decisions, and known limitations are current.
- [ ] Each coherent implementation section has a focused commit and the completion
      record names the relevant commit hashes.

## Commit discipline and handoff

- [x] Commit the frozen conformance workload and test assertions separately from runtime
      implementations.
- [ ] Commit each platform's implementation, tests, and platform documentation as a
      focused section owned by that platform.
- [ ] Commit shared server/UI integration only after the common contract and platform
      handoffs are reviewed.
- [ ] Run the narrow validation relevant to each section before committing it.
- [ ] Review `git status` and exact diffs; preserve unrelated Computer Native, Studio,
      Component Lab, AWS, and dependency-migration changes.
- [ ] Record changed files, test commands/results, manual observations, versions, and
      known limitations in every handoff.
- [ ] Do not combine all four platform implementations into one huge commit.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`
**Commits:** `[commit hashes or contiguous ranges]`

### Validation

- `[command]` — `[result]`
- `[manual browser check]` — `[observed result]`

### Known limitations

- `[deliberate limitation or deferred external prerequisite]`

### Historical-scope note

This plan records the first comparable agent workload for Temporal, Restate, LangGraph,
and Mastra. It does not claim that local profiles, direct SDK calls, checkpoint stores,
or durable workflow services have equivalent production guarantees.
