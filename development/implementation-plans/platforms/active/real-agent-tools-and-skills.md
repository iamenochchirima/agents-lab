# Real agent tools and skills implementation plan

Status: implementing; resumed by user on 2026-10-08.

This is a temporary development plan, outside curated Docs. Earlier uncommitted
implementation changes are drafts to review against this plan, not accepted
milestones. The user has now authorized completing this standalone milestone.

This document owns the complete next tools-support milestone: architecture,
adapters, skills, task environments, native platform integration, frontend,
acceptance evidence and commit checkpoints. It is independent of the earlier
baseline-eval plans.

## Goal and scope

Real tool/skill packages can be added without changing native agent loops. Preserve
native Mastra, LangGraph, Temporal and Restate execution. Use Waku, Pi, Hermes and
primary tool/skill specifications as research references. Keep catalog discovery,
permissions, execution, context and evidence distinct. Add actual workspace and
skill resources plus configured MCP/HTTP integrations, not simulated tool results.

Research reference: [Waku, Pi, Hermes, MCP and Agent Skills](../../../../docs/research/extensible-agent-capabilities.md).

Adding a tool to an existing adapter or adding a skill package should require a
catalog/configuration change. Adding a new execution backend requires an adapter,
without changing the native agent loops. Completion means agents can perform real
workspace and service tasks and apply a follow-up correction with inspectable evidence.

## Constraints

- Preserve unrelated Studio/Lina changes.
- Commit coherent slices with relevant documentation.
- Free models only for unattended acceptance; no paid fallback.
- Focused behaviour checks, one useful live task per native profile; avoid redundant
  full test runs. No arbitrary plugin code installation or implied permissions.
- Temporary plan outside docs; permanent cited research and usage notes in docs/code.

## Design and alternatives

The existing inline calculator and fixture routes remain compatible. The proposed
capability host uses an authenticated internal HTTP interface so Python and TS
native workers can share implementations and configuration without importing each
other's code. Phase 1 settles this boundary before accepting the draft. Resolve declarations before durable execution; never rediscover tools
inside workflow replay. The host rechecks retained run grants and revision before
execution. It is infrastructure, not an agent loop or a model proxy.

Prefer the existing JSON Schema contracts. Add Ajv as a direct pinned dependency
already present transitively, because handwritten argument switches cannot validate
arbitrary discovered schemas. Keep model SDK projections native.

## Architecture decisions to settle

| Boundary | Recommendation and trade-off |
| --- | --- |
| Catalog | Extend the existing capability catalog with source contributions, stable identities and collision checks. Avoid a second catalog that disagrees with existing grants. |
| Authority | Existing policy and connection layers own permissions, credentials and scopes. Discovery and skill instructions grant no authority. Review drafts for duplicated connection ownership. |
| Admission | Record schemas, bindings, versions, digests, effective limits and policy decisions. Refresh catalogs for future admissions; reject changed sources rather than silently rebinding existing runs. |
| Native execution | Generate native declarations from catalog data. Each platform retains its own agent loop, lifecycle and execution boundary. |
| Source execution | Prefer a shared authenticated capability host for integrations used by Python and TypeScript, with direct execution for local built-ins. Compare its service dependency with separate language-specific clients before finalizing. |
| Results | Preserve structured values, content blocks, status, correlation and bounded original detail. Record omissions in model projections. String-only conversion loses useful evidence. |
| Skills | Metadata first, activation on demand, resources when needed, plus explicit user activation. Retain active instructions across follow-ups and compaction. |
| Packages | Packages group contributions; adapters provide execution backends. Arbitrary executable plugin loading needs a separate trust and isolation design. |
| Effects | Known failures can become model feedback. Unknown dispatch outcomes stop automatic retry unless the adapter establishes a safe retry contract. Framework durability alone does not make external effects exactly-once. |

Source adapters own connection startup, discovery, invocation, cancellation intent
and cleanup. The model cannot supply credentials, connection endpoints or executable
entry points. Provider-compatible names retain original source identities.

Workspace, service and future browser environments use the same capability boundary.
Filesystem access is one environment, not a requirement for every agent.

## Full implementation phases

The phases below are the single implementation checklist for this milestone.
Each phase ends with a focused commit and its relevant validation.

### 1. Reconcile architecture and review drafts

