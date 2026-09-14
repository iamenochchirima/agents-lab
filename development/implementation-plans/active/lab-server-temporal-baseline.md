# Lab server + Temporal baseline — implementation plan

**Created:** 2026-09-14T23:37:30+02:00
**Last updated:** 2026-09-15T01:39:52+02:00
**Status:** Active

## Start here

Before editing, read [repository rules](../../../AGENTS.md), the
[server boundary](../../../server/README.md), the
[control-plane boundary](../../../server/src/control-plane/README.md), the
[platform boundary](../../../server/src/platforms/README.md), and the
[Temporal platform note](../../../server/src/platforms/temporal/README.md).
Also inspect the existing
[Platform UI feature](../../../apps/web/src/features/platforms/README.md) before changing
browser code.

For optional design inspiration—not requirements—consult the
[reference harness code maps](../../../docs/research/harness-code-maps/README.md),
especially [OpenClaw](../../../docs/research/harness-code-maps/openclaw.md) for control
plane/runner separation and [Waku](../../../docs/research/harness-code-maps/waku.md) for
a readable small agent turn. Those maps link to the pinned Hermes, OpenClaw, and Waku
source repositories and local checkouts. Do not import their architecture or dependencies
without a concrete reason recorded in this plan or a decision record.

## Purpose

Build the first runnable Agent Harness Lab platform path. A person can use the existing
Platform UI to start one Temporal-backed agent run locally, observe its lifecycle, and
inspect durable evidence after it finishes.

This is not a plan to implement every platform, every scenario, or a full professional
agent. It creates the smallest honest laboratory slice that proves the important
boundaries work together:

```text
Platform UI
  → Fastify control plane
  → immutable run manifest
  → registered Temporal baseline runner
  → local Temporal workflow + worker
  → one model-backed agent turn
  → native + normalized event evidence
  → run result and UI inspection
```

Temporal is the first platform because it makes the durable-execution boundary concrete:
the control plane creates and observes a run, while the worker and workflow own the
platform-specific execution and recovery semantics.

## Definition of done

With local Temporal already available, these commands start the required processes:

```bash
./scripts/run_local_stack.sh
```

The command starts, or clearly instructs the developer how to start, the following
locally configured components:

```text
React/Vite UI       → http://127.0.0.1:<web-port>
Fastify control API → http://127.0.0.1:<api-port>
Temporal worker     → connects to the configured local Temporal endpoint
```

From the Temporal tab, a user can select the `baseline` variant, enter a prompt or
choose the first supported scenario, select the deterministic model or an opt-in
OpenRouter model, and submit a run. The UI then shows:

```text
Queued → Running → Completed | Failed | Cancelled
```

Each terminal run produces durable, inspectable evidence:

```text
lab/runs/<run-id>/
  config.json            # immutable effective run manifest
  events.jsonl           # normalized Lab events, in recorded order
  trajectory.json        # normalized execution path; not raw Temporal history
  metrics.json           # duration, counts, and explicitly unknown measurements
  result.json            # terminal outcome and summary
  logs/                  # control-plane and worker diagnostics, when retained
  artifacts/             # declared outputs; empty is valid for this first slice
  native/temporal.json   # selected Temporal identifiers and safe native references
```

The run is real only if the worker executes an actual Temporal workflow. The
deterministic model is allowed for repeatable tests, but no UI status, retry, workflow
history, or evidence may be fabricated.

## Fixed scope

- [ ] Run a Fastify control plane locally from `server/`.
- [x] Add a real Temporal baseline worker and workflow that connect to local Temporal.
- [x] Register the Temporal baseline as a runnable platform variant.
- [ ] Validate a run request and create an immutable effective manifest before dispatch.
- [x] Start one Temporal workflow per accepted run and retain its workflow identity.
- [x] Execute one small, model-backed agent turn inside the Temporal implementation.
- [x] Provide a deterministic model adapter for automated tests and local learning.
- [x] Provide one opt-in OpenRouter adapter for manual real-model verification.
- [ ] Persist normalized run events and a final result under `lab/runs/`.
- [ ] Preserve safe Temporal-native identifiers and diagnostics alongside normalized
      evidence.
