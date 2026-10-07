# Free-model live agent evals

**Created:** 2026-10-07
**Last updated:** 2026-10-08
**Status:** Implemented and verified for available platforms. Restate live validation remains blocked by its unavailable native service.

This is a temporary implementation checklist. Keep it in `development/implementation-plans/`,
outside `docs/`, and do not add it to the curated Docs navigation. Permanent usage and
methodology documentation should describe the implemented feature when it exists.

## Start here

- [Repository rules](../../../../AGENTS.md)
- [Previous scripted eval slice](agent-harness-baseline-evals.md)
- [Eval methodology and cases](../../../../lab/scenarios/platform-agent-conformance/eval-cases.md)
- [Existing development eval guide](../../../../lab/experiments/agent-harness-baseline/development-evals.md)

Preserve native platform execution, shared scenario inputs, supported evidence writers,
and the separation between model decisions and harness behaviour. The previous recorded
Mastra and LangGraph trials passed the scripted slice; Temporal and Restate were blocked
by missing services. Recheck availability before claiming current results.

## Purpose and definition of done

Run a small set of real model tasks through the actual platform harnesses, retain their
decisions and tool feedback, and show inspectable results in the Evals page. This answers
whether the environment lets a real model complete basic agent work.

Implemented command:

```bash
pnpm --filter @agent-harness-lab/lab-server run eval:live -- --platform mastra --model google/gemma-4-31b-it:free --trials 1
```

The same command accepts `langgraph`, then `temporal` and `restate` as their native
services become available. An invocation produces retained results and evidence links;
the Evals page shows the actual model, platform, task, verdict, and failure reason.
Missing prerequisites produce an honest blocked result. A blocked platform remains
unvalidated until a real trial succeeds.

```text
Shared task → native platform loop → real free model → real tool/context handling
            → retained evidence → task grader → visible result
```

## Scope and model policy

- [x] Default to `google/gemma-4-31b-it:free` through OpenRouter.
- [x] Offer `nvidia/nemotron-3.5-lightning:free` as an explicitly selected comparison.
- [x] Revalidate exact IDs, zero input/output pricing, and tool support before inference.
- [x] Enforce free-only provider routing at the actual request boundary using supported,
      verified provider controls. Fail closed if zero-cost routing cannot be established.
- [x] Never silently switch models or fall back to a paid endpoint. Paid interactive
      usage elsewhere in the app remains outside this eval policy.
- [x] Record requested and resolved model/provider identities, settings, routing policy,
      timestamps, revision, SDK versions, and environment for each trial.

These are selected starting candidates, not a promise of permanent availability or a
claim that either model is best. Freeze the same task and supported settings across
platforms. Record unsupported settings rather than pretending they were applied.

## First live tasks

| Task | Required behaviour | Evidence and grading |
| --- | --- | --- |
| Prompt completion | Follow a short instruction and return a supplied marker | Actual supplied instructions/input and final answer; check the marker and completion without demanding scripted prose |
| Calculator use | Explicitly use the calculator for `17 + 25`, then answer | Actual tool selection, valid arguments, successful result `42`, correlated feedback supplied to the next model call, and final numeric answer |
| Context continuation | Remember a synthetic marker across two turns in a fresh session | Actual ordered model inputs, shared session identity, and correct marker in the second answer |

The calculator task implements the live M01 intent. Give the other probes their own
versioned live task IDs; do not relabel them as completed M02–M04 or reuse scripted case
verdicts. Direct arithmetic without the explicitly requested tool fails the calculator
task even when the final number is correct.

Use objective task checks, without a second model as judge. Keep task success separate
from evidence completeness and infrastructure failures. Native call/round limits remain
controls; do not force the model into scripted exhaustion to manufacture a live result.

## Implementation checklist and commit boundaries

### 1. Live task contracts and free-only configuration

- [x] Define versioned inputs and graders for the three tasks.
- [x] Add explicit live/scripted report classification with backward-compatible reading
      of existing reports; preserve previous case meanings.
- [x] Validate model/tool capability and free routing before dispatch. Define bounded
      calls, rounds, output size, timeout, and supported model parameters.
- [x] Add focused policy and grader checks, including paid-route rejection before any
      model dispatch and a correct answer that skipped the required tool.
- [x] Commit this coherent contract/configuration slice with its tests.

### 2. Real observations and Mastra execution

- [x] Add opt-in, bounded observation at the real provider/SDK boundary. Existing fake
      model captures do not establish what a real model received.
- [x] Retain sanitized actual messages, tool schemas, calls, arguments, results, feedback,
      response metadata, and final output. Preserve useful native evidence.
- [x] Run the tasks through Mastra's existing native loop using the new `eval:live` driver.
- [x] Use one trial per task initially when credentials and quota are available.
- [x] Commit the Mastra execution slice, supported report writing, and usage notes.