- [x] Research primary sources and inspect existing runtime coupling.
- [x] Map catalog, policy, connection, tool execution, skill and environment ownership.
- [x] Identify reusable draft work, duplicated responsibilities and missing lifecycle behaviour.
- [x] Resolve the capability-host decision and package/source terminology.
- [x] Publish the supported-capability matrix for the four baseline platforms.
- [x] Record decisions, alternatives and dependency rationale in permanent architecture notes.

Commit: `docs: define extensible capability architecture`.
Validation: compare actual interfaces and installed SDK versions. No broad tests.

### 2. Catalog, source contracts and admission

- [x] Define descriptors, execution bindings, results and lifecycle contracts.
- [x] Support trusted registration and declarative package contributions.
- [x] Validate input schemas and reject duplicate identities or aliases.
- [x] Resolve selected tools through existing profiles, grants and connection references.
- [x] Record effective limits, source identity and model-facing declarations at admission.
- [x] Keep credentials and private configuration out of model declarations and evidence.

Commit: `feat: add capability catalog and source contracts`.
Minimal checks: valid admission, invalid schema and denied operation.

### 3. Real source adapters and execution

- [x] Adapt existing built-ins without changing their observable meaning.
- [x] Implement configured MCP discovery/invocation with explicit protocol compatibility.
- [x] Implement explicitly configured HTTP connector operations.
- [x] Preserve rich results and distinguish protocol failures from operation failures.
- [x] Establish authentication, connection ownership, cleanup and cancellation behaviour.
- [x] Retain correlated call receipts; document duplicate dispatch and unknown outcomes.
- [x] Reuse existing connection infrastructure where it already owns these responsibilities.

Commit: `feat: execute configured capability sources`.
Minimal checks: real MCP and HTTP calls, actionable failure feedback, and one
interrupted write with an unknown outcome. These checks do not establish complete
MCP conformance or model competence.

### 4. Skills and persistent task environments

- [x] Discover actual SKILL.md packages and advertise permitted metadata.
- [x] Support model-driven and explicit user activation.
- [x] Read referenced resources with identity, digests and bounds.
- [x] Retain active instructions through follow-ups and context compaction.
- [x] Add actual workspace list/read/search/write/patch operations with scoped grants.
- [x] Preserve files within a session and separate comparison sessions.
- [x] Make script execution depend on a separately authorized execution tool.
- [x] Provide a service task environment alongside the workspace example.

Commit: `feat: add skill activation and persistent task environments`.
Minimal checks: activation/resource reads, relevant context retention, same-session
continuity and separation between sessions. Path checks are not an OS sandbox.

### 5. Native platform integration and frontend

- [x] Mastra: project catalog definitions into native SDK tools.
- [x] LangGraph: project serialized definitions into Python's native tool node.
- [x] Temporal: keep workflow declarations pure and source I/O in Activities.
- [x] Restate: invoke sources through its durable action boundary.
- [x] Preserve platform lifecycle information and framework-specific telemetry.
- [x] Remove tool-name-specific registration branches for extensible sources.
- [x] Show selected tools, available/active skills, connection status and effective permissions.
- [x] Ensure approvals cover every displayed side-effecting operation.
- [x] Show unsupported platform capabilities honestly.

Commits: coherent native integration slices, followed by
`feat: expose capability selection and effective permissions` for the frontend.
Minimal checks: add an independent catalog tool and invoke it on each supported
platform without changing its loop; inspect selection/approval in the actual UI.
Run relevant builds once integration settles.

### 6. Real-model acceptance and evidence

- [ ] Run the same workspace task on each supported platform: activate a skill,
      read its reference, inspect sources, create and verify an artifact, then apply a correction.
- [ ] Run a service task through MCP or a connector to inspect and update controlled state.
- [x] Validate free-model availability and zero-price routing before live execution.
- [x] Use task-appropriate output/execution allowances and record them consistently.
      Preserve existing baseline controls if this workload requires a separate experiment configuration.
- [x] Retain model decisions, effective catalogs, skill activations, tool results,
      artifacts and native execution evidence.
- [x] Check actual artifacts/effects independently of native completion status.
- [ ] Separate adapter correctness, harness behaviour, model behaviour and provider failures.
- [ ] Update usage documentation and record validation limitations and commit identities.

Commit: `feat: add real capability acceptance workflows`.
Minimal checks: one workspace workflow and one service workflow per supported
platform. Label deterministic adapter checks separately from real-model observations.
Do not repeat large suites without a relevant change, failure or unresolved concern.

## Completion criteria

