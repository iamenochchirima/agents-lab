# Real agent tools and skills implementation plan

Status: proposal ready for review; implementation paused. Updated 2026-10-08.

This is a temporary development plan, outside curated Docs. Earlier uncommitted
implementation changes are drafts to review against this plan, not accepted
milestones. Updating the plan does not authorize resuming implementation.

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
- [ ] Map catalog, policy, connection, tool execution, skill and environment ownership.
- [ ] Identify reusable draft work, duplicated responsibilities and missing lifecycle behaviour.
- [ ] Resolve the capability-host decision and package/source terminology.
- [ ] Publish the supported-capability matrix for the four baseline platforms.
- [ ] Record decisions, alternatives and dependency rationale in permanent architecture notes.

Commit: `docs: define extensible capability architecture`.
Validation: compare actual interfaces and installed SDK versions. No broad tests.

### 2. Catalog, source contracts and admission

- [ ] Define descriptors, execution bindings, results and lifecycle contracts.
- [ ] Support trusted registration and declarative package contributions.
- [ ] Validate input schemas and reject duplicate identities or aliases.
- [ ] Resolve selected tools through existing profiles, grants and connection references.
- [ ] Record effective limits, source identity and model-facing declarations at admission.
- [ ] Keep credentials and private configuration out of model declarations and evidence.

Commit: `feat: add capability catalog and source contracts`.
Minimal checks: valid admission, invalid schema and denied operation.

### 3. Real source adapters and execution

- [ ] Adapt existing built-ins without changing their observable meaning.
- [ ] Implement configured MCP discovery/invocation with explicit protocol compatibility.
- [ ] Implement explicitly configured HTTP connector operations.
- [ ] Preserve rich results and distinguish protocol failures from operation failures.
- [ ] Establish authentication, connection ownership, cleanup and cancellation behaviour.
- [ ] Retain correlated call receipts; document duplicate dispatch and unknown outcomes.
- [ ] Reuse existing connection infrastructure where it already owns these responsibilities.

Commit: `feat: execute configured capability sources`.
Minimal checks: real MCP and HTTP calls, actionable failure feedback, and one
interrupted write with an unknown outcome. These checks do not establish complete
MCP conformance or model competence.

### 4. Skills and persistent task environments

- [ ] Discover actual SKILL.md packages and advertise permitted metadata.
- [ ] Support model-driven and explicit user activation.
- [ ] Read referenced resources with identity, digests and bounds.
- [ ] Retain active instructions through follow-ups and context compaction.
- [ ] Add actual workspace list/read/search/write/patch operations with scoped grants.
- [ ] Preserve files within a session and separate comparison sessions.
- [ ] Make script execution depend on a separately authorized execution tool.
- [ ] Provide a service task environment alongside the workspace example.

Commit: `feat: add skill activation and persistent task environments`.
Minimal checks: activation/resource reads, relevant context retention, same-session
continuity and separation between sessions. Path checks are not an OS sandbox.

### 5. Native platform integration and frontend

- [ ] Mastra: project catalog definitions into native SDK tools.
- [ ] LangGraph: project serialized definitions into Python's native tool node.
- [ ] Temporal: keep workflow declarations pure and source I/O in Activities.
- [ ] Restate: invoke sources through its durable action boundary.
- [ ] Preserve platform lifecycle information and framework-specific telemetry.
- [ ] Remove tool-name-specific registration branches for extensible sources.
- [ ] Show selected tools, available/active skills, connection status and effective permissions.
- [ ] Ensure approvals cover every displayed side-effecting operation.
- [ ] Show unsupported platform capabilities honestly.

Commits: coherent native integration slices, followed by
`feat: expose capability selection and effective permissions` for the frontend.
Minimal checks: add an independent catalog tool and invoke it on each supported
platform without changing its loop; inspect selection/approval in the actual UI.
Run relevant builds once integration settles.

### 6. Real-model acceptance and evidence

- [ ] Run the same workspace task on each supported platform: activate a skill,
      read its reference, inspect sources, create and verify an artifact, then apply a correction.
- [ ] Run a service task through MCP or a connector to inspect and update controlled state.
- [ ] Validate free-model availability and zero-price routing before live execution.
- [ ] Use task-appropriate output/execution allowances and record them consistently.
      Preserve existing baseline controls if this workload requires a separate experiment configuration.
- [ ] Retain model decisions, effective catalogs, skill activations, tool results,
      artifacts and native execution evidence.
- [ ] Check actual artifacts/effects independently of native completion status.
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

## Current evidence and handoff

Research and the earlier checklist were committed as `236a879`. Implementation
drafts remain uncommitted. Earlier checks and live attempts are exploratory evidence,
not completion of this revised plan. Observations included provider rate limits and
native completion without a verified saved artifact; those are not passing results.

Owned acceptance services were stopped when implementation paused. Existing user
services were preserved. Before resuming, verify repository state and service
ownership, review the drafts, then proceed from phase 1. Preserve earlier evidence.
