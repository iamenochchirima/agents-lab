# Studio backend runtime foundation

**Created:** `2026-09-16T18:11:34+02:00`  
**Last updated:** `2026-09-16T19:31:00+02:00`  
**Status:** Active  
**Owner:** Agent Harness Lab maintainers

## Start here

Read these before changing code:

- [Repository development rules](../../../AGENTS.md)
- [Project context and glossary](../../../CONTEXT.md)
- [Keep Studio as a server module](../../../docs/adr/0004-keep-studio-as-server-module.md)
- [Lab server ownership and local setup](../../../server/README.md)
- [Existing control-plane responsibilities](../../../server/src/control-plane/README.md)
- [Shared context semantics](../../../server/src/capabilities/context/README.md)
- [Component experiment proposal](../../../docs/planning/component-lab.md)
- [Studio UI prototype](../../../apps/web/src/features/studio/README.md)

The plan preserves these existing decisions:

- The current Platform Lab control plane remains the owner of complete platform
  runs, platform registries, and platform reconciliation.
- Studio uses the existing Lab server process and Fastify instance, but owns a
  separate module family, route prefix, domain model, runtime assembly, and run
  evidence namespace.
- Harnesses, scenarios, experiments, runs, and telemetry remain distinct records.
- The first Studio implementation is a real Context Management comparison, not a
  simulated benchmark and not an implementation of all eleven component areas.

## Purpose

Deliver the first executable backend slice of Studio: a neutral runtime that can
run the same controlled Context Management case with two strategies while keeping
the surrounding conditions fixed and leaving inspectable evidence. This establishes
the seam that later Studio components can use without changing the existing Platform
Lab execution path.

## Definition of done

From the same Lab server process, a caller can submit a valid Studio comparison,
receive a comparison identity, inspect its status, and read two strategy trials with
their context-selection evidence. Repeating the same request with the same
idempotency key must not create duplicate trials.

```text
Studio comparison request
  → Studio module in the existing Fastify server
  → fixed scenario and environment
  → selected Context strategy trials (Full history, Sliding window, or Relevance ranked)
  → durable comparison and trial evidence
```

The result must show what each strategy selected and omitted. It must not claim that
one strategy is generally better, and it must not invent quality, latency, or cost
measurements that the adapter did not observe.

## Scope

- [x] Add a `server/src/studio/` module family to the existing Lab server without
      creating a second server, package, process, port, or deployment.
- [x] Define and validate Studio-specific records for agent composition, fixed
      environment, component experiment, comparison, trial, lifecycle events, and
      evidence.
- [x] Add an explicit Studio runtime seam with an environment assembler and a
      component-strategy seam.
- [x] Implement one deterministic Context Management case involving a long
      conversation and an old important fact.
- [x] Implement `full-history`, `sliding-window`, and deterministic lexical
      `relevance-ranked` Context strategy adapters.
- [x] Implement a deterministic replay model adapter for harness verification. Its
      output is test infrastructure, not model-quality evidence.
- [x] Implement a Studio-owned evidence store with immutable configuration,
      ordered events, trial context evidence, trajectory, metrics, and result files.
- [x] Add `/api/studio/` endpoints for creating, reading, and inspecting a comparison.
- [x] Add a read-only `/api/studio/catalog` projection that advertises all eleven
      areas while exposing executable strategies only for Context Management.
- [x] Define idempotency, cancellation, invalid-input, crash-detection, and
      recovery-required behaviour for the first local execution profile.
- [x] Add contract, unit, integration, and failure-injection tests for the first
      end-to-end path.
- [x] Document Studio module ownership, local startup, request shapes, evidence
      layout, and the boundary with Platform Lab.

## Explicitly out of scope

- Changing existing `/api/runs` behaviour, `RunService`, `PlatformRunner`,
  `PlatformRegistry`, platform manifests, or platform adapters.
- Creating a second server, separate deployment, separate process, or new service
  discovery mechanism.
