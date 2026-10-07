# Free-model live agent evals

**Created:** 2026-10-07
**Last updated:** 2026-10-07
**Status:** Planned; implementation and live inference have not started.

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

Proposed command to implement:

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

- [ ] Default to `google/gemma-4-31b-it:free` through OpenRouter.
- [ ] Offer `nvidia/nemotron-3.5-lightning:free` as an explicitly selected comparison.
- [ ] Revalidate exact IDs, zero input/output pricing, and tool support before inference.
- [ ] Enforce free-only provider routing at the actual request boundary using supported,
      verified provider controls. Fail closed if zero-cost routing cannot be established.
- [ ] Never silently switch models or fall back to a paid endpoint. Paid interactive
      usage elsewhere in the app remains outside this eval policy.
- [ ] Record requested and resolved model/provider identities, settings, routing policy,
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

- [ ] Define versioned inputs and graders for the three tasks.
- [ ] Add explicit live/scripted report classification with backward-compatible reading
      of existing reports; preserve previous case meanings.
- [ ] Validate model/tool capability and free routing before dispatch. Define bounded
      calls, rounds, output size, timeout, and supported model parameters.
- [ ] Add focused policy and grader checks, including paid-route rejection before any
      model dispatch and a correct answer that skipped the required tool.
- [ ] Commit this coherent contract/configuration slice with its tests.

### 2. Real observations and Mastra execution

- [ ] Add opt-in, bounded observation at the real provider/SDK boundary. Existing fake
      model captures do not establish what a real model received.
- [ ] Retain sanitized actual messages, tool schemas, calls, arguments, results, feedback,
      response metadata, and final output. Preserve useful native evidence.
- [ ] Run the tasks through Mastra's existing native loop using the new `eval:live` driver.
- [ ] Use one trial per task initially when credentials and quota are available.
- [ ] Commit the Mastra execution slice, supported report writing, and usage notes.

### 3. LangGraph, then service-backed platforms

- [ ] Apply the same tasks and observation contract to LangGraph's native loop.
- [ ] Check Temporal/Restate setup and workers; use their actual service paths when ready.
- [ ] Keep framework-specific APIs and lifecycle behaviour within each adapter.
- [ ] Record missing services or unavailable quota as blocked, with the actionable reason.
- [ ] Commit each platform integration separately after its focused validation.

Independent adapter work may use subagents once the common contract is stable. Keep
architectural decisions and integration with the primary agent.

### 4. Saved results in the frontend

- [ ] Expose retained invocation/trial results through a bounded read API using supported
      evidence access and safe paths.
- [ ] Add a compact results view to Evals: model, platform, task, verdict, reason, and
      links to the actual trajectory/tool evidence.
- [ ] Separate live from scripted results; show empty and blocked states honestly.
- [ ] Verify one real result can be inspected after refreshing the page.
- [ ] Commit the result API and frontend slice with focused checks and usage documentation.

## Ownership, persistence, and failure semantics

The eval driver owns task admission, trial IDs, and invocation summaries. Platform runners
own execution and observations. Existing run/eval evidence storage remains the supported
writer of per-run artifacts; the frontend reads through the server, not arbitrary files.

- [ ] Use `lab/runs/<run-id>/` for normal run records and supported eval artifacts;
      preserve `lab/runs/.evals/<invocation-id>/summary.json` for invocation outcomes,
      including trials blocked before a run exists.
- [ ] Give every request, tool call, run, trial, and invocation a correlatable identity.
      A continuation trial references both runs and its fresh session.
- [ ] Write observations during execution and final reports only once referenced evidence
      exists. Use existing atomic/idempotent storage rules and bounded report sizes.
- [ ] Keep synthetic inputs and sanitized evidence; exclude keys, authorization headers,
      private user sessions, and unrelated prompts. Retain local evidence for inspection,
      without committing generated run data.
- [ ] A fresh invocation creates fresh trial/session IDs. Do not overwrite or silently
      resume an interrupted trial. Mark incomplete evidence explicitly on read.
- [ ] Distinguish missing dependencies, provider errors, timeouts, task failure, and
      incomplete observation. If dispatch outcome is unknown, retain that uncertainty.
- [ ] No automatic retry after ambiguous model dispatch. Any deliberate rerun is a new
      recorded trial. Rate limits stop the trial with a reason; avoid retry storms.
- [ ] Cancellation uses existing native cancellation; preserve available evidence and
      prevent further eval submissions. Do not claim an external request was undone.
- [ ] Correlate observations without counting duplicates twice; retain native ordering
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

- [ ] Applicable implementation checks and focused validation pass.
- [ ] Mastra/LangGraph have inspectable live trials; Temporal/Restate each have actual
      results or an explicit outstanding dependency, never an inferred pass.
- [ ] The Evals page reads saved results; permanent feature documentation matches usage.
- [ ] Report task failures and evidence gaps openly; do not weaken graders to get passes.
- [ ] Before each sensible commit, review only the intended files, validate its scope,
      and preserve unrelated work. Do not accumulate everything into one giant commit.
- [ ] Record commit hashes, exact commands, observed results, and remaining blockers here
      when handing off or completing the plan.

**Completion record:** Pending. No live runs have been performed for this plan.