### 3. LangGraph, then service-backed platforms

- [x] Apply the same tasks and observation contract to LangGraph's native loop.
- [x] Check Temporal/Restate setup and workers; use their actual service paths when ready.
- [x] Keep framework-specific APIs and lifecycle behaviour within each adapter.
- [x] Record missing services or unavailable quota as blocked, with the actionable reason.
- [x] Commit each platform integration separately after its focused validation.

Independent adapter work may use subagents once the common contract is stable. Keep
architectural decisions and integration with the primary agent.

### 4. Saved results in the frontend

- [x] Expose retained invocation/trial results through a bounded read API using supported
      evidence access and safe paths.
- [x] Add a compact results view to Evals: model, platform, task, verdict, reason, and
      links to the actual trajectory/tool evidence.
- [x] Separate live from scripted results; show empty and blocked states honestly.
- [x] Verify one real result can be inspected after refreshing the page.
- [x] Commit the result API and frontend slice with focused checks and usage documentation.

## Ownership, persistence, and failure semantics

The eval driver owns task admission, trial IDs, and invocation summaries. Platform runners
own execution and observations. Existing run/eval evidence storage remains the supported
writer of per-run artifacts; the frontend reads through the server, not arbitrary files.

- [x] Use `lab/runs/<run-id>/` for normal run records and supported eval artifacts;
      preserve `lab/runs/.evals/<invocation-id>/summary.json` for invocation outcomes,
      including trials blocked before a run exists.
- [x] Give every request, tool call, run, trial, and invocation a correlatable identity.
      A continuation trial references both runs and its fresh session.
- [x] Write observations during execution and final reports only once referenced evidence
      exists. Use existing atomic/idempotent storage rules and bounded report sizes.
- [x] Keep synthetic inputs and sanitized evidence; exclude keys, authorization headers,
      private user sessions, and unrelated prompts. Retain local evidence for inspection,
      without committing generated run data.
- [x] A fresh invocation creates fresh trial/session IDs. Do not overwrite or silently
      resume an interrupted trial. Mark incomplete evidence explicitly on read.
- [x] Distinguish missing dependencies, provider errors, timeouts, task failure, and
      incomplete observation. If dispatch outcome is unknown, retain that uncertainty.
- [x] No automatic retry after ambiguous model dispatch. Any deliberate rerun is a new
      recorded trial. Rate limits stop the trial with a reason; avoid retry storms.
- [x] Cancellation uses existing native cancellation; preserve available evidence and
      prevent further eval submissions. Do not claim an external request was undone.
- [x] Correlate observations without counting duplicates twice; retain native ordering
      and flag missing/orphaned observations rather than inventing them.

Credentials come from existing server configuration. Connected side-effecting tools
remain disabled for these tasks; only the safe calculator is needed. Durable crash
recovery, comprehensive event-order fault injection, and retention automation are
explicitly deferred rather than introduced as extra implementation work.

## Minimal validation

| Check | When and purpose |
| --- | --- |
| Small policy/grader test table | Once for shared contracts: reject paid/unavailable configuration, accept task success, catch missing tools/feedback/context |
| Focused adapter checks | On adapter changes: actual mapped inputs and observations, limits, and a provider-error path |
| Evidence/API checks | On storage/read changes: backward compatibility, correlations, missing/blocked data, safe bounded reads and redaction |
| Frontend check and build | On result-view changes: retained verdicts, honest empty/blocked state, evidence links |
| Real free-model trials | One per task per available platform; inspect actual requests, tool feedback, final answer, and saved verdict |

Repeat only surprising or ambiguous live results first. One trial is development
feedback, not statistical reliability evidence or full platform readiness. This is a
deliberate small-sample exception to larger research protocols. Do not run a broad
hardening matrix, paid comparisons, or repeated benchmarks for this slice.

Existing build commands, run only when the associated implementation changes:

```bash
pnpm --filter @agent-harness-lab/lab-server run build
pnpm --filter @agent-harness-lab/web run build
git diff --check
```

Add exact narrow test commands beside the tests as each slice is implemented. Run the
broader server suite once after integrated runtime changes warrant it; repeat only for
new failures or meaningful changes. A plan-only change needs link/diff review, not
runtime tests or model calls.

## Completion and handoff

- [x] Applicable implementation checks and focused validation pass.
- [x] Mastra/LangGraph have inspectable live trials; Temporal/Restate each have actual
      results or an explicit outstanding dependency, never an inferred pass.
- [x] The Evals page reads saved results; permanent feature documentation matches usage.
- [x] Report task failures and evidence gaps openly; do not weaken graders to get passes.
- [x] Before each sensible commit, review only the intended files, validate its scope,
      and preserve unrelated work. Do not accumulate everything into one giant commit.
- [x] Record commit hashes, exact commands, observed results, and remaining blockers here
      when handing off or completing the plan.

## Completion record

