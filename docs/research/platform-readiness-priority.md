# Priority platform readiness audit

This records the pre-implementation investigation. For the implemented four-case
[development command and current limits](../../lab/experiments/agent-harness-baseline/development-evals.md),
see the [implementation handoff](../../development/implementation-plans/platforms/active/agent-harness-baseline-evals.md).

Date: 2026-10-07. Scope: Temporal baseline, Restate baseline, LangGraph baseline,
Mastra baseline and workflow. This is a source and test audit against
[B01–B12, M01–M04 and X01–X05](../../lab/scenarios/platform-agent-conformance/eval-cases.md).
It is not a new native acceptance result. No live provider calls, service restarts,
or native integration tests were run for this document. The coordinating audit
records fresh validation separately.

The coordinating agent subsequently reported fresh offline results: 459 server
tests, 456 passing, one failing, two skipped; six Mastra baseline integration
tests passing. The server failure at `server/tests/control-plane/http.test.ts:205` expects
two capability profiles while the catalog now includes three with `local-mcp-safe`.
That assertion must be corrected against the intended catalog contract before a
clean validation claim. The coordinating audit also ran a deterministic Mastra
reproducer: a request with `maxCalls=1,maxRounds=2` used effective limits 8/6,
made three model calls and two tool dispatches, and completed. Its captured system
instruction differed from the recorded manifest. Those two Mastra findings are
freshly reproduced; the LangGraph cancellation finding below remains source-only.

## Recommendation

Start scripted, isolated development evals now. The platforms already have real
execution paths. Implement the missing acceptance instrumentation and fix limits,
instruction propagation, and cancellation before treating them as interchangeable
working agents. Do not wait for every platform's durability features to be finished.
Do not publish comparative live-model or cost scores until requested configuration
and measurements mean the same thing across the selected variants.

The next slice should capture the actual model requests at each native boundary,
exercise B01–B03 and B07, and retain a versioned acceptance result for each case.
Add failing grader controls. This will expose defects that today's output and event
checks can miss, while keeping platform APIs inside their own adapters.

## What is genuinely implemented

| Variant | Native execution | Model boundary | Recovery boundary |
| --- | --- | --- | --- |
| Temporal baseline | Temporal Workflow controls Activities, tools and continuation | Fake adapter or OpenRouter Activity | Workflow history persists; ambiguous in-flight provider outcomes must remain unknown |
| Restate baseline | Restate Workflow with named `ctx.run` model and tool actions | Fake adapter or OpenRouter inside actions | Journal reuses completed actions; an interrupted external request still has an acknowledgement window |
| LangGraph baseline | Real Python `StateGraph`, model/tools nodes, SQLite checkpointer, FastAPI service | Deterministic Python model fixtures or direct OpenRouter HTTP | Checkpoints persist; interrupted active execution is marked unknown rather than automatically adopted |
| Mastra baseline | Real `Agent.generate` in the Lab server process | Fake language model or OpenRouter model factory | Process-scoped execution registry, no crash resumption |
| Mastra workflow | Real Mastra workflow with approval suspension and model step, LibSQL storage | Reuses native Agent tools/model factory | Stored suspended/completed run inspection; local single-process profile |

Implementation anchors: [Temporal activities](../../server/src/platforms/temporal/variants/baseline/activities.ts),
[Restate workflow](../../server/src/platforms/restate/variants/baseline/workflow.ts),
[LangGraph graph](../../server/src/platforms/langgraph/variants/baseline/graph.py),
[LangGraph service](../../server/src/platforms/langgraph/service/app.py),
[Mastra agent](../../server/src/platforms/mastra/variants/baseline/agent.ts), and
[Mastra workflow](../../server/src/platforms/mastra/variants/workflow/workflow.ts).

Installed package metadata read in this audit reports Temporal client/worker/workflow
1.24.0, Restate SDK/client 1.17.0, Mastra core 1.66.0 and LibSQL adapter 1.23.0.
Temporal manifests specify `^1.23.0`, so package declarations alone are insufficient
run provenance. The LangGraph lock specifies LangGraph 1.2.10, checkpoint 4.2.0,
SQLite checkpoint 3.1.1, FastAPI 0.141.1 and Uvicorn 0.53.0. The Python runtime was
not executed to verify installed versions. Record both locked and actual versions.

## Concrete defects and risks to resolve

### Mastra baseline does not use the requested execution limits

[Runner configuration](../../server/src/platforms/mastra/runner-adapter/mastra-runner.ts)
lines 95–96 writes fixed limits of six rounds and eight calls. Lines 204 and 216
use values read from that platform configuration. The parser in
[configuration.ts](../../server/src/platforms/mastra/variants/baseline/config/configuration.ts)
lines 45–46 does not use `manifest.capabilities.tools.maxRounds/maxCalls`.
Thus a request for two calls and three rounds does not establish B07's requested
budget. Existing calculator tests use smaller declared budgets but do not exhaust
them, so a successful two-step interaction cannot catch this.

