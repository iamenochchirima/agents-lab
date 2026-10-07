# Platform eval readiness and next implementation

This records the pre-implementation investigation. For the implemented four-case
[development command and current limits](../../lab/experiments/agent-harness-baseline/development-evals.md),
see the [implementation handoff](../../development/implementation-plans/platforms/active/agent-harness-baseline-evals.md).

Investigated: 2026-10-07. Repository baseline: `main` at
`3d89689e4df5762341f416c606475e374cdbc80b`, with existing uncommitted eval UI/docs
and unrelated Lina/Studio changes. This report combines source inspection across
all ten platform directories, shared execution/evidence code, fresh server tests,
and a targeted Mastra execution probe. It is not an all-platform acceptance pass.

## Decision

Start controlled development evals now. The next implementation should be a small
executable baseline slice with strict graders and retained evidence, beginning
with Mastra's available local agent path, then the other priority native profiles.
Include the confirmed budget defect in that first slice rather than postponing
limits until after live-model tests.

The first slice is B01 prompt completion, B02 actual tool feedback, B03 actual
context continuation, and a focused B07 call/round-limit check. Fix the defects
these cases expose locally. Do not add another platform or a broad abstraction
before this slice gives contributors a repeatable report they can inspect.

Development evals are allowed to fail. Acceptance requires the applicable checks
to pass. A diagnostic partial report must retain failed and missing cases; it
cannot present a variant as baseline-ready.

## What is implemented

| Platform/variant | Current execution | Assessment and next requirement |
| --- | --- | --- |
| Temporal baseline | Native workflow with model/tool Activities, shared context and native history | Strong starting structure. Require fresh native assertion-level runs and captured model requests; native durability is not external effect idempotency. |
| Restate baseline | Durable workflow and model/tool steps, shared context and retained native state | Strong starting structure. Require fresh native grading and named retry/recovery boundaries. |
| LangGraph baseline | Python graph service with model/tool nodes, shared context and SQLite checkpoints | Tool/context path exists. Audit cancellation between provider return and tool dispatch with a deterministic reproducer before claiming B09. |
| Mastra baseline | Native `Agent.generate` tool loop in the server process, shared context | Can seed the evaluator without another service. Confirmed requested-limit defect and instruction/configuration mismatch prevent declaring full baseline conformance. Process loss remains a distinct recovery limitation. |
| Mastra workflow | Separate workflow variant with storage and suspend/resume | Evaluate separately. It uses requested limits but shares per-tool counter code; restart and suspended approval need their own extension claims. |
| DBOS baseline | Native workflow and a single model step | Lifecycle tests can begin; model-selected tool feedback and session context are absent. |
| Inngest baseline | Native event/function and a single model step | Lifecycle tests can begin; tools, sessions, and event-specific ordering need implementation. |
| Trigger.dev baseline | Native task/worker and a single model step | Needs native deployment access, a full loop, and explicit ambiguous-retry/attempt accounting before side-effect studies. |
| Hatchet baseline | Embedded/remote native task and a single model step | Needs full loop, session support, and changed-content/deduplication tests. Embedded runtime still counts as real infrastructure. |
| Vercel Workflows baseline | Native compiled workflow/model step with local World | Fresh tests exercised local World. Tools/context remain absent; managed hosting requires separate evidence. |
| AWS Step Functions baseline | Platform-local Standard workflow/Activity implementation | Absent from shared bootstrap and registry. Needs registration, provider/cancellation bounds, and full loop before frontend agent acceptance. |
| LangGraph/Temporal composition | Directory and documentation scaffold | No inspected runnable composition. Exclude from implementation/pass denominators. |

The shared [bootstrap](../../server/src/control-plane/bootstrap/server.ts) registers
nine platform baselines, plus Mastra workflow when configured. A registered runner
is not a reachable service or an agent-baseline pass. Six platform-local baselines
above currently perform only a single model request.

Detailed source and test references are in the [priority audit](platform-readiness-priority.md),
[other platform audit](platform-readiness-extensions.md), and
[methodology audit](platform-readiness-methodology.md). Repository pins in those
notes describe the inspected versions, not the latest upstream releases.

## Shared case coverage and gaps

"Existing coverage" below means inspected code/tests, not a new passing native
matrix. Tests often cover only part of a proposed case or replace a native client.

