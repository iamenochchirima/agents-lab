# General backend agent eval gap closure

**Created:** 2026-10-08
**Status:** Active, final observation exposed a cancellation/readiness gap under investigation.
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

- [x] Inspect every B/M/X requirement and map it to exact variant/profile, executable
  fixture, grader, retained run and verification revision. Cross-reference L IDs explicitly.
- [x] Classify each cell as observed pass/fail, blocked, not exercised, not implemented
  or not applicable, with reason; distinguish implementation coverage from measured success.
- [x] Audit claimed optional capabilities per variant. A capability cannot become
  not applicable merely because its test fails; do not infer guarantees from a framework name.
- [x] Inspect each latest failure's mapped model requests, tools, active skills,
  source receipts and native timeout evidence; record harness/model/provider/environment
  or unresolved attribution with evidence. Do not label every timeout a harness defect.
- [x] Define the smallest native acceptance for each required gap before implementing it.
  Freeze fixture/grader versions and passing/failing controls.

Acceptance: a contributor can identify what remains and why without reconstructing
old chats. Commit the matrix/contracts with their documentation as chunk 1.

### 2. Resolve skill/context delivery and execution-budget gaps

- [x] Trace metadata → autonomous loader call → instruction/resource injection →
  next mapped model request on all four baselines. Confirm active content survives
  follow-up, review continuation and compaction where those capabilities are claimed.
- [x] Compare autonomous discovery against the existing explicit `requestedSkillIds`
  path. Use separately labelled controls; preloading must not pass an assertion
  requiring the model to choose the loader.
- [x] Correct only demonstrated omissions, role/correlation defects, stale skill
  context or manifest/request discrepancies. If delivered content is correct, retain
  skipped activation as model noncompliance; do not enforce a scripted tool sequence.
- [x] Trace requested/effective maxRounds, logical calls, SDK steps, provider deadlines,
  active generation segment, tool deadline and driver observation deadline.
- [x] Define accurate budget semantics and expose effective values in evidence.
  Fix demonstrated lost settings or deadline propagation. Align comparison controls
  only where their semantics are comparable; equal numbers do not imply equal scopes.
- [x] Record the comparison choice: per-request budget, total active budget or
  deliberately different native defaults. Decide whether Restate needs an explicit
  request deadline and how it interacts with replay; define whether review waiting
  counts toward the observer window. Retain eventual cancellation separately from
  status observed at the deadline rather than generic "Observation interrupted."
- [x] Preserve suspended review time separately from active execution. After timeout
  or cancellation, retain in-flight uncertainty and prohibit unsafe write redispatch.
- [x] Verify one affected native path per changed runtime with a synthetic provider;
  run an affected free-model workflow once where it exercises the changed path and retain its outcome. A controlled native compaction request may verify a liveness-only change; do not rerun an unrelated live workload.

Acceptance: actual requests establish correct context delivery and actual execution
establishes declared limits. Model noncompliance stays visible. Commit skill/context
and budget fixes separately when both are needed; include narrow checks and docs.

### 3. Implement missing live correction and retained human assessment

- [x] Add a versioned M02 companion using one fresh session: request a French report,
  correct the language to English, then ask for the report again. Retain all three
  turns and verify the correction reaches actual model context.
- [x] Separate deterministic context assertions from semantic language/correction
  assessment. Define a rubric and known passing/failing controls before live trials;
  ambiguous answers remain review-required. Do not silently repurpose L03.
- [x] Add a validated, durable human assessment operation for retained review-required
  cases. Bind it to invocation, case/trial, evidence digest and rubric/grader version.
- [x] Store assessment identity, reviewer attribution, rationale, timestamp, rubric
  answers and outcome. Local reviewer attribution must not imply authenticated identity.
  Duplicate identical submissions replay; conflicting reuse rejects. A later revised
  assessment is a new record with explicit lineage, not an overwrite.
- [x] Preserve original report/verdict; project the separate assessment and its source.
  Objective failures cannot be overridden by an unrelated subjective assessment.
- [x] Add Evals controls to inspect answers/rubric and submit an assessment. Keep human
  judgment explicit; do not fabricate a human reviewer or auto-pass the four old cases.
- [x] Execute the new correction task once per applicable native baseline with one
  verified free model and frozen controls. Retain provider errors separately.

Acceptance: correction behavior is measurable and a real assessment survives reload
without rewriting historical evidence. Commit new live case/grader, assessment
persistence/API, and frontend integration as coherent chunks.