- Implementing Memory, Planning, Tool Use, Control Loop, Safety, or the other
  component areas as executable strategies.
- Calling a real model provider, external tool, database, filesystem workspace, or
  side-effecting integration in this first deterministic profile.
- Parallel trial execution. Trials run sequentially until isolation and resource
  accounting justify a parallel strategy.
- A general plugin SDK, dynamic code loading, user-authored executable strategies,
  or a framework-neutral abstraction for all eleven areas before a second concrete
  strategy seam requires it.
- Benchmark interpretation, leaderboard ranking, or aggregate quality claims.
- Redesigning the current Studio prototype UI. A later slice may connect the UI to
  these endpoints after the backend contract is stable.

## Finished behaviour

### User-visible behaviour

The Studio API accepts a versioned comparison definition containing:

- a Studio system definition;
- a fixed environment profile;
- a scenario case;
- the Context component under test;
- one or more strategy variants, limited to three in this slice;
- model adapter configuration;
- a deterministic seed;
- resource limits; and
- an idempotency key.

The first supported comparison runs two or three sequential trials, with the
documented request using two. Each trial receives the same scenario fixture, model
adapter, context sources, token budget, and grading input. Only the Context strategy
and its explicit parameters may differ.

The API returns safe projections. It does not expose secrets or require the browser
to calculate authoritative token budgets. A caller can inspect the selected source
IDs, omitted source IDs, token estimate, budget decision, replay model input, and
trial result.

The catalog endpoint provides the Studio interface with one source of truth for the
component inventory. A planned area is visible for orientation but cannot be submitted
as an executable strategy.

### Ownership and boundaries

```text
Studio HTTP routes       → validate requests and expose safe projections
Studio application       → create comparisons, enforce idempotency, coordinate status
Studio runtime           → assemble the fixed environment and execute trials
Context strategies       → select context through a pure, side-effect-free seam
Studio adapters          → provide replay model and durable evidence implementations
Studio evidence store    → sole writer for Studio comparison and trial records
Existing control plane   → sole owner of current Platform Lab dispatch and reconciliation
```

Studio may reuse shared context semantics or pure token-budget helpers when their
meaning is identical. It must not import the existing control-plane application
services or platform runner interfaces as a shortcut. A platform may eventually host
or provide an adapter for a Studio experiment, but that is a later integration and
does not make the experiment a platform run.

## Domain model for this slice

The implementation should use these records without collapsing them into one large
configuration object:

| Record | Meaning | Lifetime |
| --- | --- | --- |
| `StudioSystemDefinition` | The complete agent composition being studied | Versioned definition |
| `StudioEnvironmentProfile` | Fixed model, storage, limits, and side-effect policy | Versioned profile |
| `StudioScenarioCase` | Reusable input and fixture for the task | Versioned case |
| `StudioExperimentDefinition` | Hypothesis, changed component, controls, and strategy variants | Versioned experiment |
| `StudioComparison` | One requested comparison and its aggregate lifecycle | One concrete request |
| `StudioTrial` | One strategy execution inside a comparison | One strategy × case execution |
| `StudioEvent` | Ordered lifecycle or diagnostic observation | Append-only per comparison/trial |

The comparison is the parent run for this slice. Each trial must retain its own
effective strategy configuration and context evidence so a later reader can inspect
the two executions independently.

## Runtime seam

The first deep module should present a small interface to the HTTP and application
layers:

```ts
interface StudioComparisonRunner {
  run(request: StudioComparisonRequest): Promise<StudioComparisonProjection>;
  inspect(comparisonId: string): Promise<StudioComparisonProjection>;
  cancel(comparisonId: string, reason: string): Promise<StudioComparisonProjection>;
}
```

The runtime implementation hides environment assembly, trial ordering, strategy
lookup, model calls, event emission, and evidence writing. The Context seam should
remain narrower and component-specific until another component provides a second
real use:

```ts
interface ContextStrategy {
  readonly id: string;
  readonly version: string;
  assemble(input: ContextAssemblyInput): ContextAssemblyResult;
}
```

`ContextAssemblyResult` must identify retained, omitted, and summarized sources,
the ordered model messages, token-count quality, budget decision, and strategy
parameters. Strategies do not write files, call models, or mutate canonical
scenario fixtures.

## State, persistence, and evidence

Studio uses a separate root from current Platform Lab records while preserving the
same inspectable file shape:

```text
server/lab/studio-runs/<comparison-id>/
  config.json                  # immutable comparison envelope and versions
  events.jsonl                 # ordered comparison lifecycle events
  trajectory.json              # comparison timing for the local execution
  metrics.json                 # observed aggregate counts; null when unavailable
  result.json                  # aggregate status and trial references
  trials/<trial-id>/
    config.json                # effective strategy and fixed controls
    result.json                 # trial outcome
    context.json                # retained/omitted sources and budget decision
```

The first replay slice keeps strategy and model observations in the parent event
stream. Trial-local trajectory and provider-usage files remain a follow-on when a
real adapter supplies richer per-trial telemetry.

- [x] `StudioEvidenceStore` is the sole writer for this root and never reads or
      rewrites current Platform Lab run records.
- [x] A comparison configuration is written before its first trial starts and is
      immutable after dispatch.
- [x] Trial configuration is written before the trial's strategy executes.
- [x] Event sequence numbers are monotonic within their owning record and duplicate
      event writes are detectable.
- [x] Complete JSON documents are written atomically; an interrupted write cannot
      replace the last complete record.
- [x] Run artifacts contain adapter/version, scenario, experiment, model settings,
      environment, seed, timestamps, and limits.
- [x] Metrics represent observed replay/runtime facts only. Unavailable values remain
      `null` or are omitted according to the schema.
- [x] Context evidence retains source identity and decision detail without requiring
      hidden model reasoning or leaking credentials.

## Failure, retry, and recovery semantics

- [x] Validation errors are rejected before a durable comparison is created.
- [x] A comparison is created once for an idempotency key. A repeated request returns
      the existing comparison and never starts duplicate trials.
- [x] Comparison lifecycle is `created → running → completed|failed|cancelled`.
      An incomplete record discovered after a process restart becomes
      `recovery_required` rather than being presented as completed.
- [x] Trials execute sequentially and stop after the first non-recoverable failure;
      the parent records which trials completed and which did not.
- [x] Pure strategy assembly is not retried as if it were an external operation.
      The replay model has no network retry path in this slice.
- [x] Cancellation is accepted before the next trial or model call and records a
      terminal cancelled result. A running synchronous operation observes an
      `AbortSignal` where the adapter supports it.
- [x] Injected failures can occur before configuration write, between trials, and
      during evidence publication. The next inspection reports the durable state
      without fabricating the missing result.
- [x] A crash does not cause a trial to run twice automatically. Resume semantics for
      real provider calls are deferred until the external model adapter exists.
- [x] Out-of-order or duplicate events are rejected or recorded as diagnostics and
      cannot move a comparison backwards in its lifecycle.

The first profile has no side-effecting external operation, so recovery detects and
closes incomplete local work rather than claiming a provider call was resumed. A
future real-provider profile must add an external request identity and reconciliation
contract before it can be described as resumable.

## Security and configuration

- [x] Studio configuration is loaded by the existing server bootstrap but validated
      by Studio before a run begins.
- [x] The first replay profile requires no provider credential and cannot make network
      or side-effecting tool calls.
- [x] The fixed catalog and request bounds cover fixture size, strategy count, token
      budget, strategy parameters, and evidence size.
- [x] Strategy and case IDs are allowlisted from the Studio catalog; arbitrary module
      paths or executable source are never accepted from the request.
- [x] Safe projections redact credentials, raw headers, and unrelated server
      configuration before returning evidence to the browser.
