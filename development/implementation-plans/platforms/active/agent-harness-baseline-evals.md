# First executable agent evals

Created: 2026-10-07. Updated: 2026-10-07.
Status: four-case development implementation complete. Mastra and isolated
LangGraph native trials passed; Temporal/Restate rollout is blocked by absent
services. Full baseline readiness and hardening remain deferred.

## Purpose

Get a small set of agent evals working, produce inspectable results, and use those
results to guide platform implementation. Start with Mastra baseline, which can
execute locally without another service, then reuse the same case expectations
on Temporal, Restate, and LangGraph as their native services become available.

The user has chosen functional progress and minimal normal testing for this phase.
Broad hardening, full fault matrices, and production-readiness claims are deferred.
The first deliverable is a working development evaluator, not all 21 cases.

## Start here

- [Repository rules](../../../../AGENTS.md)
- [Readiness investigation](../../../../docs/research/platform-eval-readiness.md)
- [Case specification](../../../../lab/scenarios/platform-agent-conformance/eval-cases.md)
- [Experiment protocol](../../../../lab/experiments/agent-harness-baseline/README.md)
- [Existing conformance fixtures](../../../../server/tests/platform-conformance/workload.ts)
- [Runner boundary](../../../../server/src/control-plane/ports/runner.ts)
- [Evidence owner](../../../../server/src/control-plane/application/evidence-store.ts)

Preserve platform-owned execution loops, common scenario semantics, existing run
records, and unrelated Lina/Studio changes. Reuse existing fixtures and tests.

## Definition of done

A contributor can run one documented command selecting an available platform and
receive a readable per-case result with retained evidence for:

- B01: the agent returns the scripted response using the recorded instructions.
- B02: the calculator executes, and its actual result reaches the next model call.
- B03: a second turn receives the first turn's retained context.
- B07, focused slice: requested tool-call and model-round limits are enforced.

The command defaults to one clean trial per case, uses scripted models, and makes
no live-provider call. It lists the remaining core cases as not implemented.
A failed assertion stays visible with its evidence; unavailable services are blocked.
Successful completion of this plan establishes only this four-case development slice.

```text
local eval command
  → normal RunService admission/context
  → selected native platform runner and scripted model boundary
  → actual requests, tool observations, and ordinary run evidence
  → strict case verdicts and saved report
```

## Scope and implementation order

### 1. Repair the demonstrated Mastra behavior

- [x] Correct the existing capability-profile test to include `local-mcp-safe`,
      preserving its secret checks. This repairs the known stale expectation.
- [x] Read requested `maxCalls` and `maxRounds` for Mastra baseline, falling back
      to documented defaults only when capability limits are absent.
- [x] Use one execution-owned call budget across enabled tools in both Mastra
      variants. Define attempted calls versus actual dispatches; record rejection
      when the budget is exhausted, before another tool starts.
- [x] Define model-round accounting at the Mastra SDK boundary, including its
      final response step, so the requested value has an explicit meaning.
- [x] Reconcile the model's actual system instructions with recorded configuration
      and prepared context. Keep intentional variant instructions explicit.
- [x] Update the Mastra README/configuration notes with the finished behavior.

Acceptance: the reproduced `maxCalls=1` request cannot dispatch two tools; changing
between tool types does not reset the budget; captured instructions agree with the
recorded contract. An ordinary calculator interaction still completes.

Files: Mastra baseline `agent.ts`, configuration, runner, workflow reuse, and their
existing tests. Do not refactor the other platforms during this repair.

### 2. Make the small eval slice executable

- [x] Put reusable scenario inputs and graders under
      `lab/scenarios/platform-agent-conformance/`, keeping SDK APIs out of them.
      Preserve the existing fixture helpers or delegate to these shared definitions.
- [x] Add safe scripted model request capture or an assertion receipt at the actual
      mapped model boundary. Do not capture credentials or real user prompts.
- [x] Grade B01 against the expected completed response and actual instructions.
- [x] Grade B02 against one actual calculator execution, correlated call/result
      identity, and `42` in the next captured model request. Final text alone fails.
- [x] Grade B03 against two distinct turns in one fresh session, the marker in the
      actual second request, correct role order, and no duplicated transcript.
- [x] Grade the focused B07 against a script that requests work past the configured
      call/round limits. A truthful limit outcome passes this case.
- [x] Add a small driver that creates fresh run/session identities, submits through
      RunService, polls within a finite deadline, and prints case-level verdicts.
- [x] Add a documented `eval:baseline` server command, initially supporting Mastra
      baseline and a platform selection flag. The command is implemented; see the run guide.

Acceptance: one command produces genuine per-case observations through Mastra's
native SDK. The driver grades results; it does not implement a replacement agent loop.

### 3. Retain and inspect results