| Case | Existing coverage | Missing evidence or implementation |
| --- | --- | --- |
| B01 completion | Prompt/model/result paths across platform baselines; priority conformance fixture | Strict completed-output grading and actual request/configuration comparison. Mastra's actual system instruction differs from the recorded manifest. |
| B02 feedback | Calculator loops on four priority platforms | One observed execution, correlated result, and that result in the next actual mapped model request. Six other baselines lack this loop. |
| B03 continuation | Shared sessions and priority context paths | Independently grade marker delivery, roles and no duplicates in the actual second request. Existing fixture answers are not sufficient evidence. |
| B04 isolation | Shared session-store/run-service tests | Interleaved native sessions with captures proving absence of the other session's context and identities. |
| B05 input validation | Shared tool registry and selected native tests | Invalid model-selected calls through every applicable native path with independent zero-execution receipts. |
| B06 permission boundary | Shared policy and four-platform native capability matrix | Independent effect ledger, denied and authorized controls. Common tool selection must not silently advertise unsupported execution on other baselines. |
| B07 limits | Execution deadlines, bounded loops in priority paths, selected tests | Mastra request limits are ignored in baseline and counters are per tool; add request-level and mixed-tool dispatch accounting. Freeze round/attempt semantics. |
| B08 failures | Extensive model/provider/tool unit and selected integration tests | Comparable malformed-response/tool-failure controls, exact attempts and retry classification across native variants. |
| B09 cancellation | Native mappings and selected tests | Cancellation at an observed dispatch boundary; prove no later work. Reproduce the LangGraph dispatch risk and test terminal races. |
| B10 identity | Shared turn admission and platform-native deduplication | End-to-end identical versus changed-content submission tests per variant. Native run-ID deduplication is not automatically the session-turn contract. |
| B11 evidence | Bounded sanitized store, ordered/deduplicated events, native references | Typed eval reports, model-boundary receipts, independent effects, version/revision/trial metadata and complete denominators. Current matrices remove evidence. |
| B12 uncertainty | Admission/inspection reconciliation and selected provider tests | Freeze ambiguous retry contracts, measure actual redispatch, and preserve unknown outcomes. Audit Trigger/Vercel/AWS before writes. |

This matrix is a source-level audit. The executable assertion-to-test/run matrix
is still part of the next implementation, so no B01–B12 platform pass is claimed.

## Fresh observations

| Check | Result | What it establishes |
| --- | --- | --- |
| Server build as part of `pnpm --filter @agent-harness-lab/lab-server run test` | Passed | Current TypeScript compiles. |
| Server test suite | 459 tests: 456 passed, 1 failed, 2 skipped | Broad existing checks. Most platform boundaries are mocked or injected; some local SDK execution is real. This is not a green full suite. |
| Mastra baseline integration, `node --test server/dist/integration-tests/mastra-baseline.test.js` | 6 passed, 0 failed/skipped | Native `Agent.generate`, common evidence, process-loss reporting, session continuation, compaction, HTTP path and missing-key rejection with synthetic provider responses. No live provider. |
| Mastra pure-calculator probe | Requested `maxCalls=1`, `maxRounds=2`; effective configuration was 8/6; 2 tools executed, 3 model calls, status completed | Reproduces a budget contract failure through the native SDK agent loop. No external effect or provider request. |
| Same probe's captured model request | Actual system instruction was the fixed Mastra instruction, while manifest recorded the common baseline instruction | Recorded settings alone do not prove what the model received. Requires explicit variant instruction contract and accurate capture/configuration. |
| Local service inventory | Web listened on 5173; no listener on default Lab API 4318, Temporal 7233, Restate 9080 or LangGraph 2024 | Shared native acceptance could not be freshly exercised against those default profiles. Custom/remote profiles were not inferred from port absence. |
| Python environment check | Python 3.11/3.12 had SQLite, but neither inspected interpreter had LangGraph, pytest or FastAPI; repository `.venv` absent | Python native tests were not run; no dependency environment was installed for this investigation. |

The failed test is
[`http.test.ts`](../../server/tests/control-plane/http.test.ts), the
"HTTP API exposes server-owned capability profiles without secrets" assertion.
It expects two profiles while the implementation and catalog test include
`local-mcp-safe` as a third. Repair the expected catalog contract while preserving
the secret checks; do not remove assertions to report a green result.

The confirmed limit defect follows
[`mastra-runner.ts`](../../server/src/platforms/mastra/runner-adapter/mastra-runner.ts)
using platform defaults and
[`configuration.ts`](../../server/src/platforms/mastra/variants/baseline/config/configuration.ts)
reading them instead of request capabilities. The shared
[`agent.ts`](../../server/src/platforms/mastra/variants/baseline/agent.ts) also
creates independent counters per tool, affecting both baseline and workflow.
The probe injected a synthetic model that requested the pure calculator on its
first two responses, then returned final text, and counted `ToolExecutionStarted`.
Turn this probe into regression tests covering one-tool, mixed-tool, and round limits.

Cancellation and ambiguous-retry concerns in the platform audits remain
source-based risks until their specific races are reproduced. Keep them distinct
from the demonstrated Mastra limit failure.