- [x] The local profile documents what is not isolated because it performs no
      external side effects. A future real execution profile must declare sandbox,
      permissions, network, timeout, and cost limits explicitly.

## Implementation checklist

### 1. Module boundary and composition

- [x] Create `server/src/studio/` with focused `domain`, `application` (including the
      first runtime coordinator), `strategies`, `adapters`, and `http` modules.
- [x] Add a Studio composition function to the existing server bootstrap. Do not
      move or refactor current control-plane composition.
- [x] Register Studio routes under `/api/studio/` through an explicit module
      registration function.
- [x] Add module-local README documentation with import and ownership rules.
- [x] Add the Studio run root to configuration without changing the meaning of the
      existing Platform Lab run root.

### 2. Contracts and catalog

- [x] Add TypeScript contracts for the records listed in the domain model.
- [x] Add schema versions and validation for comparison requests, strategy parameters,
      seeds, limits, and idempotency keys.
- [x] Define lifecycle states and legal transitions for comparisons and trials.
- [x] Add the first Studio catalog for the Context case and three strategies.
- [x] Ensure the effective manifest records fixed controls and the one changed
      component explicitly.

### 3. Runtime and first strategies

- [x] Implement the Studio comparison runner behind its narrow interface.
- [x] Implement fixed environment assembly for the replay model and local evidence
      profile.
- [x] Add the long-conversation/old-important-fact fixture with deterministic source
      IDs and grading input.
- [x] Implement `full-history` with explicit budget handling.
- [x] Implement `sliding-window` with explicit retention ordering and budget handling.
- [x] Implement `relevance-ranked` as a deterministic lexical-overlap baseline with
      explicit tie-breaking and source-order restoration.
- [x] Execute trials sequentially with the same fixture and fixed environment.
- [x] Emit events for assembly, strategy decision, context preparation, model request,
      model response, trial completion, and comparison completion.

### 4. Persistence, recovery, and API

- [x] Implement the Studio evidence store and atomic record writes.
- [x] Implement idempotent comparison creation and safe inspection.
- [x] Implement `POST /api/studio/comparisons`.
- [x] Implement `GET /api/studio/comparisons/:comparisonId`.
- [x] Implement `GET /api/studio/comparisons/:comparisonId/evidence/*` or an equivalent
      bounded evidence endpoint.
- [x] Implement cancellation and recovery-required projections.
- [x] Implement a read-only catalog projection for the eleven Studio component areas.
- [x] Verify current `/api/runs`, `/api/platforms`, and platform health routes still
      resolve through their existing handlers.

### 5. Documentation and user-surface handoff

- [x] Document the Studio API request and response examples.
- [x] Document the Studio evidence layout and how to inspect a comparison locally.
- [x] Document the replay adapter's limits and make clear that it is not a model
      quality benchmark.
- [x] Record the first context experiment procedure and interpretation limits.
- [x] Add a small follow-on note describing how the existing Studio UI can connect
      after the backend contract is verified; do not redesign that UI in this slice.

## Test coverage

### Unit tests

- [x] Validate valid and invalid Studio definitions, strategy parameters, limits,
      seeds, and idempotency keys.
- [x] Validate legal and illegal comparison/trial state transitions.
- [x] Verify Full History retains the expected source order and reports budget state.
- [x] Verify Sliding Window retains the expected newest complete messages and reports
      omitted source IDs.
- [x] Verify Relevance Ranked retains task-overlapping messages deterministically and
      reports omitted source IDs.
- [x] Verify both strategies produce the same result when the fixture fits without
      pressure.
- [x] Verify over-budget and unknown-token cases fail explicitly rather than
      fabricating a safe budget.
- [x] Verify an effective trial manifest differs only in the declared component
      strategy and its parameters.

### Integration tests

- [x] Start the existing Fastify application with the Studio module registered and
      execute complete two- and three-trial comparisons through the HTTP interface.