- [ ] Stream or poll run status through the control API without exposing worker internals
      directly to the browser.
- [ ] Connect the existing Temporal UI to this API for submission and live observation.
- [ ] Support cancellation from the API and UI if the Temporal workflow has started.
- [ ] Demonstrate worker restart recovery at one controlled point.

## Explicitly out of scope

This slice does not add:

- the remaining platform runners or direct platform comparison execution
- a general framework-neutral agent-loop abstraction
- tools, skills, plugins, MCP, OAuth, social connections, gateways, or cron
- a full scenario catalogue, graders, evaluations, or experiment engine
- tool side effects, approvals, idempotency of external business operations, or subagents
- a generic database-backed run store; local durable run records are sufficient now
- live token streaming in the browser if it compromises a correct durable lifecycle;
  lifecycle events and final output are required, token streaming is optional
- production deployment, authentication, multi-user tenancy, or remote access

Do not add placeholders that look operational. A control or status appears in the UI
only after its API behaviour exists and is tested.

## What the first run does

The first agent definition is deliberately narrow: **single-turn prompt completion**.
It accepts a prompt, constructs only the declared initial instruction and prompt context,
requests text from the configured model adapter, and records the response as the run
result. It does not call tools or perform side effects.

The purpose is not to benchmark agent quality yet. It establishes a controlled workload
on which we can test dispatch, workflow ownership, retries, cancellation, evidence, and
worker recovery. Later agent definitions and scenarios must reuse these proven seams
without being forced into the same internal implementation.

## Ownership and boundaries

```text
apps/web/
  Presents configuration, submits requests, observes run state, and renders evidence.
  Never connects to Temporal or reads local run files directly.

server/src/control-plane/
  Fastify HTTP/SSE boundary, validation, immutable manifests, run registry,
  event/result read API, and runner dispatch. Never contains Temporal workflow logic.

server/src/platforms/temporal/
  Temporal client, worker, workflow, activities, retry/cancellation behaviour,
  baseline agent definition, and native Temporal telemetry.

lab/runs/
  Lab-owned, framework-independent retained evidence. It is not the Temporal database
  and must not be treated as workflow state.

Temporal
  Owns workflow history, command scheduling, retry execution, and durable recovery.
  It remains the source of truth for an in-flight Temporal workflow.
```

The control plane may know that a run is dispatched to `temporal/baseline`; it may not
make assumptions about activities, workflow state shape, or Temporal retry internals.
The Temporal variant may emit its native detail, but it must not write UI-specific state.

## Required interfaces

These interfaces are deliberate initial seams, not a generic agent framework. Keep them
small and revise them only when a concrete second platform proves a missing semantic.

### Run request

The API accepts a typed request containing only the first-slice inputs:

```text
platform: "temporal"
variant: "baseline"
task: { kind: "prompt", prompt: string }
model: { provider: "fake" | "openrouter", model: string }
experiment?: undefined
```

The server resolves this into an immutable effective manifest with generated run ID,
timestamps, selected configuration, server version, platform version, local Temporal
connection profile name, and safe model settings. It must exclude credentials.

### Runner contract

The control plane needs only enough knowledge to start and control a run:

```text
validate(manifest) → validation result
start(manifest) → platform execution reference
cancel(execution reference, reason) → accepted/rejected result
inspect(execution reference) → optional safe platform status
```

The first concrete implementation is `TemporalBaselineRunner`. Do not create broad
interfaces for tools, memory, context, agent messages, or durability until an actual
second implementation needs them.

## Delivery sequence and parallel work

The existing Platform UI is ready as a configuration shell, but its Run action must stay
unavailable until the server contract exists. Implement this slice in the following
order:

1. Commit the typed run request, run status, event, result, and error contract.
2. Commit Fastify bootstrap, validation, manifest creation, and local evidence ownership.
3. Commit the real Temporal client, worker, baseline workflow, and deterministic model
   path.