The workflow variant passes requested values at
[workflow.ts](../../server/src/platforms/mastra/variants/workflow/workflow.ts)
lines 138 and 149. Both variants nevertheless reuse per-tool counters in
[agent.ts](../../server/src/platforms/mastra/variants/baseline/agent.ts)
lines 104 and 169. Calculator, lookup, write, and MCP each receive their own counter.
A global `maxCalls` cannot be established by those separate counters. Add one
execution-owned budget and a mixed-tool scripted trial that attempts a third
dispatch with `maxCalls=2`.

### Mastra baseline replaces the recorded system instructions

[agent.ts](../../server/src/platforms/mastra/variants/baseline/agent.ts)
line 72 sets the fixed `BASELINE_AGENT_INSTRUCTIONS`. The baseline runner at
lines 211–213 filters every system-role message out of the prepared context.
The manifest's selected system instruction therefore does not reach this Agent
as the system instruction. A completed response does not prove B01's configuration
contract. Capture actual model input and assert a unique instruction sentinel.
Keep any platform wrapper instruction explicit in the manifest if it is intentional.

### LangGraph cancellation needs a model-to-tool boundary check

[graph.py](../../server/src/platforms/langgraph/variants/baseline/graph.py)
line 485 checks cancellation before OpenRouter HTTP. Lines 515–535 perform blocking
HTTP and then return the parsed response without another cancellation check.
The tools loop at lines 284–320 has no general cancellation check before dispatch;
the calculator branch at lines 748–749 does not use `is_cancelled`.
Source inspection therefore identifies a B09 risk: cancellation during a slow model
response can be followed by a newly started calculator call. Add a deterministic
local HTTP response that returns a tool call only after cancellation is recorded,
then assert zero subsequent tool dispatches. This is a proposed reproducer, not a
fresh observed failure. Existing cancellation tests primarily use delayed fake
models or an in-flight MCP call and do not establish this boundary.

### Multi-round usage is not consistent

Temporal's workflow assigns `usage = result.usage` at line 349 for every round.
LangGraph's model node returns only the current response usage at line 277, and
the service reads the final checkpoint's usage at lines 167–178. Neither path
establishes total consumption across a tool interaction. Restate explicitly
aggregates reported usage and has a test named `the workflow aggregates reported
usage across OpenRouter model calls` in
[workflow.test.ts](../../server/tests/platforms/restate/workflow.test.ts).
Mastra uses `output.totalUsage` when present at runner line 235.

Before comparing cost, define whole-run totals, per-request totals, unknown usage,
failed attempts, and compaction usage. Add a two-round provider fixture with
different known usage values and verify their sum. Check compaction separately;
an event that says context was compacted is not evidence of the summary's cost.

### Temporal documentation has obsolete scope statements

[Temporal semantics](../../server/src/platforms/temporal/docs/semantics.md)
still says the baseline has one model call and no tool side effects. Its current
workflow has a multi-round tool loop and enabled fixture-write support. The actual
implementation should determine declared capabilities and fault policy. Update this
document alongside acceptance implementation to avoid using the original scope
as today's contract.

## Baseline coverage assessment

These are source-based readiness judgments. `Partial` means useful implementation
and test anchors exist, but the full case has not been mapped to retained native
acceptance evidence. It does not mean a failing result was observed.

| Case | Assessment across these variants | Required next evidence |
| --- | --- | --- |
| B01 | Partial; native completion paths exist; Mastra instruction defect | Capture exact model request and selected instructions/configuration |
| B02 | Partial; all four baseline paths have native calculator tests | Capture second model request, matching call/result ID, independent execution count |
| B03 | Partial; canonical session context and continuation tests exist | Full role ordering, no duplicate entries, actual second request rather than final marker alone |
| B04 | Common context/admission tests are useful; no full interleaved native suite established here | Two marker sessions, interleaved model captures and identity checks |
| B05 | Validation code exists; Restate has malformed tool fixtures | Script invalid calls on each native variant; assert zero fixture effects and rejection evidence |
| B06 | Capability matrix covers missing approval, denial, approved write | Inspect independent fixture state; retain negative and positive control runs |
| B07 | Restate has limit tests with an in-process context; Temporal/LangGraph have bounds; Mastra defects | Native mixed-tool limits, model-round exhaustion, slow-call deadline and in-flight outcome |
| B08 | Provider/fake failure classification and ambiguity tests exist | Separate provider rejection, malformed response and tool error, actual request/attempt counts |
| B09 | Cooperative cancellation paths exist; LangGraph boundary risk | Cancel after dispatch, after completion, twice, and between model response and tool dispatch |
| B10 | Common admission and runner identity tests exist | Native correlated same-turn replay and conflicting-content rejection |
| B11 | Durable common evidence and bounded native projections exist | Independent fixture/trajectory consistency, totals, duplicate/out-of-order replay and secret sentinel grading |
| B12 | Connectivity/reconciliation behavior exists | Deliberate pre-admission outage and post-dispatch lost acknowledgement with dispatch-count oracle |

