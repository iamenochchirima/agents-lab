# General backend agent eval gap closure

**Created:** 2026-10-08
**Status:** Planned — checklist prepared; implementation has not started.
**Scope:** Mastra, LangGraph, Temporal and Restate baseline variants.

## Goal and constraints

Identify and close the remaining implementation and measurement gaps in the Lab's
agent evals. These are general-purpose agents running on backend platforms.
Customer support and document editing are disposable scenarios, not an agent category
or product requirement. Native filesystem management remains excluded; optional
file/document access uses connected tools. Internal evidence storage is unchanged.

This is one substantial implementation phase covering diagnosis, missing evaluators,
necessary runtime fixes and usable result inspection. Do not split it into unrelated
small projects or implement new features merely to occupy an estimated hour.

- Keep native orchestration in each platform; no universal agent loop or Pi replacement.
- Preserve the completed connected-tool, authority, effect and approval contracts.
- Use currently verified free models only for unattended execution, with zero-price
  routing and no paid fallback. Do not model-shop or rerun until a report is green.
- Run a few meaningful checks per change; defer broad hardening and large live campaigns.
- Commit coherent chunks throughout. Preserve unrelated Studio/Lina/context work.
- Keep this temporary plan outside `docs/`; publish enduring usage and contracts separately.

## Start here

- [Development rules](../../../../AGENTS.md)
- [Core/live/optional eval specification](../../../../lab/scenarios/platform-agent-conformance/eval-cases.md)
- [Experiment protocol](../../../../lab/experiments/agent-harness-baseline/README.md)
- [Current executable commands](../../../../lab/experiments/agent-harness-baseline/development-evals.md)
- [Completed core milestone](../completed/cross-platform-agent-behaviour-milestone.md)
- [Completed connected-tool milestone](../completed/connected-business-agent-tools.md)
- [Capability trial and failure observations](../../../../lab/experiments/agent-capabilities-live/README.md)
- [Bounded compatibility contract](../../../../docs/guides/connected-tool-compatibility.md)
- [Documentation rules](../../../../docs/contributing/documentation.md)

Inspect installed versions and primary upstream documentation when an actual runtime
change depends on framework behavior. Existing research is a starting point, not
permission to assume newer APIs behave identically.

## Verified starting position

Planning checkpoint: `82cf800`, branch `main`. Unrelated working-tree changes are
primarily Studio/Lina and context research and must not enter this phase's commits.

| Area | Retained evidence | Remaining gap |
| --- | --- | --- |
| B01–B12 core | 48 passing case reports: 12 per baseline, one trial each | This predates the final connected-tool changes; three clean trials at one frozen revision are still required for the protocol's readiness claim. |
| L01–L06 live companions | 16 pass, four human assessments pending, four provider/runtime errors | L IDs are executable probes, not complete coverage of every M requirement. |
| M02 correction | L03 retains a marker | Marker recall does not measure French → English correction → later report; that full case is missing. |
| Human assessment | L05 retains answers, rubric and `reviewRequired`; Evals displays them | No retained adjudication submission path was found. |
| Connected capabilities | Latest eight outcomes: two pass, three strict fail, three error | Three support failures skipped skill activation despite delivered instructions; document errors involve different native/observer timeout scopes. |
| Approval | Four native recovery paths and actual LangGraph browser approve/deny passed | Normalize existing proof against X04; do not rebuild working approvals. |
| X01–X03 | Recovery/idempotency/event experiments exist; some underlying behavior has focused evidence | Named executable extension coverage and applicability remain incomplete. |
| X05 compaction | Existing compaction behavior and neutral context-stress data | Scenario data alone has no answer grader; full native constraint/provenance acceptance is not established. |
| Other variants | Not covered by the four-baseline results | Expansion is a later phase, not an implied result of this one. |

Historical verdicts remain immutable. The latest capability report is
`lab/runs/.evals/capabilities-7dfe1b7d-8d1c-4832-8939-95afae85c949/summary.json`.
Core invocation IDs and live regrade lineage are in the completed core milestone.

## Ownership and architecture