4. After step 1 is committed, a UI agent may add the API client and run-state views in a
   separate commit. It must use the committed contract and must not invent mock run
   responses or connect directly to Temporal.
5. Complete the end-to-end UI/server/worker acceptance checks after all three processes
   are running together.

Each step should produce a reviewable commit with its relevant tests and documentation.
The UI can be developed in parallel after the contract commit, but it cannot be declared
complete until it has been exercised against the real Fastify API and Temporal worker.

### Evidence contract

The control plane writes normalized events such as:

```text
RunCreated
RunDispatched
AgentStarted
ModelRequested
ModelCompleted
AgentCompleted | AgentFailed | AgentCancelled
RunCompleted | RunFailed | RunCancelled
```

Each event includes event ID, timestamp, run ID, correlation ID, source, and a
schema-versioned payload. The Temporal variant additionally records safe native fields:
namespace, task queue, workflow ID, run ID, workflow type, and selected activity names.
Never copy model credentials, raw request headers, or unredacted provider payloads into
evidence.

### Evidence ownership, ordering, and recovery

The control plane's `RunEvidenceStore` is the only writer of normalized `events.jsonl`,
`trajectory.json`, `metrics.json`, and `result.json`. A workflow never writes Lab files.
Instead, it durably retains a small ordered list of lifecycle **event intents** in its
workflow state. The control plane reads those intents through the runner during normal
operation or reconciliation after restart, then materializes each one idempotently.

Every event intent has a stable `runId + source + sourceSequence` identity. The evidence
store preserves ordering within each source and assigns a monotonic `recordedSequence`
when it writes the normalized record. Cross-source wall-clock order is not claimed;
the required causal order is `RunCreated`, `RunDispatched`, platform intents, then one
terminal `Run*` event. Reconciliation reuses identities, so restart cannot duplicate an
event or a terminal result.

If the control plane is unavailable, the Temporal workflow may continue, but browser
status and normalized evidence can be stale until the control plane returns. On restart,
the control plane reconciles only runs with an existing Lab manifest and stored Temporal
execution reference. A Temporal workflow with no matching manifest is an orphan: it is
never auto-adopted or displayed as a Lab run. A manifest whose execution reference cannot
be found is marked `reconciliation_required`, not fabricated as completed or failed.

`trajectory.json` records normalized phases and safe attempt references. `metrics.json`
records status, durations, model-call/attempt counts, and available token/cost values;
unavailable measurements are `null`, never invented as zero.

## Implementation checklist

### 1. Local development contract

- [x] Inspect the existing local Temporal installation and document its endpoint,
      namespace, UI availability, and the exact command required when it is not running.
- [x] Define a named local Temporal profile in committed example configuration; do not
      commit machine-specific paths, credentials, or production endpoints.
- [x] Add `server/.env.example` only for actual supported configuration values.
- [ ] Update `scripts/run_local_stack.sh` to start the web app, control API, and Temporal
      worker, with clear health checks and separate readable logs.
- [ ] Make the script detect an unavailable Temporal endpoint and fail with a useful
      instruction rather than silently starting a non-functional stack.
- [ ] Document how to start Temporal separately if the Lab deliberately does not own its
      lifecycle.

### 2. Server package and Fastify bootstrap

- [x] Add purposeful server dependencies: Fastify, schema validation, Temporal client and
      worker SDK, and a test runner. Record why each dependency is needed.
- [x] Add `dev`, `build`, `start`, `typecheck`, and `test` scripts to `server/package.json`.
- [x] Create a typed server configuration module with API host/port, run-root path,
      Temporal endpoint/namespace/task queue, allowed model adapters, and timeouts.
- [x] Implement a Fastify bootstrap with structured startup/shutdown handling.
- [x] Implement `GET /health` that reports only control-plane readiness and safe Temporal
      connectivity; it must not claim a worker is healthy without evidence.
- [x] Implement structured error handling, request IDs, and safe error responses.
- [x] Keep Fastify routes thin; route handlers call application services rather than
      filesystem or Temporal SDK code directly.

### 3. Run domain, manifest, and local evidence store