- [ ] A new tool and skill package work without native agent-loop edits.
- [ ] Workspace and service operations execute against real task environments.
- [ ] Permissions, source identity and connection lifecycle have one clear owner.
- [ ] Skill activation survives the relevant session/context lifecycle.
- [ ] All four baseline platforms have inspectable evidence or explicit limitations.
- [ ] Real-model outcomes include failures and unavailable providers honestly.
- [ ] Frontend and permanent documentation match implemented capabilities.
- [ ] Coherent commits contain only this milestone's changes; unrelated work is preserved.

## Current position and evidence

Phases 1–5 are implemented and checked. Phase 6 is running the actual free-model
workspace and service trials. Keep completion unproven until every requested
platform/task observation is retained and its limitations inspected.

### Implementation checkpoints

- `e138820`: architecture ownership and native boundary decisions.
- `77a2dd0`: immutable catalogs, schema validation and result contracts.
- `3160cd7`: configured MCP/HTTP adapters reuse existing connection infrastructure.
- `98d413c`: authenticated host, packages, isolated workspaces and persistent skills.
- `108c85e`: four native projections and separate free capability experiment controls.
- `4ee7525`: frontend selection, complete approval lists and persisted skill identities.
- `82dc54b`: actual service environment and shared acceptance driver/scenario documents.

Only milestone files were staged. Concurrent Studio/Lina and context research work
remains untouched and uncommitted by this task.

### Verification ledger

- Server build passed after integration and the persisted-skill UI projection.
- Catalog/tools/policy checks: 25 passed, including schema references, collisions,
  non-coercion and explicit write authorization.
- Host/source/packages/active-skill checks: 8 passed, including authenticated
  admission, deduplication, pending receipts, source drift, interrupted writes,
  source cleanup, session separation and compaction retention.
- Admission checks: 2 passed for explicit skill/profile restrictions before turn
  creation and persisted authority-free activation.
- Native scripted acceptance: all 8 actual SDK/worker/workflow executions passed.
  Evidence: `lab/runs/.capability-proof/native-catalog-81ce3439-c1ec-4658-add2-7a8a63e7e293/summary.json`.
  Scripted decisions prove adapter execution, not real-model task competence.
- Free policy and Mastra checks: 17 passed, including parallel tool calls sharing
  a model round while call and round limits remain separate.
- Related Temporal/Restate/LangGraph/admission checks: 114 passed, 2 opt-in native
  tests skipped. The native catalog proof above covers actual native dispatch.
- Controlled service and skill projection: 2 passed, covering real MCP/HTTP edits,
  stale revision rejection, restart persistence, compaction and safe UI identities.
- Frontend production bundle passed. Full typecheck is currently blocked by
  concurrent `lina/contracts/modelInterface.ts` JSON typing changes. No capability
  type errors remain in its output; do not modify unrelated Lina work.
- Actual UI verified on the owned frontend: both write operations appear for
  approval, package tools are displayed, and explicit evidence-report selection
  works. Screenshot: `/tmp/agentlab-capability-selection.png`.
- Scenario/experiment links resolve and documentation generation passed.

### Actual-model observations underway

The first Mastra report is retained at
`lab/runs/.evals/capabilities-3fab0e3b-e65f-4007-a1c3-9c2ef50a33c5/summary.json`.
It failed because the in-process tool client used port 4318 while the owned server
used 4322. The runtime now derives its default from the configured API port;
remote workers still require an explicit host URL. This failed result remains.

A later LangGraph trial retained successful skill/resource/file operations before
its owned native worker disappeared. The interrupted report is
`lab/runs/.evals/capabilities-5b74d591-2e47-4892-89e4-fbb87bfcf607/summary.json`.
Workers were restarted only after process and health evidence established they
were absent. No observation timeout alone triggered redispatch.

A fresh four-platform trial is running at
`lab/runs/.evals/capabilities-51211f00-2c24-4bd6-b6b6-98cb8afc14ae/summary.json`.
Mastra has executed actual skill/resource/document reads, report creation,
read-back verification and the correction through Nemotron's free model decisions.
Its strict workspace verdict passed both turns. Service and remaining platform
verdicts remain pending. Do not substitute native completion for effect checks.

Current owned services: API 4322, task service 9196, frontend 5173, LangGraph 2024,
Temporal 7233 with the capability queue, and isolated Restate 18080/19070/19080.
Revalidate live handles when resuming; services are not evidence merely because
this ledger names them.
