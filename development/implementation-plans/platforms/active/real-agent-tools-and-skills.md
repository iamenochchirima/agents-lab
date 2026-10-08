# Real agent tools and skills implementation plan

Status: implemented and verified on 2026-10-08, with recorded real-model limitations.

This is a temporary development plan, outside curated Docs. The implementation was resumed on 2026-10-08 and completed in separate
reviewable commits. This file remains the single checklist and evidence ledger.

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

The existing inline calculator and fixture routes remain compatible. The selected
capability host uses an authenticated internal HTTP interface so Python and TS
native workers can share implementations and configuration without importing each
other's code. Phase 1 resolved this boundary after reviewing the earlier drafts.
Resolve declarations before durable execution; never rediscover tools
inside workflow replay. The host rechecks retained run grants and revision before
execution. It is infrastructure, not an agent loop or a model proxy.

Prefer the existing JSON Schema contracts. Add Ajv as a direct pinned dependency
already present transitively, because handwritten argument switches cannot validate
arbitrary discovered schemas. Keep model SDK projections native.

## Architecture decisions

| Boundary | Decision and trade-off |
| --- | --- |
| Catalog | Extend the existing capability catalog with source contributions, stable identities and collision checks. Avoid a second catalog that disagrees with existing grants. |
| Authority | Existing policy and connection layers own permissions, credentials and scopes. Discovery and skill instructions grant no authority. Source adapters reuse these owners. |
| Admission | Record schemas, bindings, versions, digests, effective limits and policy decisions. Refresh catalogs for future admissions; reject changed sources rather than silently rebinding existing runs. |
| Native execution | Generate native declarations from catalog data. Each platform retains its own agent loop, lifecycle and execution boundary. |
| Source execution | Use a shared authenticated capability host for Python and TypeScript, with direct execution for local built-ins. Its service dependency avoids separate language-specific source implementations. |
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

- [x] Run the same workspace task on each supported platform: activate a skill,
      read its reference, inspect sources, create and verify an artifact, then apply a correction.
- [x] Run a service task through MCP or a connector to inspect and update controlled state.
- [x] Validate free-model availability and zero-price routing before live execution.
- [x] Use task-appropriate output/execution allowances and record them consistently.
      Preserve existing baseline controls if this workload requires a separate experiment configuration.
- [x] Retain model decisions, effective catalogs, skill activations, tool results,
      artifacts and native execution evidence.
- [x] Check actual artifacts/effects independently of native completion status.
- [x] Separate adapter correctness, harness behaviour, model behaviour and provider failures.
- [x] Update usage documentation and record validation limitations and commit identities.

Commit: `feat: add real capability acceptance workflows`.
Minimal checks: one workspace workflow and one service workflow per supported
platform. Label deterministic adapter checks separately from real-model observations.
Do not repeat large suites without a relevant change, failure or unresolved concern.

## Completion criteria

- [x] A new tool and skill package work without native agent-loop edits.
- [x] Workspace and service operations execute against real task environments.
- [x] Permissions, source identity and connection lifecycle have one clear owner.
- [x] Skill activation survives the relevant session/context lifecycle.
- [x] All four baseline platforms have inspectable evidence or explicit limitations.
- [x] Real-model outcomes include failures and unavailable providers honestly.
- [x] Frontend and permanent documentation match implemented capabilities.
- [x] Coherent commits contain only this milestone's changes; unrelated work is preserved.

## Current position and evidence

All six implementation phases are complete. The primary agent inspected all
sixteen native turn records, saved artifacts, service state, routing evidence
and remaining limitations. Completion here means the capability implementation
and its acceptance procedure work; it does not mean every model obeyed every step.

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
- The restarted final API returned persisted skill/reference identities from an
  actual Mastra session, with only id/version/digest fields and no instruction text.

### Actual-model observations and completion audit

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

The four-platform trial is retained at
`lab/runs/.evals/capabilities-51211f00-2c24-4bd6-b6b6-98cb8afc14ae/summary.json`.
It includes eight task observations and sixteen native turn records. Every record
has config, events, trajectory, metrics, result, context, native identity and
correlated source receipts. Every service namespace has Avery at revision 3;
every workspace has the corrected report.

| Platform | Workspace | Service |
| --- | --- | --- |
| Mastra | Passed | Passed |
| LangGraph | Failed requested fresh read before edit | Failed requested skill activation |
| Temporal | Passed | Passed |
| Restate | Saved/verified artifact; final response exceeded deadline | Failed requested skill activation |

The original CLI used the TS phased observation shape to verify routing. A focused
cross-native check exposed and fixed that assumption. The separate
`routing-review.json`, produced by the documented offline review command, confirms
free routing for every turn without replacing the original report. Each retained
request uses exact Nemotron, max_tokens 2048, four zero-price ceilings and disabled
fallback. Actual skill receipts also confirm the named procedure on passing tasks;
the CLI now checks that exact identity rather than accepting any skill load.

The Restate deadline case was inspected after asynchronous cancellation and is
terminal cancelled. The earlier interrupted LangGraph run is explicitly
reconciliation-required with SERVICE_RESTARTED. Neither was blindly redispatched.
No acceptance job remains active.

Additional commits: `31f2b73` fixes cross-native routing evidence and adds offline
review; `d567e74` grades the requested skill identity; `6ef799d` clarifies that
workspace writes create parent directories. One focused routing test passed;
server build passed after the grader changes. Permanent scenario, experiment,
architecture and usage documents match the implemented boundary. The frontend
bundle and actual selection/approval UI were verified; the unrelated Lina full
frontend typecheck limitation remains recorded above.

### Requirement-by-requirement audit

- [x] Extensible tools and skills: generic snapshots plus scripted native catalog
  proof on all four actual runtimes, actual model-driven skill/resource reads,
  explicit activation admission and persistent context checks.
- [x] Real workspace and service environments: actual files, MCP/HTTP dispatch,
  state revisions, per-session separation and sixteen retained native turns.
- [x] Ownership and recovery: architectural responsibility table plus authenticated
  host/approval/source-drift/receipt/unknown-effect and cleanup checks.
- [x] Native and frontend integration: SDK tools, Python node, Temporal Activities,
  Restate actions, honest unsupported variants, all-action approval and skill UI.
- [x] Real-model evidence: identical free-model/task controls across four platforms,
  independent effect checks, retained failed outcomes and explicit limits.
- [x] Documentation and commits: permanent use/architecture/scenario/experiment
  documents, separate implementation commits, unrelated Studio/Lina preserved.

Owned service handles must be revalidated before reuse. No service is proven live
merely because a plan names its port. Acceptance services are local development
infrastructure, not a deployed or hardened multi-tenant environment.