- [x] Define opaque `RunId`, run status, terminal result, event, and manifest types.
- [x] Define legal run transitions: `created → queued → running → completed|failed|cancelled`.
- [x] Reject illegal or duplicate terminal transitions.
- [x] Validate the initial request: Temporal/baseline only, non-empty bounded prompt,
      allowed model provider/model, and no unsupported scenario or experiment fields.
- [x] Resolve and atomically write `config.json` before any workflow starts.
- [x] Create append-only `events.jsonl` with deterministic serialization and correlation
      fields.
- [x] Materialize `trajectory.json` and `metrics.json` with explicit `null` values for
      unavailable measurements.
- [ ] Atomically write `result.json` on every terminal outcome.
- [x] Implement the control-plane-only evidence writer, stable event identities,
      idempotent reconciliation, and recorded/source sequence rules.
- [x] Mark missing or mismatched Temporal execution references as
      `reconciliation_required`; never auto-adopt orphan workflows.
- [x] Create `native/temporal.json` without treating it as the workflow's source of truth.
- [x] Detect incomplete/corrupt local evidence and report an actionable diagnostic; do not
      overwrite it silently.

### 4. Platform registry and Temporal runner adapter

- [x] Implement an explicit registry that exposes only `temporal/baseline` as runnable.
- [ ] Return honest unavailable status for all other planned platform variants.
- [ ] Implement `TemporalBaselineRunner` behind the small runner contract.
- [ ] Generate deterministic, traceable Temporal workflow IDs from the Lab run ID.
- [ ] Start one workflow per Lab run and store the returned native execution reference.
- [ ] Map cancellation requests to the appropriate Temporal cancellation mechanism.
- [ ] Implement safe inspection of workflow status for reconciliation after control-plane
      restart.
- [ ] Expose ordered workflow event intents and safe terminal summary data for
      control-plane reconciliation; the workflow must not write Lab evidence files.
- [ ] Keep Temporal imports inside the Temporal platform directory or an explicit server
      infrastructure adapter; they must not leak into UI or generic run-domain code.

### 5. Temporal worker, workflow, and activities

- [ ] Define a single named task queue for the initial local Temporal baseline.
- [x] Implement a worker process with explicit graceful drain and shutdown behaviour.
- [x] Implement one workflow per Lab run with durable workflow state limited to inputs,
      execution phase, and safe references needed for recovery.
- [x] Implement a model-request activity with explicit timeout and retry policy.
- [x] Make retry policy visible in the manifest and workflow event evidence.
- [x] Classify failures as pre-dispatch, provider-declared, or ambiguous-after-dispatch.
- [x] Permit automatic retry only when the adapter proves no provider request was sent.
      An ambiguous timeout, connection loss, or lost acknowledgement is terminal for this
      slice and records `failureKind: outcome_unknown` rather than sending the prompt
      again.
- [x] Use a stable provider-attempt ID for diagnostics. Do not claim exactly-once model
      execution; provider idempotency may be introduced only after it is verified for the
      selected provider.
- [ ] Emit native lifecycle detail at workflow/activity boundaries without duplicating
      normalized event-writing responsibilities unpredictably.
- [x] Handle workflow cancellation and ensure it reaches an in-flight model activity when
      the SDK/provider permits it.
- [ ] Choose and document a controlled recovery point for the first restart test—for
      example, after workflow start but before activity completion.
- [x] Ensure workflow code is deterministic and does not perform direct network/model I/O.

### 6. Baseline single-turn agent definition

- [x] Implement the baseline definition in
      `server/src/platforms/temporal/variants/baseline/` using its existing ownership
      directories.
- [x] Define the initial context precisely: declared system instruction plus user prompt.
- [x] Keep the model/action loop to one model request and one text response for this slice.
- [x] Record response text and safe usage metadata as the terminal run result.
- [x] Define clear provider, timeout, cancellation, and invalid-response error categories.
- [x] Do not add tools, skills, workspace access, memory, integrations, or side effects.

### 7. Model adapters