- [x] Add a bounded typed `artifacts/eval.json` writer/read allowlist to the existing
      run evidence owner. Store case, suite/grader version, trial identity, verdict,
      expected/observed values, and safe observation references.
- [x] Preserve ordinary config/events/context/trajectory/metrics/result/native files.
      Capture only the synthetic model inputs needed for these assertions.
- [x] Correlate both B03 runs in its case record. Preserve earlier run evidence if
      the continuation fails. Do not rewrite run status to match an eval verdict.
- [x] Print an aggregate summary and evidence paths. Represent failures, blocked
      cases, and unimplemented cases explicitly; do not delete roots after grading.
- [x] Record inspected revision/dirty state, exact runtime versions, resolved tools,
      context policy, limits, timestamps, and trial count in the retained evidence.
- [x] Document how to run the command and inspect one passing and one failing result.

Acceptance: a contributor can understand a failure from the saved observation and
verdict without rerunning the model. Terminal run failures can pass a case expecting
failure; a completed run can fail an assertion. CLI output and files are the initial
results surface. The existing Agent evals page remains the specification browser.

### 4. Exercise the other priority native platforms

- [x] Add selection/composition for Temporal, Restate, and LangGraph using their
      existing native runner and scripted-model seams.
- [x] Implement only the request capture needed for the four cases on each platform.
- [x] Run one clean trial per case/profile when its documented services are reachable.
      Record absent services as blocked; never replace a native runner with a mock.
- [x] Fix concrete loop/configuration defects exposed by these cases, in that
      platform's own implementation. Do not add optional durability behavior.
- [x] Record exact commands, verdicts, run IDs, versions, and known gaps in the handoff.

Acceptance: the same grader expectations apply across available priority platforms,
with separate native evidence. Unavailable profiles do not prevent useful Mastra
results and do not become passing rows. Record any blocked rollout checkbox honestly.

## Minimum tests and checks

Add tests for behavior changed by this slice, rather than every item in the full
baseline specification. Prefer extending existing test files.

| Check | Minimum evidence | Why it is needed |
| --- | --- | --- |
| Mastra budget regression | One requested-limit case plus one mixed-tool case; include round exhaustion in the existing budget test group | Catches the demonstrated bug and the independent per-tool counter defect. |
| Instructions and ordinary tool loop | Extend an existing captured-model request/tool-loop test | Confirms the configuration repair and keeps the normal calculator path working. |
| Grader correctness | One table-driven test group with valid evidence for each case and invalid controls for failed completion, missing tool feedback/context, and exceeded limits | Prevents plausible output or absent observations from producing a false pass. |
| Report storage | One focused round-trip test covering retained verdict/observation references and rejection of an oversized or unsupported artifact | New persistence must work and stay within the existing evidence boundary. |
| End-to-end development eval | One clean execution of the four-case command per available native profile | Demonstrates the requested working result, including both B03 turns. |

Reuse existing failure, validation, redaction, and cancellation tests. Do not add
parallel duplicate suites, coverage targets, extensive UI automation, or repeated
full-suite runs. Run narrow checks after the relevant edit and the server suite once
at integration. Repeat only after a change, failure, or new uncertainty warrants it.

One trial is the normal development default for this slice. Keep an optional trial
count so contributors can repeat a suspicious result. The protocol's three clean
trials are reserved for a later readiness check; a one-trial report cannot claim
that gate or statistical reliability.

## Commands and validation sequence

Existing commands available now, from the repository root:

```bash
pnpm --filter @agent-harness-lab/lab-server run build
node --test server/dist/tests/platforms/mastra/mastra-runner.test.js
node --test server/dist/tests/control-plane/http.test.js
node --test server/dist/tests/control-plane/evidence-store.test.js
node --test server/dist/integration-tests/mastra-baseline.test.js
```

Implemented user command:

```bash
pnpm --filter @agent-harness-lab/lab-server run eval:baseline -- --platform mastra
```

At integration, run once:

```bash
pnpm --filter @agent-harness-lab/lab-server run test
pnpm --filter @agent-harness-lab/web run generate:docs
git diff --check
```

The server test command already builds/types checks server code. Do not add a
second identical build/typecheck pass. A web build is needed only if frontend code
changes. Native platform integration checks need their documented services; do not
run every optional suite or start the aggregate launcher just to produce green output.

## Failure, state, and configuration rules for this slice

- Each fresh eval invocation uses new sessions/runs. Repeated polling reads the same
  execution; it never submits the task again after an ambiguous acknowledgement.
- Missing services fail preflight as blocked. Missing required observations fail
  the grader. Driver/grader errors are recorded separately from agent failures.
- A driver deadline ends observation and records the last known outcome; cancel
  only its own admitted run through the existing API. Never infer that an in-flight
  external action was rolled back or start another attempt automatically.