The priority audit also finds Temporal and LangGraph storing final-round usage
rather than established whole-run totals. The other-platform audit finds retry
attempt counts inconsistent with configurable/native attempts in DBOS and Trigger.
Before cost or efficiency comparisons, add multi-round/multi-attempt fixtures and
define unknown usage, failed calls, compaction consumption, and actual total cost.

## Next implementation slice

1. Restore the known test contract for the third capability profile and add
   regression cases for Mastra's requested and aggregate tool limits. Make
   baseline/workflow budgets enforce the same declared request semantics.
   Define and record the actual system instruction delivered by the variant.
2. Build small scenario-owned B01/B02/B03/B07 graders using actual safe request
   captures and tool receipts. Reject failed/ambiguous outcomes in successful
   workload cases. Validate graders against missing feedback, fabricated final
   answers, wrong context, missing evidence, and duplicate identities.
3. Add a bounded versioned eval report through the existing evidence owner and
   read allowlist. Retain clean trial roots and failed/blocked evidence; distinguish
   an eval verdict from run status. Record repository/dirty-state identity,
   fixture/grader versions, settings, native identity, attempts and denominators.
4. Run three clean scripted trials per case on Mastra, then Temporal/Restate/
   LangGraph as their isolated native profiles become available. Keep the other
   core cases explicitly incomplete. Add independent fixture state for B05/B06,
   interleaved B04, and cancellation/uncertainty reproducers next.
5. After the priority contract is measurable, port one full loop into a remaining
   baseline. Vercel local World is a practical first candidate because its real
   execution tests ran here; choose DBOS instead when the intended study needs
   PostgreSQL-backed execution and that profile is available. This is an
   implementation-order choice, not a platform ranking.

In parallel with that slice, declare variant support for tools/context and reject
unsupported selections before dispatch. This closes the gap where a configured
capability can look enabled while the single-step runner drops it. Keep capability
declaration small and grounded in the existing runner boundary.

## When evals can start

| Eval tier | Start condition | Current decision |
| --- | --- | --- |
| Fixture/grader unit diagnostics | Synthetic inputs and known pass/fail controls | Start now. Existing tests and the probe already provide useful failures. |
| Scripted native development evals | Correct isolated runner/profile, disposable state, finite enforceable bounds, retained observations | Start the narrow slice now on Mastra; fix/guard the observed budget defect. Other native profiles need services. A failed test is valid evidence. |
| Read-only live characterization | Relevant B01/B02/B03 mechanics and B07 bounds pass for the exact variant; B04 for session studies; fixed model/settings, explicit live opt-in and spending bounds | Begin after those checks, without waiting for optional durability extensions. Do not substitute models or select only successful trials. |
| Live cases involving writes or untrusted content | Relevant isolation, validation, permission, bounds and cancellation checks; independent disposable effect ledger | Defer until these gates and fixture controls exist. No production targets are needed. |
| Crash/acknowledgement-loss extensions | Test-owned processes/stores, named observable fault boundary, injection receipt, effect counts, idempotency contract and cleanup | Dedicated implementation required. Existing restart tests seed specific experiments; the broad experiment directories are still scaffolds. |
| Full shared-baseline acceptance | All B01–B12 assertions pass for the exact variant/profile, with repeated retained evidence | Not ready to claim for any platform from this investigation. Missing/blocked cases cannot count as passes. |
| Comparative platform claims | Same versioned tasks/settings, comparable evidence and sample plan; optional capabilities declared separately | Defer until measurement and applicability are trustworthy. Local results cannot establish hosted production guarantees. |

The safety gates are Lab engineering decisions informed by the
[methodology sources](platform-readiness-methodology.md), not a universal
definition of a safe or perfect agent. A provider timeout cap alone is not a
spending limit; record maximum calls/output and actual usage where available.

## Alternatives and limits

Waiting for every platform to be complete would delay feedback on defects that
already exist. Running only live models now would mix provider decisions with
missing loops, inaccurate budgets and permissive graders. A shared generic agent
runtime would obscure the platform differences the Lab is intended to study.
The selected narrow, independently graded slice addresses those problems with
the least new infrastructure.

This investigation did not start native servers, replace shared developer
processes, run paid models, change runtime code, or repair the discovered defects.
Those are explicit next implementation work. It inspected all platform code and
tests, but fresh native acceptance is limited to the locally executed paths above.

Publication validation: all 69 local links across the four readiness documents
resolved; documentation generation produced 85 curated documents; web
typecheck/build passed with the existing large-chunk warning; whitespace checks
passed. Browser verification opened this report through Agent evals and confirmed
the rendered title. These publication checks do not change platform readiness.