- [x] Implement a deterministic fake adapter first, including controlled chunk delay,
      pre-dispatch failure, ambiguous-after-dispatch failure, timeout, and cancellation
      fixtures for tests.
- [x] Guarantee that the fake adapter never makes a network request.
- [x] Implement one optional OpenRouter adapter behind the same platform-local model
      boundary.
- [x] Read the OpenRouter API key only from local environment configuration and redact it
      from errors, logs, manifests, events, and results.
- [ ] Make real-provider execution opt-in; automated tests must always use the fake model.
- [ ] Record only safe provider/model metadata and available usage data.
- [ ] Keep OpenRouter calls non-retryable after dispatch unless a documented, verified
      provider idempotency mechanism is deliberately introduced in a later change.

### 8. HTTP API and live observation

- [x] Add `POST /api/runs` to validate, manifest, create, and dispatch a run.
- [x] Add `GET /api/runs/:runId` to return current safe run status, manifest summary, and
      terminal result when present.
- [x] Add `GET /api/runs/:runId/events` as a bounded, reconnectable event stream or
      polling-compatible event endpoint; choose one and document the reconnection model.
- [x] Add `POST /api/runs/:runId/cancel` with idempotent user-facing semantics.
- [x] Add evidence read endpoints that expose only allowlisted files from the selected
      run directory; never accept arbitrary filesystem paths from the browser.
- [x] Define CORS and local-development origin behaviour explicitly.
- [x] Publish an API contract document and example requests/responses.

### 9. Platform UI integration

- [ ] Replace Temporal's unavailable execution path with a real submission path only for
      the runnable `baseline` variant.
- [ ] Keep all other platform cards and variants explicitly planned/unavailable.
- [ ] Add a small API client module; page components must not embed endpoint strings or
      transport logic.
- [ ] Submit the configured prompt/model to `POST /api/runs` and show validation failures
      beside the affected input.
- [ ] Render queued, running, completed, failed, and cancelled state from server evidence.
- [ ] Provide a compact run-detail view with manifest summary, event timeline, final text,
      result summary, and safe Temporal reference.
- [ ] Provide cancellation only when server status permits it.
- [ ] Handle API disconnect/reload by reconnecting or polling current server state; never
      infer completion solely from local browser state.
- [ ] Preserve the existing clean UI: no fabricated dashboards, metrics, charts, or
      infrastructure controls.

### 10. Documentation and operational learning material

- [ ] Update the Temporal platform README with architecture, local dependencies,
      ownership, and limitations of the baseline.
- [ ] Add a local-run guide: start Temporal, start stack, submit fake run, inspect run,
      cancel run, and stop stack.
- [ ] Add an architecture document showing control plane, Temporal worker, workflow,
      activity, evidence store, and UI data flow.
- [ ] Document what is durable in Temporal versus what is retained as Lab evidence.
- [ ] Document retry, cancellation, control-plane restart, and worker-restart semantics.
- [ ] Add a development-playground exercise that deliberately fails, cancels, and restarts
      a worker, with exact evidence to inspect.
- [ ] Update relevant UI documentation, repository map, and navigation only after the
      implementation paths exist.

## Test coverage

### Server and domain unit tests

- [x] configuration validation, safe defaults, and missing Temporal configuration errors
- [x] run request validation and rejection of unsupported platform/variant combinations
- [x] manifest construction, immutability, and secret exclusion
- [x] legal and illegal run status transitions
- [x] event schema, ordering, correlation, and JSONL serialization
- [x] stable event identities, source ordering, recorded ordering, and reconciliation
      deduplication
- [x] atomic result/evidence writing and corrupt-record diagnostics
- [x] trajectory and metrics serialization, including unavailable metric values
- [x] platform registry runnable versus planned/unavailable status
- [x] OpenRouter configuration redaction and fake-adapter network isolation

### Temporal integration tests

- [ ] a fake-model run starts a real local Temporal workflow and reaches `completed`
- [ ] workflow/activity identifiers are linked to the correct Lab run record
- [ ] successful run writes manifest, ordered normalized events, native Temporal evidence,
      trajectory, metrics, and terminal result