- Write per-case eval evidence after ordinary observations become available, using
  the existing evidence owner and atomic bounded writes. An interrupted driver
  leaves ordinary runs inspectable; resumable eval orchestration is deferred.
- Pure calculator operations and disposable read fixtures are sufficient. No real
  writes, production endpoints, or provider keys are required for the default run.
- Preserve existing runner retry/cancellation/reconciliation behavior. Adding a
  result record must not change those semantics or turn uncertainty into success.
- Direct artifact access remains allowlisted. CLI configuration explicitly selects
  a platform/profile; fake models are test fixtures, never a production fallback.

## Deferred work

- Remaining B04–B12 cases beyond the narrow B07 check; full baseline readiness.
- Live M01–M04, paid-provider sampling and meaningful cost comparisons.
- Crash/acknowledgement-loss injection, restart matrices, approval suspension,
  prompt-injection campaigns, and X01–X05 platform strengths.
- Full loops on the six single-step baselines, AWS registration, compositions.
- General capability-discovery redesign, broad retry/cancellation/usage hardening.
- A frontend results dashboard, scheduling, statistical ranking, and a general
  evaluation framework. Add these after the first reports are useful.

These remain visible in the research and full case specification. Known gaps must
remain honest limitations; deferring hardening does not make them passing behavior.

## Ownership and starting point

Primary integration owns scenario semantics, graders, the driver, and evidence
reporting. Platform owners own their native captures and fixes. Once case inputs and
report shape are frozen, independent native platform work can proceed in parallel.
Keep the initial Mastra repair and first usable report sequential and reviewable.

The initial repairs and four-case driver are implemented. Next native rollout
action: start the documented Temporal/Restate profiles with the current code and
shared context root, then run their commands. Missing services remain blocked
rollout work, not successful acceptance.

## Commit checkpoints

Commit each sensible, coherent chunk as it becomes working and verified. Do not
accumulate the entire plan into one final commit. The user explicitly authorizes
these implementation commits; pushing or rewriting history is outside this plan.

Suggested boundaries, adjusting them when the implementation reveals a better split:

- [x] Commit the stale capability-profile test correction independently.
- [x] Commit the Mastra request/aggregate budget repair with its focused regression
      tests and configuration documentation.
- [x] Commit the delivered-instruction/configuration repair with its focused test.
- [x] Commit the scenario cases and strict graders with their valid/invalid controls.
- [x] Commit bounded eval evidence persistence with its round-trip test.
- [x] Commit the working Mastra driver, command, and run/inspection guide once it
      produces retained results end to end. Combine tightly dependent driver/report
      work if separating it would leave a broken intermediate state.
- [x] Commit each additional platform's capture/integration changes separately,
      with its relevant checks and documented result or infrastructure limitation.
- [x] Commit any remaining integration/documentation updates as a focused final
      chunk. Do not defer documentation needed to understand earlier changes.

Before each commit, inspect the diff, run only the relevant checks described above,
and stage only files belonging to that chunk. Include required tests and docs in
the same commit as their behavior. Preserve unrelated user changes, including
other work in shared files; never stage the whole working tree blindly. Record
each commit hash, purpose, validation, and known limitations in the handoff below.
Keep independently useful corrections separate without committing broken dependent
pieces just to follow this suggested list.

### Implementation commit record

| Commit | Purpose | Validation | Limitations |
| --- | --- | --- | --- |
| `df490d0` | Correct stale profile expectation | Build; HTTP 11/11 | No runtime change |
| `1586be8` | Bounded typed eval report storage | Evidence-store 14/14 | Synthetic observations only |
| `d8d9954` | Mastra requested/aggregate budgets | Baseline/workflow 22/22 | Counts wrapper attempts; SDK rounds include final response |
| `5cc2f17` | Delivered instructions and retained summaries | Focused/integration 28/28 | Keeps native variant instructions explicit |
| `dcb2b42` | Temporal native capture/fixtures | Combined Temporal/Restate focused checks 31/31 | Native service trial blocked |
| `f1cbb10` | Restate native capture/fixtures | Combined Temporal/Restate focused checks 31/31 | Native service trial blocked |
| `78eec60` | SDK-free cases and strict graders | Grader controls 24/24 | Four cases; B07 call/round slice |
| `0cfce3a` | Mastra actual tool result observer | Baseline 11/11 | Opt-in process-local observer |
| `3b4f703` | LangGraph native capture/fixtures | Graph 23/23; final focused 6/6 | Requires native service |
| `06bc266` | Working command and inspection guide | Mastra/LangGraph four-case trials; build; passing/failing regrade example | Temporal/Restate blocked; one-trial development reports |
| `dc876ee` | Saved research, full case specification and investigation | Link checks; four-case retained artifacts audited | Investigation is historical; current results linked |