- [x] Verify comparison and trial evidence files exist with the required fields.
- [x] Verify repeating a request with the same idempotency key returns the same
      comparison without duplicate trial events.
- [x] Verify a different idempotency key creates a distinct comparison.
- [x] Inject a failure at each defined persistence boundary and inspect the resulting
      recovery-required or failed projection.
- [x] Verify cancellation between sequential trials leaves no fabricated second
      result.
- [x] Verify the existing Platform Lab run and health endpoints remain behaviourally
      unchanged.

### Manual acceptance checks

- [x] Start the normal Lab server command; no second Studio process is required.
- [x] Submit the documented Studio comparison request and inspect both trial
      contexts under the configured Studio root (the smoke check used a temporary
      root).
- [x] Confirm the two trials share scenario, model adapter, seed, limits, and fixed
      inputs while strategy identity differs.
- [x] Repeat the request with its idempotency key and confirm no duplicate trial is
      created.
- [ ] Stop the server during an injected persistence step, restart it, and confirm
      inspection reports the durable state honestly.
- [ ] Confirm no current Platform Lab run directory or platform evidence is modified.

## Required validation commands

```bash
pnpm --filter @agent-harness-lab/lab-server run typecheck
pnpm --filter @agent-harness-lab/lab-server run build
pnpm --filter @agent-harness-lab/lab-server run test -- --test-name-pattern Studio
pnpm --filter @agent-harness-lab/web run typecheck
git diff --check
```

The targeted test command may need to be replaced with the exact Studio test file
once it exists. The current repository's broader web typecheck has a pre-existing
Node test-type configuration issue; that failure must remain separate from Studio
validation if it is still present.

## Validation record for the current slice

- `pnpm --dir server run typecheck` — passed.
- `pnpm --dir server run build` — passed.
- `node --test server/dist/tests/studio/*.test.js` — passed, 19 tests, including the
  deterministic relevance-ranked Context strategy.
- `pnpm --dir server run test` — passed, 222 tests, including existing Platform Lab
  routes and runner tests.
- `pnpm --dir apps/web run typecheck` — passed; generated document metadata was
  unchanged by the check.
- `git diff --check` on the Studio/config/documentation changes — passed.
- Normal server-process smoke check with temporary roots and port — passed: Studio
  health, documented comparison POST, comparison inspection, evidence GET, and
  separate evidence files; the process was stopped cleanly afterward.

## Completion gate

- [x] Studio runs inside the existing Lab server and has no second process or port.
- [x] Existing Platform Lab routes and execution modules remain unchanged in
      behaviour.
- [x] A real two-strategy Context comparison can be created through the API; a third
      relevance-ranked strategy is also available through the same catalog and seam.
- [x] The fixed-versus-changed experiment envelope is enforced and recorded.
- [x] Comparison and trial evidence are durable, inspectable, and honest about
      unavailable metrics.
- [x] Duplicate requests, invalid input, cancellation, injected failures, and restart
      inspection are tested.
- [x] Documentation and local inspection instructions match the implementation.

## Commit discipline and handoff

- [ ] Keep the module boundary and contracts in a reviewable section.
- [ ] Keep the deterministic Context runtime and strategies in a reviewable section.
- [ ] Keep evidence/recovery and HTTP integration in a reviewable section.
- [ ] Keep tests and documentation with the behaviour they verify.
- [ ] Review `git status` and each diff before every commit; preserve unrelated user
      changes in the existing worktree.
- [ ] Record changed files, validation results, and known limitations in the handoff.

## Completion record

Complete this section only when archiving the plan.

**Completed:** `[YYYY-MM-DDTHH:MM:SS±HH:MM]`  
**Commits:** `[commit hashes or contiguous range]`

### Validation

- `[command]` — `[passed/failed and concise result]`

### Known limitations

- `[deliberate limitation or follow-up]`

### Historical-scope note

`[Record whether later Studio work changed the scope or architecture.]`