- [ ] deterministic model failure exercises the configured activity retry policy and ends
      with an accurate failed result after retries are exhausted only when the failure is
      proven pre-dispatch
- [ ] ambiguous-after-dispatch fake-model failure does not retry and records
      `failureKind: outcome_unknown`
- [ ] configured activity timeout produces accurate terminal evidence
- [ ] cancelling a queued/running run yields an honest cancelled result and no later
      successful completion
- [ ] worker restart at the documented controlled point allows the workflow to resume and
      finish exactly as Temporal semantics guarantee
- [ ] control-plane restart can reconcile an in-flight or completed workflow from its
      stored execution reference
- [ ] control-plane outage leaves workflow execution durable; restart materializes missed
      event intents once, in source order, without duplicate events or terminal results
- [ ] orphan workflow and missing-execution-reference paths are surfaced as documented
      diagnostics and are never silently adopted or fabricated
- [ ] repeated cancellation and status requests are safe and idempotent at the API level

### HTTP API tests

- [x] health endpoint distinguishes server-ready from Temporal-unreachable
- [x] valid submission returns run ID and initial queued/running status
- [x] invalid input returns structured, actionable validation errors
- [x] run detail returns only allowlisted safe evidence fields
- [x] events endpoint preserves order and supports the selected reconnect/poll model
- [x] cancellation endpoint reports accepted, already-terminal, and unknown-run cases
- [x] arbitrary path traversal or unapproved evidence-file access is rejected

### UI tests and manual acceptance

- [ ] UI API client handles successful, validation-error, failure, cancellation, and
      reconnect responses
- [ ] Temporal baseline can be submitted from the Platform UI with the fake model
- [ ] page refresh shows server-derived current status and final result
- [ ] the UI does not offer a runnable action for planned platforms
- [ ] manually run a successful fake-model workflow and inspect every retained file
- [ ] manually restart the worker at the documented recovery point and observe resumption
- [ ] manually cancel a running fake-model run and inspect terminal evidence
- [ ] manually run one OpenRouter request with a local key; verify no key appears in saved
      evidence or browser output
- [ ] manually stop Temporal and verify stack/API diagnostics explain how to recover

## Required commands and validation order

The exact package scripts are part of the implementation checklist. At completion, the
following must work without hidden local steps:

```bash
# Start the local development stack after Temporal is available.
./scripts/run_local_stack.sh

# Server checks.
cd server
npm run typecheck
npm test
npm run build

# Web checks.
cd ../apps/web
npm run typecheck
npm run build

# Repository whitespace/errors.
cd ../..
git diff --check
```

Temporal integration tests must either start against the documented local Temporal test
profile or fail explicitly when that profile is unavailable. They must never silently
skip durable-execution coverage.

## Completion gate

Do not mark this plan complete until every applicable checkbox is checked and all of the
following are true:

- [ ] A browser can start a real Temporal baseline run through the Fastify API.
- [ ] A real worker executes the workflow against local Temporal.
- [ ] The deterministic model supports repeatable automated success, failure, timeout,
      cancellation, and recovery tests.
- [ ] The UI reflects server-derived lifecycle state after refresh or reconnection.
- [ ] `lab/runs/<run-id>/` contains complete, correlated, inspectable evidence.
- [ ] Temporal-native identifiers are retained without claiming that Lab evidence replaces
      Temporal workflow history.
- [ ] Worker restart and control-plane restart behaviours are demonstrated and documented.
- [ ] OpenRouter use is optional, manual, and secret-safe.
- [ ] All required commands pass; the final handoff records exact validation results and
      any deliberate limitations.

## Commit discipline and handoff

- [ ] Commit each coherent, validated implementation section rather than accumulating one
      large end-of-plan commit.
- [ ] Include the section's relevant tests and documentation in the same commit when they
      change together.
- [ ] Review `git status` and each diff; preserve unrelated user changes.
- [ ] Record changed files, validation results, and known limitations in the handoff.
- [ ] Add the completion timestamp and all implementation commit hashes, or their range,
      before archiving this plan.