### 4. Make claimed optional capabilities executable and inspectable

Use existing runtime mechanisms and integration proof before adding implementation.
This phase tests named boundaries, not an exhaustive crash/fault campaign.

- [x] X01: define applicable persistent variants and adapt existing restart checks to
  versioned eval evidence. Exercise one boundary before persistence and one after it;
  record repeated model requests separately from tool effects. Fix only demonstrated
  resume/state defects. In-process survival alone cannot establish restart recovery.
- [x] X02: use a provider supporting a declared idempotency key; lose acknowledgement
  after an actual disposable effect. Inspect independent state and recovered receipt.
  Keep unknown-effect stopping and explicit reconciliation distinct from provider-safe
  retry; do not claim exactly-once effects for arbitrary connected tools.
- [x] X03: for variants claiming event processing, exercise duplicate and out-of-order
  logical inputs with independent state inspection. Declare ordering/deduplication
  semantics beforehand. If unclaimed, record not applicable with rationale.
- [x] X04: map existing pending-review restart, approve/deny, expiry/renewal and
  cancellation proof into the extension contract. Reuse current native admission;
  avoid duplicating approval infrastructure or rerunning unaffected fixtures.
- [x] X05: force one compaction boundary with neutral task constraints. Verify summary
  provenance and actual post-compaction request; assess retained constraints in the
  answer separately. Exclude unrelated Studio context research from implementation.
- [x] Register selected extensions in the eval command/API and result projection;
  retain native references and assertions, not only a platform-wide capability badge.

Acceptance: every claimed extension has an executable bounded case or an explicit
remaining gap. Commit each independent extension integration with its documentation;
reuse passing evidence only when revision, controls and contract actually match.

### 5. Surface coverage and perform focused acceptance

- [x] Show the coverage matrix in Evals by exact variant and B/M/X case, separating
  scripted mechanics, live decisions, subjective assessments and extension applicability.
- [x] Expose failure category, failed assertion, delivered context/skill evidence and
  effective deadlines through progressive disclosure. Unknown data must remain unknown.
- [x] Show original and assessed/regraded outcomes with lineage. Do not combine them
  into an inflated score or rank frameworks from these few trials.
- [x] Verify the actual UI path: inspect a gap → open evidence → assess a review-required
  answer → reload and see the retained assessment. Record screenshot and identities.
- [x] Update scenario/experiment commands and permanent usage docs to match implementation.
- [x] Run affected native cases once at the final implementation revision. Repeat only
  after a relevant change, unresolved issue or explicit readiness gate.
- [x] Audit unresolved failures individually and record next action. No required
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

- [x] Record validation commands/results per chunk, including skips and prerequisites.
- [x] Keep one-trial development acceptance separate from the protocol's three-clean-trial
  core readiness gate and larger live characterization campaign.
- [x] If declaring full core readiness, execute all B01–B12 three times per selected
  baseline at one final frozen revision and controls; all assertions must pass.
  Otherwise explicitly leave readiness incomplete. Do not repeatedly run full suites.
- [x] Defer the protocol's ten-trial live characterization campaign under the user's
  minimal-testing requirement. One live observation cannot establish stable success rates.

## Evidence, failure and security contracts

- [x] Scenario and experiment records include versions, configuration, exact model,
  tools, context/memory, environment, fault placement, identities and timestamps.
- [x] Evidence store owns immutable run artifacts; assessment persistence has one
  designated writer and atomic publication before success acknowledgement.
- [x] On lost assessment acknowledgement, retry the same identity; no model or tool
  work is redispatched. Partial writes cannot project a completed assessment.
- [x] After restart, reconstruct assessment lineage and native state from persisted
  records. Missing evidence remains incomplete, never inferred success.
- [x] Cancellation stops new work at declared boundaries; uncertain in-flight effects
  remain unresolved until separate evidence establishes their outcome.
- [x] Credentials, connection authority and action policy remain server-owned;
  localhost deployment ownership is not relabelled authenticated multitenancy.
- [x] Use fictional records and opt-in fault namespaces; no production writes,
  external messaging, account changes or arbitrary local process execution.

## Definition of done and completion audit

- [x] Original request and general-agent scope are rechecked; no business specialization
  or native filesystem capability has been introduced.