**Completed implementation:** 2026-10-08. Restate is implemented with an explicit
outstanding native-service dependency, as allowed by this plan's completion gate.
Its live execution is not validated and must not be treated as a pass.

### Commits

- `95ff83f`: live task contracts, objective graders, report classification, free policy.
- `6508a2d`: live driver, Mastra provider observations, supported reports and usage guide.
- `3db1f6c`: native LangGraph live request and observation integration.
- `e287c09`: native Temporal live request and observation integration.
- `4aa8284`: native Restate live request policy and observation integration.
- `7016e9f`: bounded retained-results API and frontend inspection.

### Recorded live evidence

All trials used the explicitly selected `nvidia/nemotron-3.5-lightning:free` model.
Each available platform ran one trial per task. Inspect the local summaries and
referenced run artifacts; generated run data is intentionally not committed.

| Platform | Invocation | Observed result |
| --- | --- | --- |
| Mastra | `live-b4463ce6-7e22-47b8-baf7-94de1c957474` | L01, L02 and L03 passed |
| LangGraph | `live-cd4babad-e065-4bc7-814a-89293b43270b` | L01, L02 and L03 passed |
| Temporal | `live-3b4c4ced-37c1-473b-bd21-a048a3cf62f4` | L01, L02 and L03 passed |
| Restate | `live-8b560603-9c3e-4721-9efb-2be5d9d8e792` | Three tasks blocked; no run admitted |

For every successful calculator task, the retained report contains two real model
requests, a successful add(17,25) dispatch, correlated feedback containing 42, and
all assertions passing. Two-turn reports reference both actual runs. These are
observations of basic task success, not reliability estimates or platform rankings.

Gemma returned HTTP 429 in invocation
`live-95c0037e-e039-4d3f-be87-dc7aad1c35b3`; the evaluator retained the error and
blocked the remaining tasks. An earlier Gemma diagnostic invocation retained three
errors before rate-limit classification was fixed. A Nemotron catalog request also
failed before a later, explicitly selected invocation succeeded. Those failed
invocations remain inspectable rather than being replaced by the successful trials.

### Validation and inspection

- `pnpm --filter @agent-harness-lab/lab-server run build`: passed.
- `pnpm --filter @agent-harness-lab/web run build`: passed, including typecheck and
  documentation generation; existing large bundle warnings remain.
- Shared policy/graders/report checks: five focused tests passed; existing report
  storage compatibility checks passed with the contract slice.
- Native adapter/workflow checks: 34 passed; nine additional focused adapter/summary
  checks passed. LangGraph graph/protocol Python checks: 39 passed.
- `pnpm --filter @agent-harness-lab/lab-server exec tsx --test ../apps/web/tests/evalResults.test.tsx tests/platforms/mastra/live-openrouter.test.ts tests/control-plane/eval-results.test.ts`:
  five passed after final integration.
- `node --test server/dist/tests/platforms/mastra/live-openrouter.test.js server/dist/tests/control-plane/eval-results.test.js server/dist/tests/control-plane/http.test.js`:
  16 passed, including safe API reads and HTTP argument validation.
- `pnpm --filter @agent-harness-lab/lab-server test`: 503 tests, 500 passed, one
  failed, two skipped. The failure was the unchanged direct-API retry-count test,
  which observed four requests instead of three under the concurrent suite.
- `node --test server/dist/tests/capabilities/integrations.test.js`: all ten passed
  on the focused rerun, including the retry-count test. The broad suite was not
  repeatedly rerun to seek a green result.
- Live `/api/evals` returned all three successful platforms and retained blocked/error
  invocations. The Temporal calculator report was fetched through its frontend
  evidence link and contained the actual passing assertions.
- Browser inspection at `http://localhost:5173/evals`: saved results survived reload;
  the Temporal calculator row expanded to real verdict, trajectory, model/tool event,
  and context links. Older invocations are behind a disclosure to keep the page compact.
- `git diff --check`: passed. Only eval-related files were staged in implementation
  commits. Existing Studio/Lina changes were preserved.

### Known limitations and follow-up

- Restate native executable/service is unavailable locally. Run the same live command
  after setup to validate its implementation; compilation and adapter fixtures are
  not substitutes for a real Restate result.
- Gemma's live path remains rate-limited; Nemotron supplied the successful real trials.
  Neither model availability nor quota is guaranteed.
- Local inspection services were started for verification: LangGraph on 2024,
  Temporal worker on the existing default queue, and control-plane API on 4318.
  The API origin was set to `http://localhost:5173` to match the user's frontend.
- Cancellation retains available evidence and stops further admission, using existing
  native cancellation. Extensive crash/restart, event-order and fault-injection
  testing remains explicitly deferred. No exactly-once claim is made.
- The results reader scans a bounded subset of invocations, flags corrupt or interrupted
  summaries as incomplete, and omits raw local paths and runner configuration.