| Layer | Owns |
| --- | --- |
| Scenarios | Neutral tasks, safe fixture inputs, expected observable behavior and graders |
| Experiments/eval drivers | Frozen controls, fault schedule, trial submission, observations and applicability |
| Native baseline | Instructions, model/tool progression, checkpoints, deadlines and cancellation |
| Context/capability services | Skill activation/persistence, frozen catalogs, authority and effect receipts |
| Evidence/control plane | Durable reports and assessment records, validated API access and safe projections |
| Evals frontend | Coverage, failure details and human assessment flow; no model execution or policy enforcement |

Reuse existing owners. No new agent-definition product, business-agent abstraction,
filesystem runtime, arbitrary plugin executor or broad catalog expansion is required.
Framework-specific evidence stays alongside normalized observations.

Primary code seams to inspect: `server/src/control-plane/application/run-service.ts`
and `domain/manifest.ts` for admission; `server/src/capabilities/extensions/skills.ts`,
`extensions/host.ts` and `context/context-service.ts` for actual skill delivery;
the four baseline runner/workflow/model modules for native limits;
`server/src/evals/capabilities.ts` for observer cancellation;
`server/src/control-plane/domain/eval-report.ts` and
`application/eval-results.ts` for result contracts; and
`apps/web/src/features/evals/` for inspection and assessment.

## Implementation checklist

### 1. Establish the gap matrix and executable acceptance contracts

- [ ] Inspect every B/M/X requirement and map it to exact variant/profile, executable
  fixture, grader, retained run and verification revision. Cross-reference L IDs explicitly.
- [ ] Classify each cell as observed pass/fail, blocked, not exercised, not implemented
  or not applicable, with reason; distinguish implementation coverage from measured success.
- [ ] Audit claimed optional capabilities per variant. A capability cannot become
  not applicable merely because its test fails; do not infer guarantees from a framework name.
- [ ] Inspect each latest failure's mapped model requests, tools, active skills,
  source receipts and native timeout evidence; record harness/model/provider/environment
  or unresolved attribution with evidence. Do not label every timeout a harness defect.
- [ ] Define the smallest native acceptance for each required gap before implementing it.
  Freeze fixture/grader versions and passing/failing controls.

Acceptance: a contributor can identify what remains and why without reconstructing
old chats. Commit the matrix/contracts with their documentation as chunk 1.

### 2. Resolve skill/context delivery and execution-budget gaps

- [ ] Trace metadata → autonomous loader call → instruction/resource injection →
  next mapped model request on all four baselines. Confirm active content survives
  follow-up, review continuation and compaction where those capabilities are claimed.
- [ ] Compare autonomous discovery against the existing explicit `requestedSkillIds`
  path. Use separately labelled controls; preloading must not pass an assertion
  requiring the model to choose the loader.
- [ ] Correct only demonstrated omissions, role/correlation defects, stale skill
  context or manifest/request discrepancies. If delivered content is correct, retain
  skipped activation as model noncompliance; do not enforce a scripted tool sequence.
- [ ] Trace requested/effective maxRounds, logical calls, SDK steps, provider deadlines,
  active generation segment, tool deadline and driver observation deadline.
- [ ] Define accurate budget semantics and expose effective values in evidence.
  Fix demonstrated lost settings or deadline propagation. Align comparison controls
  only where their semantics are comparable; equal numbers do not imply equal scopes.
- [ ] Record the comparison choice: per-request budget, total active budget or
  deliberately different native defaults. Decide whether Restate needs an explicit
  request deadline and how it interacts with replay; define whether review waiting
  counts toward the observer window. Retain eventual cancellation separately from
  status observed at the deadline rather than generic "Observation interrupted."
- [ ] Preserve suspended review time separately from active execution. After timeout
  or cancellation, retain in-flight uncertainty and prohibit unsafe write redispatch.
- [ ] Verify one affected native path per changed runtime with a synthetic provider;
  run the affected free-model workflow once after the correction and retain its outcome.

Acceptance: actual requests establish correct context delivery and actual execution
establishes declared limits. Model noncompliance stays visible. Commit skill/context
and budget fixes separately when both are needed; include narrow checks and docs.

### 3. Implement missing live correction and retained human assessment

- [ ] Add a versioned M02 companion using one fresh session: request a French report,
  correct the language to English, then ask for the report again. Retain all three
  turns and verify the correction reaches actual model context.
- [ ] Separate deterministic context assertions from semantic language/correction
  assessment. Define a rubric and known passing/failing controls before live trials;
  ambiguous answers remain review-required. Do not silently repurpose L03.
