# Mastra baseline platform

**Created:** 2026-09-15T10:59:45+02:00<br>
**Last updated:** 2026-09-15T12:59:15+02:00<br>
**Status:** Active — implementation integrated; archival validation pending<br>
**Owner:** Platform implementation agent<br>
**Platform:** mastra<br>
**Variant:** baseline

## Start here

Read these before changing code:

- [repository rules](../../../AGENTS.md)
- [server ownership](../../../server/README.md)
- [server architecture](../../../server/src/control-plane/README.md)
- [platform ownership](../../../server/src/platforms/README.md)
- [runner interfaces](../../../server/src/control-plane/ports/README.md)
- [completed server platform foundation](../completed/server-platform-foundation.md)
- [Mastra platform scaffold](../../../server/src/platforms/mastra/README.md)
- [documentation guide](../../../docs/contributing/documentation.md)
- [first-party source audit](../../../docs/research/platform-plan-source-audit.md)

Mastra references used for this plan:

- [Mastra project structure](https://mastra.ai/reference/project-structure) for the
  native TypeScript layout and entry point.
- [Mastra agents](https://mastra.ai/docs/agents/overview) for Agent, generate(),
  stream(), model selection, and agent registration.
- [Mastra tools and MCP](https://mastra.ai/docs/agents/mcp-guide) for the later tool
  and integration boundary. Tools are intentionally not part of this baseline.
- [Mastra memory](https://mastra.ai/docs/memory/overview) and
  [storage](https://mastra.ai/docs/storage) for deferred state variants.
- [Mastra workflows](https://mastra.ai/docs/workflows/overview) and
  [workflow snapshots](https://mastra.ai/en/reference/workflows/snapshots) for the
  deferred workflow and suspend/resume variant.
- [Mastra OpenRouter gateway](https://mastra.ai/models/gateways/openrouter) for the
  optional real-model profile.

The completed Temporal foundation is the contract source of truth. This plan must not
reopen the generic runner, manifest, execution-reference, or evidence interfaces unless
Mastra produces concrete evidence that the committed seam cannot express its behaviour.
If that happens, stop the platform implementation and record a separate contract change.

## Purpose

Add the first runnable Mastra path to the Lab so the same single-turn prompt workload
can run through Mastra's native TypeScript agent API. The baseline isolates Mastra's
agent construction and model call from the common server while making its actual
process-local durability limits visible.

This is a direct-agent baseline, not a Mastra workflow implementation. It lets the Lab
compare a native Mastra agent call with the existing Temporal path before adding memory,
tools, workflow snapshots, or external side effects.

## Current implementation status

The real Mastra `Agent.generate()` baseline, deterministic model fixture, process-local
runner, shared server registration, Platform UI wiring, documentation, and tests are
implemented. The fake-model path works without Temporal, Restate, LangGraph, or an
external provider. Process-local execution remains deliberately non-durable.

Verified in this wave:

- [x] 5 focused Mastra tests pass, including duplicate start, provider failure, ambiguous outcome, cancellation, and process loss.
- [x] A real Mastra run completes through the generic Fastify API and writes the complete Lab evidence set.
- [x] The first-wave server registry and Platform UI accept `mastra/baseline` without Temporal-specific assumptions.
- [x] Server, UI typecheck, UI build, and the full 64-test server suite pass.

Remaining before archival:

- [ ] Perform the optional real OpenRouter manual run and verify redaction from the retained evidence.
- [ ] Record the manual UI run and final plan commit hashes in the completion record.

## Platform and variant identity

| Field | Decision |
| --- | --- |
| Platform identifier | mastra |
| Display name | Mastra |
| Variant identifier | baseline |
| Display name | Mastra baseline |
| Status before this plan | Planned |
| Language and runtime | TypeScript on Node.js 22.18+; the current server toolchain remains the project baseline |
| SDK/framework version | Pin `@mastra/core@1.66.0` and any model-provider package to the exact resolved versions in the platform-owned package manifest; re-check official release metadata before implementation if the release has moved. |
| Execution model | One in-process Mastra Agent.generate() invocation per Lab run |
| Durability model | Lab evidence is durable on disk; in-flight Mastra execution is process-local and not crash durable |
| State model | Single-turn prompt state only; no Mastra memory or workflow storage in this variant |
| Environment | The Lab server's local Node.js process |
| Infrastructure | None for deterministic fake-model runs; OpenRouter is an optional external provider for manual runs |

### Definition of done

With the Lab server running, a client can submit a mastra/baseline prompt through
POST /api/runs. The Mastra agent executes the prompt through the real Mastra runtime,
the server exposes the run through the existing polling API, and the run directory
contains normalized evidence plus a safe Mastra execution reference.

    POST /api/runs
      → generic server manifest
      → Mastra baseline runner
      → Mastra Agent.generate()
      → normalized Lab evidence + native/mastra.json

The completed implementation must be able to:

- [ ] accept a mastra/baseline prompt with the existing run request shape;
- [ ] execute a real Mastra Agent.generate() call using a deterministic test model;
- [ ] optionally execute an OpenRouter model when the local provider profile and key are enabled;
- [ ] expose queued, running, completed, failed, cancelled, and reconciliation-required states through the existing API;
- [ ] retain config.json, events.jsonl, trajectory.json, metrics.json, result.json, and native/mastra.json;
- [ ] report process loss or an ambiguous provider outcome without fabricating completion;
- [ ] leave Temporal runnable and unchanged in behaviour.

## Scope

- [ ] Add the Mastra baseline agent factory, model selection, configuration, and runner adapter.
- [ ] Use the committed generic runner contract and register mastra/baseline as runnable only after real tests pass.
- [ ] Add deterministic model support for tests and an opt-in OpenRouter path for manual verification.
- [ ] Map Mastra execution events, usage, output, failures, cancellation, and unknown outcomes into the common evidence model.
- [ ] Add platform tests, a real local server integration path, and API/UI compatibility checks.
- [ ] Document local execution, semantics, limitations, evidence, and upstream references.

## Explicitly out of scope

- Mastra workflows, workflow snapshots, suspend(), resume(), timers, events, or workflow retries.
- Mastra memory, LibSQL/Postgres storage, semantic recall, observational memory, or multi-turn threads.
- Tools, MCP, skills, plugins, OAuth, channels, gateways, browser access, sandboxes, or side-effecting integrations.
- Mastra Studio as a required dependency or user interface. The Lab UI remains the user surface.
- A separate Mastra deployment or worker process. The baseline runs inside the Lab server process.
- Automatic provider retries, exactly-once model calls, crash recovery of an in-flight invocation, or adoption of an orphaned invocation.
- Changes to the generic runner contract, normalized evidence schema, or Temporal implementation without a separate design decision.

## Architecture and ownership

### Boundary map

    server/src/control-plane/
      common request validation, manifest creation, lifecycle projection, and evidence writes

    server/src/platforms/mastra/
      Mastra configuration, Agent definition, model factory, in-process execution registry,
      runner adapter, native event mapping, and platform documentation

    server/src/control-plane/bootstrap/server.ts
      composition root that registers the Mastra runner beside the existing Temporal runner

    apps/web/src/features/platforms/
      common platform selection and run polling; no Mastra SDK imports

    lab/runs/<run-id>/
      normalized Lab records plus native/mastra.json

The runner adapter is the external seam. It should be a deep module: the common server
knows only how to validate, start, inspect, and cancel a run; the adapter hides Mastra
agent construction, AbortController handling, in-memory execution state, result mapping,
and native telemetry details.

Ownership rules:

- server/src/platforms/mastra/runner-adapter/mastra-runner.ts owns the PlatformRunner implementation and the process-local execution registry.
- server/src/platforms/mastra/variants/baseline/ owns the Mastra Agent, prompt/context mapping, model factory, and lifecycle translation used by the baseline.
- RunEvidenceStore remains the sole writer of lab/runs/<run-id>/ records. Mastra code must return event intents and safe references, not write Lab evidence directly.
- server/src/control-plane/bootstrap/server.ts is the only shared composition file that registers the runner. The platform agent must provide a factory that the integration owner can compose.
- apps/web/src/features/platforms/ may display generic run states and a Mastra label, but it must not import Mastra packages or inspect native fields in shared components.
- Mastra SDK types, model-router details, provider errors, and process-local state must not cross into common control-plane modules.

### Files allowed to change

| Workstream | Owned files/directories | Must not change | Handoff must include |
| --- | --- | --- | --- |
| Mastra runtime | server/src/platforms/mastra/**/*.ts | generic contracts, Temporal, other platforms | runner factory, config shape, lifecycle semantics, tests, known limits |
| Dependency/configuration | server/package.json, server/package-lock.json, server/.env.example only when required | unrelated dependency versions or scripts | exact package versions, environment variables, install and validation commands |
| Server integration | server/src/control-plane/bootstrap/server.ts and its focused tests | Mastra implementation internals, generic contracts | registration diff, degraded-start behaviour, health result |
| Platform tests | server/tests/platforms/mastra/**, server/integration-tests/mastra-baseline.test.ts | production code and shared contract tests | cases, fixtures, deterministic model assumptions, command output |
| UI compatibility | apps/web/src/features/platforms/PlatformRunnerPage.tsx and directly related platform UI files | server contracts, Mastra runtime | run flow, status labels, build/typecheck results |
| Documentation/playground | server/src/platforms/mastra/**/*.md, development/playground/mastra-baseline/ | runtime code and shared UI | links, commands, evidence inspection steps, known gaps |

Only the primary integration owner may edit shared bootstrap files. Only the dependency
owner may edit the server package manifest and lockfile. If another platform plan needs
one of those files, it must submit a separate focused integration change instead of
editing the file in parallel.

## Local dependencies and infrastructure

### Required services

| Dependency | Required for | Local start command | Readiness check | Unavailable behaviour |
| --- | --- | --- | --- | --- |
| Node.js 22.18+ | Mastra runtime and Lab server | already provided by the local toolchain | node --version | setup documentation reports the required version |
| @mastra/core | Agent construction and generate() | installed by npm --prefix server install | import/build check | Mastra runner is not registered as runnable if initialization fails |
| Deterministic test model | unit and integration tests | created by the test fixture | model fixture self-check | test fails; no fake production result is emitted |
| OpenRouter | optional real-model run | no local service; provide OPENROUTER_API_KEY | configuration check only, no paid health call | requested run is rejected clearly if the key/profile is absent |

Mastra runs in the Lab server process. There is no Mastra worker, database, Docker
container, or separate port in this baseline. The server can run the fake-model path
without Temporal. The existing all-platform local stack may still require Temporal for
the Temporal runner; Mastra acceptance must also use the server-only path so its local
requirements are tested independently.

- [ ] A clean checkout can install the pinned Mastra dependency with the existing server toolchain.
- [ ] ./scripts/run_local_stack.sh server starts the API without a Temporal server.
- [ ] The frontend can run separately against that API for manual UI verification.
- [ ] OPENROUTER_API_KEY is read from the existing ignored local environment path and never copied into a manifest or log.
- [ ] No Mastra storage directory or generated local database is committed.

### Configuration

- Configuration source: platform-owned environment loader plus the immutable common run manifest.
- Effective configuration in config.json: agent ID, invocation mode, Mastra version, storage mode, retry policy, timeout, and safe model selection. No credentials.
- Defaults: agent ID mastra-baseline-agent, agent.generate, storage none, model retry limit 0, and a bounded execution timeout.
- Validation failures: the runner returns a clear validation result; the HTTP layer exposes the existing API error shape.
- Provider profiles: fake uses the deterministic model fixture; openrouter maps the requested model to Mastra's openrouter/<model> format and requires OPENROUTER_API_KEY.
- Limits: one prompt, one in-process invocation, no tools, no external side effects, and no memory thread.

## Runner contract

The implementation must satisfy the committed PlatformRunner interface without adding
Mastra-specific fields to common types.

| Operation | Platform implementation | Inputs | Output | Failure/unknown outcome |
| --- | --- | --- | --- | --- |
| Validate configuration | variants/baseline/config/ and runner validation | immutable manifest | valid/reason | unsupported provider, empty model, missing OpenRouter key, or invalid timeout |
| Check availability | MastraBaselineRunner.checkConnection() | initialized agent/runtime | reachable status | reports initialization failure; does not make a paid model call |
| Start | runner-adapter/mastra-runner.ts | manifest | stable local execution reference | duplicate start returns the existing in-process reference; startup failure becomes dispatch failure |
| Inspect | runner execution registry and native result mapper | opaque reference | status, event intents, result, trajectory, metrics | missing process-local execution becomes not-found/reconciliation-required |
| Cancel | runner execution registry and AbortController | opaque reference and reason | accepted/already-terminal | cancellation race is reflected as cancelled or outcome-unknown, never assumed |

### Execution reference

    {
      "platform": "mastra",
      "variant": "baseline",
      "executionId": "<lab-run-id>",
      "native": {
        "schemaVersion": 1,
        "mastraVersion": "<resolved-version>",
        "agentId": "mastra-baseline-agent",
        "operation": "agent.generate",
        "processScoped": true,
        "storage": "none"
      }
    }

- The Lab run ID is the local invocation identity. It is unique in the run root and stable for the life of the process.
- native contains only safe identifiers and configuration facts. It must not contain API keys, headers, raw prompts, or raw provider responses.
- A repeated start() for the same run in one process must not launch a second model call.
- After a server restart, the reference cannot be used to recover the in-flight call. The adapter reports not-found and the common server records reconciliation_required.
- Cancellation uses the in-memory AbortController; there is no external platform cancellation address.

## Execution, durability, and state semantics

### Lifecycle

    received → validated → created → dispatched → running → completed
                                                 ↘ failed | cancelled | reconciliation_required

| Transition | Owner | Persisted before/after | Normalized event | Native detail |
| --- | --- | --- | --- | --- |
| Request accepted | common server | config.json and RunCreated before start | RunCreated | safe manifest configuration |
| Invocation registered | Mastra runner | in-memory execution record before generate() | RunDispatched, then AgentStarted | execution ID and agent ID |
| Model call | Mastra runtime | event intents returned by inspect() | ModelRequested, ModelCompleted or ModelFailed | safe step/usage summary only |
| Terminal result | common server | idempotent result.json, trajectory.json, metrics.json | AgentCompleted, AgentFailed, or AgentCancelled | no raw provider payload |
| Process loss | common server and runner | existing Lab records remain; no new result is invented | RunReconciliationRequired when inspected | retained reference is process-scoped |

### Durability and state

- lab/runs/<run-id>/ is the Lab's durable inspection record after the common server writes it.
- Mastra agent execution state, the promise, abort controller, and terminal result are process-local.
- The baseline owns no Mastra storage, memory thread, workflow snapshot, or checkpoint.
- A server restart before terminal evidence leaves the run without a recoverable Mastra execution. The common server returns reconciliation_required rather than failed or completed.
- A platform process restart is the same event because the runtime is in-process.
- There are no orphan adoption rules. A missing process-local invocation is not re-created automatically.
- inspect() is the source of status truth while the execution record exists. Repeated inspection returns the same source sequences and terminal result.
- The result cardinality is one terminal result.json per Lab run. Multi-turn and resume semantics belong to later variants.

### Failure, retry, cancellation, and side effects

- [ ] Mastra runner retries are disabled for the baseline unless the pinned API proves a retry occurs internally and exposes its count.
- [ ] The runner never repeats Agent.generate() after an ambiguous timeout or lost completion acknowledgement.
- [ ] A failure before the model request is classified as a known provider or configuration failure.
- [ ] A timeout, process crash, or provider error after the model request may have been sent is recorded as failed with failureKind outcome_unknown when the external outcome cannot be established.
- [ ] Cancellation before model dispatch is cancelled; cancellation after dispatch waits for the provider/abort result and records cancelled only when that result is known.
- [ ] A cancellation race with a completed response keeps the observed terminal result and records the race in native-safe event detail.
- [ ] No tool or business side effect is enabled, so the baseline has no external side-effect idempotency claim.
- [ ] Duplicate, out-of-order, and repeated inspection events are deduplicated by the existing evidence store and source sequence rules.
- [ ] The implementation claims at-most-one local invocation per run within one process, not exactly-once execution across restarts or provider boundaries.

## Native evidence and normalized records

The common RunEvidenceStore writes the native execution reference to:

    lab/runs/<run-id>/
      config.json
      events.jsonl
      trajectory.json
      metrics.json
      result.json
      native/mastra.json

Native evidence is schema version 1 and contains the safe execution reference shown
above. Mastra-specific step names, usage, and lifecycle details belong in safe event
payloads and the normalized trajectory. Do not copy raw provider responses into native
evidence.

- Native writer: the common RunEvidenceStore through writeExecutionReference().
- Event source: mastra, with monotonically increasing adapter source sequences.
- Result cardinality: one terminal result per run. Repeated inspection writes identical content only.
- Atomicity: use existing common evidence-store idempotent writes; the platform must not write run files directly.
- Compatibility: use the generic execution-reference schema; no legacy Mastra evidence exists to migrate.
- Allowlist: only native/mastra.json is exposed for this run. Traversal and other native filenames remain rejected.
- Retention: follow the existing local lab/runs policy. Provider secrets, raw headers, and internal stack traces must be redacted from retained evidence.
- Measurements: record only real usage and duration returned by Mastra/provider metadata. Unknown token or cost values remain null.

## Implementation checklist

### 1. Contract and design checkpoint

- [ ] Confirm the generic runner, manifest, execution-reference, and evidence contracts are sufficient.
- [ ] Record the direct-agent choice and the explicit absence of Mastra workflows, memory, storage, and tools.
- [ ] Pin the Mastra package version and confirm the model-router/OpenRouter API against that version.
- [ ] Confirm file ownership and handoffs before parallel implementation begins.

### 2. Mastra runtime and runner

- [ ] Add platform-owned configuration and safe model selection.
- [ ] Add a factory for the baseline Agent with explicit instructions and no tools or memory.
- [ ] Add deterministic model injection for tests without mocking the Agent lifecycle itself.
- [ ] Implement the process-local execution registry, start idempotency, abort handling, inspection, and result mapping.
- [ ] Implement safe native reference and event payload construction.
- [ ] Register the adapter only after its unit and integration checks pass.

### 3. Server and UI integration

- [ ] Register mastra/baseline beside Temporal without changing Temporal startup or semantics.
- [ ] Verify the server starts in degraded Temporal mode and still reports Mastra availability honestly.
- [ ] Update the shared Platform UI only where its status label or runnable-platform handling is currently Temporal-specific.
- [ ] Keep Mastra native detail out of shared UI components unless a dedicated platform detail view owns it.

### 4. Documentation and learning material

- [ ] Replace the Mastra scaffold README with the actual runtime boundary, state model, local commands, and limitations.
- [ ] Add server/src/platforms/mastra/docs/local-development.md with server-only startup, fake-model flow, and optional OpenRouter flow.
- [ ] Add server/src/platforms/mastra/docs/semantics.md with retry, cancellation, restart, unknown-outcome, and evidence rules.
- [ ] Add development/playground/mastra-baseline/README.md only if it gives a focused hands-on inspection path; keep it separate from tests and experiments.
- [ ] Link the official Mastra references used for agent, model, storage, workflow, and OpenRouter decisions.

## Test coverage

### Unit tests

- [ ] configuration defaults, provider validation, timeout validation, and secret redaction
- [ ] baseline agent construction and deterministic model injection
- [ ] normal generate() completion, output, usage, trajectory, and event mapping
- [ ] provider failure, timeout, cancellation, and outcome_unknown mapping
- [ ] duplicate start within one process does not issue a second model call
- [ ] inspection after terminal completion is idempotent
- [ ] missing process-local execution produces a not-found error without fabricating a result
- [ ] native execution-reference shape and safe evidence fields
- [ ] event and log payloads omit API keys, headers, raw prompts, and raw provider responses where they are not required

### Integration tests

- [ ] start the Lab server without Temporal and submit a deterministic mastra/baseline run through the real HTTP path
- [ ] poll the run to completion and inspect all normalized records plus native/mastra.json
- [ ] exercise an unavailable OpenRouter profile without making a provider call
- [ ] cancel an in-flight deterministic run and inspect the terminal result
- [ ] replace the runner instance before inspection and verify reconciliation_required
- [ ] verify repeated polling does not duplicate events or overwrite a different terminal result
- [ ] verify the Temporal runner still passes its existing local integration suite
- [ ] run one opt-in OpenRouter request manually when a real key is available; do not make it part of default CI

### UI/API compatibility tests

- [ ] the API accepts mastra/baseline and returns the generic execution reference
- [ ] the Platform UI shows Mastra as runnable only when the registered runner is available
- [ ] run, poll, cancel, and inspect use shared generic fields rather than Temporal names
- [ ] the UI shows the honest unavailable or reconciliation state without implying Mastra durability

### Manual acceptance

- [ ] Start the API with ./scripts/run_local_stack.sh server while Temporal is stopped.
- [ ] Start the frontend separately and submit one fake-model Mastra run from the Mastra platform view.
- [ ] Inspect config.json, events.jsonl, trajectory.json, metrics.json, result.json, and native/mastra.json.
- [ ] Stop or replace the server before a run finishes and confirm the next inspection reports reconciliation rather than a made-up result.
- [ ] Run one opt-in OpenRouter prompt and verify the output is real while the key is absent from logs and evidence.

## Required validation commands

    npm --prefix server install
    npm --prefix server run typecheck
    npm --prefix server test
    npm --prefix server run test:mastra
    npm --prefix apps/web run typecheck
    npm --prefix apps/web run build
    git diff --check

test:mastra must use the deterministic model and must not require Temporal or an
external provider. The existing npm --prefix server run test:temporal remains required
for the final combined validation. The optional OpenRouter manual check requires
OPENROUTER_API_KEY, an explicitly enabled provider profile, network access, and a
deliberate model choice. It is never a default automated test.

## Documentation and release impact

### Documentation checklist

- [ ] Mastra platform and baseline variant docs match the actual files, commands, and package versions.
- [ ] Execution, state, restart, cancellation, retry, unknown-outcome, permissions, telemetry, and limitations are documented.
- [ ] The local setup guide states that Temporal is not required for the Mastra fake-model path.
- [ ] The playground, if added, shows how to inspect one real run and remains separate from published product docs.
- [ ] All local and upstream links are checked from a representative checkout.

### Release record

- Analytics: not applicable. This is a local laboratory platform registration with no product analytics.
- Structured logging: record run ID, execution ID, platform, variant, event kind, model provider, and safe error code. Never record credentials or raw provider headers.
- Metrics/telemetry: use the existing normalized duration, model-call, attempt, and usage fields. Leave unsupported cost or token values null.
- Version/release identity: record the resolved @mastra/core version in the manifest and native reference.
- Migration/compatibility: not applicable. No prior Mastra evidence schema exists.
- Rollout: local-only, initially enabled only after the adapter and integration tests pass.
- Rollback: remove the Mastra registration or pin it back to planned while retaining already-written run evidence.
- Security review: verify OpenRouter secrets are environment-only, native evidence is safe, and the baseline exposes no tools or side effects.
- Known limitations: direct in-process calls are not crash durable; workflow snapshots, memory, tools, and external side effects remain future variants.

## Commit boundaries

Use focused commits. Do not combine Mastra runtime, shared registration, UI changes,
tests, and documentation into one commit.

1. feat(mastra): add baseline runtime and pinned dependency
   - Owns platform TypeScript modules, model fixture seam, package manifest, and lockfile.
   - Validation: npm --prefix server run typecheck and focused Mastra unit tests.
2. feat(server): register Mastra baseline runner
   - Owns shared bootstrap registration and focused server/API integration wiring.
   - Validation: server typecheck, generic server tests, and deterministic Mastra HTTP run.
3. test(mastra): cover baseline lifecycle and recovery limits
   - Owns Mastra platform tests and integration tests.
   - Validation: npm --prefix server run test:mastra, full server tests, and existing Temporal integration.
4. feat(web): expose Mastra baseline status
   - Owns only the UI compatibility changes required by the real registered runner.
   - Validation: web typecheck, web build, and manual fake-model UI run.
5. docs(mastra): document baseline semantics and local inspection
   - Owns platform docs and the focused playground walkthrough, if needed.
   - Validation: documentation generator, link check, and git diff --check.

Before each commit:

- [ ] review git status and preserve unrelated Computer Native and platform work;
- [ ] review the exact staged diff and confirm no secret, generated state, or unrelated file is included;
- [ ] run the narrow validation for that commit;
- [ ] record the commit hash in the handoff;
- [ ] leave shared contract changes to the primary integration owner.

## Parallel-agent handoffs

Parallel work starts only after this plan is accepted and the dependency/contract
checkpoint is stable. The primary agent owns the generic contract, shared bootstrap
integration, conflict resolution, final review, and release decision.

| Workstream | Agent-owned files | Must not change | Handoff |
| --- | --- | --- | --- |
| Mastra runtime | server/src/platforms/mastra/**/*.ts | generic contracts, Temporal, bootstrap, UI | factory exports, config assumptions, semantics, focused tests |
| Dependency setup | server/package.json, server/package-lock.json, required Mastra env example lines | unrelated package upgrades and runtime code | exact resolved versions and install result |
| Server integration | server/src/control-plane/bootstrap/server.ts and focused bootstrap tests | Mastra implementation internals and common contracts | registration, degraded-start behaviour, health output |
| Evidence and lifecycle tests | server/tests/platforms/mastra/**, server/integration-tests/mastra-baseline.test.ts | production code, other platform tests | exact cases, deterministic fixtures, command output |
| UI compatibility | apps/web/src/features/platforms/PlatformRunnerPage.tsx and only directly related platform UI files | server code and Mastra SDK imports | screenshots or manual flow, typecheck/build output |
| Documentation | server/src/platforms/mastra/**/*.md, development/playground/mastra-baseline/ | runtime, server bootstrap, UI | links, commands, evidence observations, known gaps |

Every handoff must state:

- exact files changed and exact files deliberately not changed;
- commands run and their results;
- assumptions and unresolved questions;
- failure, cancellation, restart, and evidence behaviour covered;
- any dependency, migration, security, or release impact;
- whether the work is safe to integrate without reopening the generic runner contract.

No Mastra agent may add another real platform under this plan. LangGraph, Restate,
Vercel, Inngest, Trigger.dev, DBOS, Hatchet, and AWS Step Functions each need their own
copy of the platform template and their own file ownership map.

## Completion gate

Before moving this plan to completed/, verify:

- [ ] mastra/baseline is honestly registered as runnable only after real tests pass.
- [ ] The fake-model HTTP flow works without Temporal or an external provider.
- [ ] The optional OpenRouter path is documented and manually verified when credentials are available.
- [ ] Mastra agent execution, model errors, timeout, cancellation, duplicate start, and process-loss semantics are tested.
- [ ] Normalized and native evidence are inspectable, idempotent, and redacted safely.
- [ ] The UI/API does not claim workflows, memory, tools, or crash durability that this variant does not implement.
- [ ] Temporal still passes its existing unit and local integration checks.
- [ ] Platform docs, playground material, release decisions, limitations, and links are current.
- [ ] Each coherent implementation section has a focused commit with exact validation results.
- [ ] The completion record contains the final commit hashes and manual observations.