The three-case shared workload at
[workload.ts](../../server/tests/platform-conformance/workload.ts)
lines 16–62 remains prompt completion, calculator, and context continuation.
Its assertions at lines 157–189 establish selected lifecycle events and terminal
shape. They do not themselves establish complete B01–B03 model-boundary acceptance.
The specification's requirement for deliberately failing grader fixtures has not
been satisfied merely by these successful workloads.

M01–M04 are new companion acceptance targets. The opt-in LangGraph OpenRouter test
exercises two live turns, but is not the complete M01–M04 suite. Mock HTTP tests
named OpenRouter prove request mapping and error handling, not live model quality.
Run M01 only after B02, M02 after B03/B04, and M03/M04 after B05/B06. Use disposable
fixture state and separate live results from scripted results.

For extensions, X01 and X04 must be variant-specific. Temporal timer recovery,
Restate action replay, LangGraph persistent checkpoints with unknown interrupted
runs, and Mastra stored suspension have different contracts. They should not be
reported as equivalent durable execution. X02 needs a disposable idempotent ticket
fixture and acknowledgement-loss injector. Current fixture-write plumbing is a
starting point, not proof of that experiment. X03 needs explicit logical-event
fixtures. X05 has context compaction implementation and tests, but must grade
retained constraints and captured post-compaction input separately from completion.

## Evidence strength and available commands

| Suite | Evidence it can produce | Prerequisite or flag |
| --- | --- | --- |
| Temporal baseline integration | Real local Temporal execution, fake model, tools, retry/timeout/cancel/reconciliation | `pnpm --filter @agent-harness-lab/lab-server run test:temporal`; requires running local Temporal server and worker, intentionally does not skip |
| Restate workflow unit suite | Workflow function under an in-process Restate context seam; adapter/provider mapping | Default offline tests; not native journal acceptance |
| Restate container integration | Actual Restate engine with disposable environment | `AGENTLAB_RUN_RESTATE_INTEGRATION=1`; Docker/testcontainers required |
| Restate native integration | Real locally running Restate service/server | `AGENTLAB_RUN_RESTATE_NATIVE_INTEGRATION=1` |
| Restate restart integration | Isolated native service/server replacement | `AGENTLAB_RUN_RESTATE_NATIVE_RESTART_INTEGRATION=1`; temporary data and ports |
| LangGraph Python graph tests | Real StateGraph and SQLite with deterministic models; selected HTTP fixtures | Working Python 3.11/3.12 SQLite environment and locked dependencies |
| LangGraph adapter tests | HTTP adapter protocol/mapping; mocked service where injected | Default offline tests; not native service acceptance |
| LangGraph native integration | Disposable Python service and SQLite, deterministic model | `AGENTLAB_RUN_LANGGRAPH_INTEGRATION=1` |
| LangGraph live provider | Two live provider turns | `AGENTLAB_RUN_LANGGRAPH_OPENROUTER=1`; provider quota and key |
| Mastra runner/integration tests | Real `Agent.generate` with deterministic model, in-process common server | `pnpm --filter @agent-harness-lab/lab-server run test:mastra`; no external model required |
| Platform capability matrix | Real four-platform paths with local capabilities and cancellation | `AGENTLAB_RUN_PLATFORM_CAPABILITY_MATRIX=1`; running local services |
| Temporal MCP restart | Isolated native restart at MCP boundary | `AGENTLAB_RUN_TEMPORAL_NATIVE_MCP_RESTART_INTEGRATION=1`; inspect isolation before running |

Test anchors: [Temporal integration](../../server/integration-tests/temporal-baseline.test.ts),
[Restate integration](../../server/integration-tests/restate-baseline.test.ts),
[Restate restart](../../server/integration-tests/restate-restart.test.ts),
[LangGraph integration](../../server/integration-tests/langgraph-baseline.test.ts),
[Mastra integration](../../server/integration-tests/mastra-baseline.test.ts),
[capability matrix](../../server/integration-tests/platform-capability-matrix.test.ts),
and [server scripts](../../server/package.json).

## Gates for starting evals safely

1. Development evals may begin now using fake models, disposable local fixtures,
   temporary context/evidence roots and explicit execution budgets. Record failures
   as development findings. Do not mutate or restart the user's active stack.
2. Native shared-core acceptance begins after exact requests can be captured,
   the graders reject deliberate bad evidence, and each service/runtime version is
   recorded. Fix B01/B07/B09 defects and run B04–B12 with known policies. Preserve
   ambiguous outcomes and never redispatch lost acknowledgements blindly.
3. Live companions begin after their corresponding scripted gates pass. Keep
   model selection, tools, context, budgets and cost limits controlled. No real
   writes or credentials belong in injection or permission fixtures.
4. Fault and platform-strength evals begin per declared capability after isolated
   failure injection and external effect counters exist. Durable restart tests
   must target a temporary deployment, not a shared local server. A platform can
   pass shared acceptance while explicitly lacking a particular extension.

Completed implementation plans and older playground evidence remain useful history.
They are not fresh all-case passes. Retain the exact test name, run identity,
configuration, artifact location, and result when replacing these audit judgments
with measured acceptance status.