- [x] Coverage and failure attribution are explicit for every scoped B/M/X requirement.
- [ ] Demonstrated runtime defects are corrected and evidenced; unresolved model/provider
  failures remain visible with actionable classification.
- [x] Missing correction evaluation and durable assessment flow work end to end.
- [x] Applicable claimed extensions have executable evidence; unsupported/unclaimed
  capabilities and remaining blockers are honestly represented.
- [x] Focused native/free-model/UI validation and documentation checks are recorded.
- [x] Implementation completion, core readiness and live reliability are separately
  reported. This plan does not require concealing errors or making every free-model run pass.
- [x] Every coherent chunk is committed with tests/docs relevant to it; final diff
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

Milestone: completion audit. Correction, assessment, coverage UI and native extension
acceptance are implemented and committed. Browser Save → reload passed with an isolated
synthetic record labelled Automated UI fixture and outcome uncertain. Real semantic
judgments remain pending. One post-fix Restate free-model document workflow is underway.
Full final-revision core readiness is not claimed after the later Temporal heartbeat fix.

### Checkpoints

- `f323b3d`: L07/M02 suite3/grader4 correction task and explicit semantic rubric;
  server build and four grader controls passed.
- `6fff716`, `4e87c9b`: assessment storage/API, exact evidence-byte digest, replay,
  conflict and immutable original verdict; seven focused unit/HTTP checks passed.
- `28ee13b`, `856766e`, `d5148fe`: extension contracts and X04/X02 real native
  acceptance. All four X04 passed; all four X02 passed with independently inspected
  HTTP effect, lost acknowledgement and same-provider-key receipt recovery.
  Proofs: `native-review-ffeb524c-da66-4f47-a03f-c6cbd1f76163/extensions.json`
  and `native-review-3abed55d-0df9-4aed-b5c9-42c0d63e4185/extensions.json` under
  `lab/runs/.review-proof/`. Earlier policy-expectation failures remain retained.
- `7ecb4f6`: X01 Temporal/Restate native restart evidence; Temporal heartbeat worker
  loss now retains unknown dispatched outcome, while a start-to-close deadline
  remains a timeout. Actual provider attempts Temporal2/Restate3 were distinguished
  from one tool lookup each. Proofs `x01-temporal-20261008-cleanup/extensions.json`
  and `x01-restate-20261008-envelope/extensions.json`; revision is explicitly unknown.
- `b6f9582`: observer interruption cause, original native status and bounded later
  settlement are separate; effective budget scopes are recorded. Four controls passed.
- `9d1ede4`, `dc3a445`: Restate summary instruction correction and isolated native
  compaction driver. Focused workflow18/model13/compaction1 checks passed; initial
  oversized fixture errors and the later demonstrated summary failure are retained.
- Root coverage projection: two passing focused controls; extension evidence must
  match its assertions and retained completion, and absent variant identity cannot
  establish coverage. Frontend typecheck and two existing render checks passed.

### Decisions

- Autonomous activation and explicit preload remain different controls. The previous
  support failures had the activation instruction; no blanket forced loader sequence
  was added. Summary instruction delivery was the demonstrated context defect.
- X01 active restart recovery is applicable only to Temporal/Restate under current
  profile claims; Mastra/LangGraph waiting reconstruction is X04. X03 logical event
  processing is unclaimed on these workloads; telemetry ordering is not a substitute.
- Budget observations retain different native scopes. No unlimited deadline or paid
  model substitution was introduced to make reports green.
- One local plan remains the ledger. Unrelated Studio/Lina/context changes are preserved.

### Final acceptance checkpoints

- `6644a9b`, `9a1111b`: exact-variant coverage, validated native envelopes and UI
  assessment flow. Server build, two projection checks, two frontend rendering checks,
  frontend typecheck and production build passed. The build retains the existing large
  bundle warning; bundle optimization is outside this change.
- Actual browser acceptance on 2026-10-08: main localhost5173 coverage M02 → L07
  evidence inspector displays three answers, 22 passing objective checks and a pending
  semantic rubric. Optional LangGraph X02/X04/X05 show retained native passes and X01/X03
  honest applicability. No real answer was automatically assessed.
- Isolated browser fixture at localhost5174 / API4323: invocation
  `synthetic-ui-assessment`, L05 trial1, run
  `6dbfde14-5e6f-4956-a8ee-f081e412551f`. Save and reload retained one uncertain
  assessment, local attribution Automated UI fixture, and original blocked verdict.
  Screenshot: `lab/runs/.review-proof/eval-gap-ui/assessment-reloaded.jpg`.
  Fixture data is isolated under `/tmp/agentlab-synthetic-ui-assessment-7toXOP`; this
  form/storage check is not human judgment or agent-quality evidence.