- [ ] Add a validated, durable human assessment operation for retained review-required
  cases. Bind it to invocation, case/trial, evidence digest and rubric/grader version.
- [ ] Store assessment identity, reviewer attribution, rationale, timestamp, rubric
  answers and outcome. Local reviewer attribution must not imply authenticated identity.
  Duplicate identical submissions replay; conflicting reuse rejects. A later revised
  assessment is a new record with explicit lineage, not an overwrite.
- [ ] Preserve original report/verdict; project the separate assessment and its source.
  Objective failures cannot be overridden by an unrelated subjective assessment.
- [ ] Add Evals controls to inspect answers/rubric and submit an assessment. Keep human
  judgment explicit; do not fabricate a human reviewer or auto-pass the four old cases.
- [ ] Execute the new correction task once per applicable native baseline with one
  verified free model and frozen controls. Retain provider errors separately.

Acceptance: correction behavior is measurable and a real assessment survives reload
without rewriting historical evidence. Commit new live case/grader, assessment
persistence/API, and frontend integration as coherent chunks.

### 4. Make claimed optional capabilities executable and inspectable

Use existing runtime mechanisms and integration proof before adding implementation.
This phase tests named boundaries, not an exhaustive crash/fault campaign.

- [ ] X01: define applicable persistent variants and adapt existing restart checks to
  versioned eval evidence. Exercise one boundary before persistence and one after it;
  record repeated model requests separately from tool effects. Fix only demonstrated
  resume/state defects. In-process survival alone cannot establish restart recovery.
- [ ] X02: use a provider supporting a declared idempotency key; lose acknowledgement
  after an actual disposable effect. Inspect independent state and recovered receipt.
  Keep unknown-effect stopping and explicit reconciliation distinct from provider-safe
  retry; do not claim exactly-once effects for arbitrary connected tools.
- [ ] X03: for variants claiming event processing, exercise duplicate and out-of-order
  logical inputs with independent state inspection. Declare ordering/deduplication
  semantics beforehand. If unclaimed, record not applicable with rationale.
- [ ] X04: map existing pending-review restart, approve/deny, expiry/renewal and
  cancellation proof into the extension contract. Reuse current native admission;
  avoid duplicating approval infrastructure or rerunning unaffected fixtures.
- [ ] X05: force one compaction boundary with neutral task constraints. Verify summary
  provenance and actual post-compaction request; assess retained constraints in the
  answer separately. Exclude unrelated Studio context research from implementation.
- [ ] Register selected extensions in the eval command/API and result projection;
  retain native references and assertions, not only a platform-wide capability badge.

Acceptance: every claimed extension has an executable bounded case or an explicit
remaining gap. Commit each independent extension integration with its documentation;
reuse passing evidence only when revision, controls and contract actually match.

### 5. Surface coverage and perform focused acceptance

- [ ] Show the coverage matrix in Evals by exact variant and B/M/X case, separating
  scripted mechanics, live decisions, subjective assessments and extension applicability.
- [ ] Expose failure category, failed assertion, delivered context/skill evidence and
  effective deadlines through progressive disclosure. Unknown data must remain unknown.
- [ ] Show original and assessed/regraded outcomes with lineage. Do not combine them
  into an inflated score or rank frameworks from these few trials.
- [ ] Verify the actual UI path: inspect a gap → open evidence → assess a review-required
  answer → reload and see the retained assessment. Record screenshot and identities.
- [ ] Update scenario/experiment commands and permanent usage docs to match implementation.
- [ ] Run affected native cases once at the final implementation revision. Repeat only
  after a relevant change, unresolved issue or explicit readiness gate.
- [ ] Audit unresolved failures individually and record next action. No required
  implementation checkbox may be checked solely because the runtime returned `completed`.

Acceptance: the user can see what passes, what remains and the evidence behind each.
Commit the frontend surface and final acceptance/documentation separately.

## Minimal validation and readiness gates

Per implementation chunk: one meaningful passing control and one failing control for
new graders; normal/replay/conflict behavior for assessment storage; one actual native
boundary per changed runtime. Existing checks are reused rather than cloned.

Existing commands, select only affected files/cases:

```sh
pnpm --filter @agent-harness-lab/lab-server run build
node --test server/dist/tests/platform-conformance/live-graders.test.js
node --test server/dist/tests/context/active-skills.test.js
node --test server/dist/tests/evals/behaviour-evidence.test.js
pnpm --filter @agent-harness-lab/web run typecheck
pnpm --filter @agent-harness-lab/lab-server run eval:baseline -- --platform langgraph --cases B03,B07 --trials 1
pnpm --filter @agent-harness-lab/lab-server run eval:live -- --platform langgraph --cases L05 --model nvidia/nemotron-3.5-lightning:free --trials 1
pnpm --filter @agent-harness-lab/lab-server run eval:capabilities -- --api http://127.0.0.1:4322 --platforms langgraph --tasks service --deadline-ms 300000
pnpm --filter @agent-harness-lab/web run generate:docs
git diff --check
```

These are examples of existing narrow entry points, not a requirement to run every
command after every chunk. Verify current service addresses, roots and eligibility
before execution. Add exact new M02/extension/assessment commands when their contracts
are implemented; do not publish nonexistent commands as runnable examples.

- [ ] Record validation commands/results per chunk, including skips and prerequisites.
- [ ] Keep one-trial development acceptance separate from the protocol's three-clean-trial
  core readiness gate and larger live characterization campaign.
- [ ] If declaring full core readiness, execute all B01–B12 three times per selected
  baseline at one final frozen revision and controls; all assertions must pass.
  Otherwise explicitly leave readiness incomplete. Do not repeatedly run full suites.
- [ ] Defer the protocol's ten-trial live characterization campaign under the user's
  minimal-testing requirement. One live observation cannot establish stable success rates.

## Evidence, failure and security contracts

- [ ] Scenario and experiment records include versions, configuration, exact model,
  tools, context/memory, environment, fault placement, identities and timestamps.
- [ ] Evidence store owns immutable run artifacts; assessment persistence has one
  designated writer and atomic publication before success acknowledgement.
- [ ] On lost assessment acknowledgement, retry the same identity; no model or tool
  work is redispatched. Partial writes cannot project a completed assessment.
- [ ] After restart, reconstruct assessment lineage and native state from persisted
  records. Missing evidence remains incomplete, never inferred success.
- [ ] Cancellation stops new work at declared boundaries; uncertain in-flight effects
  remain unresolved until separate evidence establishes their outcome.
- [ ] Credentials, connection authority and action policy remain server-owned;
  localhost deployment ownership is not relabelled authenticated multitenancy.
- [ ] Use fictional records and opt-in fault namespaces; no production writes,
  external messaging, account changes or arbitrary local process execution.

## Definition of done and completion audit

- [ ] Original request and general-agent scope are rechecked; no business specialization
  or native filesystem capability has been introduced.
- [ ] Coverage and failure attribution are explicit for every scoped B/M/X requirement.
- [ ] Demonstrated runtime defects are corrected and evidenced; unresolved model/provider
  failures remain visible with actionable classification.
- [ ] Missing correction evaluation and durable assessment flow work end to end.
- [ ] Applicable claimed extensions have executable evidence; unsupported/unclaimed
  capabilities and remaining blockers are honestly represented.
- [ ] Focused native/free-model/UI validation and documentation checks are recorded.
- [ ] Implementation completion, core readiness and live reliability are separately
  reported. This plan does not require concealing errors or making every free-model run pass.
- [ ] Every coherent chunk is committed with tests/docs relevant to it; final diff
  excludes unrelated changes and generated private state.
- [ ] Record completion date, commit hashes, commands, observations and remaining limits;
  move this plan to `completed/` only after the implementation audit passes.

## Commit checkpoints

1. Coverage matrix and accepted case contracts.
2. Demonstrated skill/context correction, if required.
3. Native execution-budget/evidence correction, if required.
4. Versioned correction task and grader controls.
5. Assessment storage/API and replay semantics.
6. Assessment frontend and actual browser verification.
7. Each coherent applicable extension integration and needed native fix.
8. Coverage UI, final acceptance evidence and permanent documentation.

Do not accumulate these into one final commit. An investigation finding no runtime
bug produces an evidence/documentation checkpoint, not an invented patch.

## Current position and evidence ledger

Planning only. Parallel read-only audits inspected eval coverage and native
skill/budget failure evidence. No model calls, runtime edits or eval reruns were
performed to create this plan. First implementation item: milestone 1 coverage and
acceptance contracts. No known prerequisite blocks planning; live provider capacity
and genuine human assessment may later limit measured acceptance.