Frontend navigation and handoff are the final documentation checkpoint. Its
commit ID is available in the repository log.

## Verified handoff

Use the [run and inspection guide](../../../../lab/experiments/agent-harness-baseline/development-evals.md).

| Profile | Command | Verdict | Retained summary |
| --- | --- | --- | --- |
| Mastra baseline | `pnpm --filter @agent-harness-lab/lab-server run eval:baseline -- --platform mastra` | B01/B02/B03/B07 passed | `lab/runs/.evals/baseline-158e8fda-e7cb-4377-8029-0c776607c298/summary.json` |
| LangGraph isolated local service | `AGENTLAB_LANGGRAPH_SERVICE_URL=http://127.0.0.1:20242 pnpm --filter @agent-harness-lab/lab-server run eval:baseline -- --platform langgraph` | B01/B02/B03/B07 passed | `lab/runs/.evals/baseline-ebd3a214-7cf9-4ad6-b0cb-f90df5b9f75a/summary.json` |
| Temporal default local profile | `pnpm --filter @agent-harness-lab/lab-server run eval:baseline -- --platform temporal` | Four blocked, no admitted runs | `lab/runs/.evals/baseline-1588a20e-f9f9-4679-a247-2a11e5d06174/summary.json` |
| Restate default local profile | `pnpm --filter @agent-harness-lab/lab-server run eval:baseline -- --platform restate` | Four blocked, no admitted runs | `lab/runs/.evals/baseline-83b7c3cb-06b2-40af-821f-4e1b86c96fd3/summary.json` |

These are retained local development artifacts, not committed benchmark datasets.
Each summary points to all case reports and run IDs. B03/B07 correlate two runs.
For Mastra the B01/B02/B03/B07 report owners are respectively
`6d066f9e-544d-4fd3-961a-a5e3f8b9a5c0`,
`034a5ed1-4865-428d-92e1-6505f442f258`,
`f220a9f6-8954-43e5-b3aa-4287324b913a`, and
`32014857-466f-4e17-a6db-6c1dab34b55e`.
For LangGraph they are `9f1069dd-9ee8-4e4e-a05c-edb34981aab0`,
`5e4e1be5-eae3-439d-aa28-247fb2e77633`,
`3b495034-306d-4f53-ad0b-c4b9049b5cd4`, and
`6eeb8beb-f867-4ecf-8c58-4c9c7b315be3`.

Installed versions observed: Node `23.11.1`, Mastra core `1.66.0`, libsql `1.23.0`,
Temporal client/worker/workflow `1.24.0`, Restate SDK/client `1.17.0`.
LangGraph native receipts record Python `3.11.16`, LangGraph `1.2.10`, service `0.1.0`.
The isolated service used existing `.local311`, port 20242, an eval-owned SQLite
state directory under `lab/runs/.evals/`, and the same absolute session root as the
driver. It was stopped after verification. No aggregate launcher or paid provider
was used. The reports record the inspected revision and dirty checkout state.

Integration validation: server suite 488 total, 486 passed, zero failed, two
skipped. Web build/typecheck and docs generation passed; docs catalog has 86
pages. Frontend case-reader checks 2/2 passed. The documented B02 regrade example
passed original observations and rejected a copy with tool feedback removed.
Whitespace checks passed. Narrow checks were used during implementation; the full
server suite ran once, followed by build/command checks for final metadata changes.

Remaining core cases are explicitly unimplemented. B07's slow-call deadline,
three-trial full readiness, live measurements, recovery hardening, and a frontend
results dashboard remain outside this completed development slice. Temporal and
Restate native service rollout is still blocked, with no claim of acceptance.

## Completion checklist

- [x] Mastra's normal loop and requested limits work with the focused regression tests.
- [x] The four-case command produces real verdicts and inspectable retained records.
- [x] Graders reject the listed invalid controls; missing cases remain unimplemented.
- [x] Available priority native profiles have one recorded trial per case; unavailable
      profiles are explicitly listed as blocked rollout work.
- [x] Narrow checks and the integration-time server suite pass, or exact remaining
      failures are reported without claiming a complete implementation.
- [x] Commands, Docs, known limitations, and evidence paths match the implementation.
- [x] Unrelated user changes are preserved; no secrets or generated machine state added.
- [x] Working implementation chunks have focused commits and their hashes/checks
      are recorded; the plan has not been accumulated into one giant commit.

## Starting evidence

The 2026-10-07 investigation ran 459 server tests: 456 passed, 1 stale profile
expectation failed, 2 skipped. Six additional Mastra integration checks passed.
A pure-calculator probe requested `maxCalls=1` but observed two dispatches and
completion. Default shared native services were unavailable. These are the starting
conditions, not completion evidence for this plan.

Starting planning validation checked local links, command paths, documentation
catalog generation and whitespace. Completed runtime evidence is recorded above.