- `09bfdf6`: 144 selected scripted core passes, three per B01–B12 per platform,
  at frozen runtime revision `dc3a445`, with unchanged tracked source hash. Selection
  `core-readiness-7580ef79-a62b-46db-b75d-2c59bd1a6c3f/readiness-selection.json`
  retains six prior Temporal fixture-configuration failures and one interrupted
  Restate error, with correction lineage. This is composite acceptance, not one
  clean all-platform batch. The later heartbeat fix means full final-revision
  readiness remains unmeasured.
- `7bb8a83`: Temporal context preparation now sends heartbeats while a summary
  request runs. A controlled two-second native summary failed before the fix in
  `compaction-abfa27a9-45a5-43eb-998e-ec9964efcbf1` and passed afterward in
  `compaction-0f23f5a6-ee2a-4f8c-a94e-a7c9c7185b5b`. Three affected B03 checks
  passed in `behaviour-9a8be7fa-4ec9-4db7-9b1e-a97512c8b995`.
- `19d7966`: new live summaries retain grader version4; original summaries with
  omitted grader metadata stay unchanged and are displayed as unavailable.
- `d5dcd0a`: one L07 free Nemotron trial per baseline retained zero semantic pass,
  one review-required LangGraph observation and three errors. Mastra's dispatched
  model timed out; Temporal lost its model Activity heartbeat with a live worker,
  cause unresolved; Restate referenced an unavailable native endpoint, now corrected.
  See `lab/experiments/agent-harness-baseline/l07-development-observation.md`.

### Remaining measurement limits and next actions

- Human reviewers can now assess the four old L05 cases and the new LangGraph L07
  case. No reviewer has supplied a real judgment; they remain pending.
- Temporal model heartbeat loss needs a focused liveness investigation with native
  heartbeat/throttling and event-loop evidence. The context-heartbeat fix does not
  establish its cause or make the failed live run pass.
- Mastra's free-model timeout needs provider/request timing evidence before changing
  budgets. Do not assume model noncompliance or silently raise every limit.
- Restate's registered endpoint must match the running service before another live
  correction trial. Corrected scripted checks establish deployment mechanics; the
  original live model made no observed call.
- General logical event processing remains unclaimed, so X03 is not applicable.
- Ten-trial live characterization and a fresh whole-suite final-revision core gate
  are deferred under the user's minimal-testing preference. Implementation completion
  does not mean every eval passes or establish production readiness.
- Native skill metadata, activation tool, persisted resources and mapped request
  injection use the existing shared context owner in all four baseline paths. The
  focused active-skills control passed restart/follow-up/compaction retention without
  authority grants. Historical real support trials retain model-skipped loader choices;
  no forced sequence was added. Native review continuation and bounded X05 proofs are
  complementary evidence, not a claim that every combined skill/review/compaction
  interaction has undergone a live reliability campaign.

- Final affected contract check: eleven grader/assessment/projection controls passed
  together, plus the existing active-skill persistence control and two frontend
  inspection render checks. Server build, frontend typecheck/production bundle and
  87-document catalog generation passed. Narrow HTTP submission checks are retained
  in the assessment checkpoint rather than rerunning unrelated API tests.
- Final API projection observed 84 cells: M02 is error on Mastra/Temporal/Restate and
  review-required on LangGraph. Fourteen applicable X cells pass, six are explicitly
  not applicable. Three malformed older native envelopes remain listed as incomplete.
- Synthetic assessment proof is durably copied under
  `lab/runs/.review-proof/eval-gap-ui/synthetic-fixture/`; saved identity
  `assessment-5c2c3dc5-fcbf-41b4-97d6-a2d3bead6632`. This copy is excluded from the real
  eval index. The isolated frontend test tab/server was closed after verification.

- Final affected free Restate document workflow retained
  `capabilities-0424dbac-941d-4625-aec4-79129f7dd37c`: skill discovery and
  evidence-report activation completed, but the next provider request exceeded the
  180-second observer window. No document writes were observed. Cancellation returned
  HTTP500 and bounded settlement remained unresolved. This exposed a further
  cancellation/readiness investigation; original error remains immutable.
