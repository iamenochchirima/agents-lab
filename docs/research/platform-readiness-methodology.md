# Platform eval readiness methodology

This records the pre-implementation investigation. For the implemented four-case
[development command and current limits](../../lab/experiments/agent-harness-baseline/development-evals.md),
see the [implementation handoff](../../development/implementation-plans/platforms/active/agent-harness-baseline-evals.md).

Research date: 2026-10-07. This note audits the existing acceptance design and code;
it does not report a fresh native-platform pass. Read it alongside the
[baseline protocol](../../lab/experiments/agent-harness-baseline/README.md) and
[case specification](../../lab/scenarios/platform-agent-conformance/eval-cases.md).

## Decision

Start development evals before finishing the platforms. The next implementation
should produce one retained, independently graded B01/B02/B03 report through each
ready native runner. Use the four existing priority variants first, admitting each
only when its services are available. An unavailable variant stays blocked rather
than holding up the others or being replaced by a mock.

The current fixtures are useful starting code, but they do not yet establish the
new shared-core acceptance contract. Add the evaluator and missing measurements
before adding more platform capabilities. A first report can be deliberately
partial. It must show missing cases and failed assertions honestly.

## Source basis and limits

Anthropic distinguishes task, trial, grader, transcript, and final environment
outcome. It recommends code, model, and human graders according to the property
being measured, and describes evals as useful during early development. This
supports starting with narrow executable checks now. It does not prescribe this
Lab's readiness thresholds. [Agent evaluation guide](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

Tau-bench grades final database state and measures consistency over repeated
trials. This supports checking fixture state independently and retaining all
attempts. Its domain benchmark results do not establish a baseline for platform
adapters. [Tau-bench paper](https://arxiv.org/abs/2406.12045).

Restate stores durable-step results for replay and retries failures according to
policy. Its docs also provide stable UUIDs for idempotency keys. Replay of a
stored result and safe recovery after an unacknowledged external write require
different tests. [Restate durable steps](https://docs.restate.dev/develop/ts/durable-steps).

Temporal explains that Activity retries can repeat execution, and recommends
idempotent operations or keys. Its documentation distinguishes replaying recorded
Activity results from executing an Activity again. A successful restart after a
recorded result cannot establish duplicate protection in the window before that
result becomes durable. [Temporal idempotency and durable execution](https://temporal.io/blog/idempotency-and-durable-execution).

The gates below are Lab engineering policy inferred from those sources and the
repository's contracts. They are not published universal safety standards.

## What the repository actually provides

| Evidence anchor | Present behavior | Gap against proposed evals |
| --- | --- | --- |
| [Conformance workload](../../server/tests/platform-conformance/workload.ts) | Three requests for completion, calculator, and context continuation; lifecycle-presence assertions | Any terminal status, including failure or reconciliation-required, satisfies the terminal helper. A failed tool also satisfies its tool-outcome assertion. It checks neither `42` in the next request nor retained marker ordering. These helpers must not be used unchanged as B01–B03 graders. |
| [Workload unit tests](../../server/tests/platform-conformance/workload.test.ts) | Request construction, explicit session requirement, lifecycle assertion checks | Fabricated event fixtures test the helpers. They do not execute native runners. Add negative grader controls where events exist but result, identity, request context, or tool feedback is wrong. |
| [Capability matrix](../../server/integration-tests/platform-capability-matrix.test.ts) | Real Temporal, Restate, LangGraph, Mastra runner paths; denied write, connected read, approved write, cancellation | It deletes temporary run roots after completion. It checks write denial through recorded events rather than an independent effect count. Cancellation occurs immediately after creation, without waiting for observed model dispatch. It supplies partial integration evidence, not a retained B01–B12 report. |
| [Native platform integration tests](../../server/integration-tests/) | Platform-owned model/tool/context/error tests, plus selected restart tests | Assertions differ by variant. Many roots are temporary and removed. Reuse these mechanisms while mapping each case assertion explicitly; test names and completion plans are insufficient evidence of coverage. |
| [Evidence store](../../server/src/control-plane/application/evidence-store.ts) | Sanitized bounded configuration, context, events, result, trajectory, metrics, native references; ordering and duplicate identities; provisional reconciliation result can resolve | It creates `artifacts/` but exposes no eval artifact writer and no eval artifact read allowlist. Add a bounded typed report through this owner, rather than writing arbitrary files around it. |
| [Result and metric contracts](../../server/src/control-plane/domain/types.ts) | Separate model-call/attempt counts, optional tool/connection/retry counts, nullable usage and cost | Eval verdict, assertion references, fixture/grader versions, trial membership, effect counts, and fault-trigger receipt still need explicit eval records. `null` usage/cost must remain unknown. |
| [Worker crash](../../lab/experiments/worker-crash/README.md), [ack loss](../../lab/experiments/side-effect-ack-loss/README.md) | Experiment intentions | These are scaffolds, without a complete fault plan, fixture, grader, or native acceptance procedure. Their presence is not readiness for broad destructive trials. |

The existing [Restate restart test](../../server/integration-tests/restate-restart.test.ts)
and [Temporal MCP restart test](../../server/integration-tests/temporal-mcp-restart.test.ts)
check an independent MCP call count at selected boundaries. They are useful
extension seeds. Temporal's test deliberately expects an honest failed
`outcome_unknown` result after restart. Preserve that behavior instead of forcing
all recovery trials into completed status. Neither test alone establishes X02.

## Smallest credible executable slice

Keep scenario inputs and graders outside platform implementations. Platform code
continues owning native model mapping, tool dispatch, retries, and telemetry.
Use the current RunService admission path and runner implementations; do not add
one new common execution loop to make the suite pass.

1. Give the three existing cases stable B01/B02/B03 mappings and explicit expected
   outcomes. Record suite, fixture and grader versions, revision and dirty patch
   identity, platform/runtime profile, trial/run/session identities, resolved
   settings, and start/end timestamps.
2. Capture the actual safe model-boundary inputs. An initial `context.json` alone
   cannot prove that a later provider request received a tool result. Capture the
   post-mapping request for each model call, or have a scripted adapter assert its
   input and retain an assertion receipt linked to that call. Keep fake markers
   and fixtures free of personal data and credentials.
3. For B01, require completed output equal to the scripted final response, correct
   selected configuration, and one canonical result. For B02, require one actual
   calculator execution, correlated call/result IDs, `42` in the next model
   request, and completed output. For B03, require distinct turns in one session,
   retained marker in the second actual request, valid ordering and no duplicate
   entries. A model that returns the marker unconditionally must fail the grader
   when the captured request lacks it.
4. Validate the grader using known passes and deliberate failures: missing result,
   failed terminal status, wrong tool feedback, duplicated context, mismatched
   identity, and absent request capture. Missing evidence cannot pass.
5. Preserve run roots and a bounded eval report. A failed or blocked trial must
   remain visible with its partial evidence. A grader error must have its own
   classification and cannot silently become an agent failure.
6. Run three clean trials per implemented case and native variant, as the existing
   protocol proposes. Report 3/3 as an initial regression gate, not statistical
   proof. Keep B04–B12 listed as unimplemented until their assertions exist.

Do not broaden the first slice into all extension capabilities. Once it works,
add B04 session isolation, B05/B06 invalid and denied actions with an independent
fixture ledger, and B07 bounded execution. Complete the remaining core contracts
before declaring a variant's shared baseline ready.

## Gates by kind of evaluation

| Evaluation | Earliest safe start | Required evidence before making a readiness claim |
| --- | --- | --- |
| Unit fixture/grader development | Now, with isolated synthetic fixtures | Known passing and failing controls; no assertion relies solely on agent self-report. |
| Scripted native eval | Services reachable, correct native runner, clean session/fixture, finite budgets and retained evidence | Actual requests and tool/effect observations; strict assertion verdicts; missing cases visible. A failing run is expected development evidence. |
| Live M01/M02 characterization | Relevant B01–B03 mechanics pass for the exact profile; explicit live opt-in, controlled model/configuration and bounded cost | All attempts retained, raw success denominators and uncertainty, usage completeness, model/provider errors separated from environment failures. Do not require all B01–B12 before a read-only exploratory M01. |
| Live M03/M04 with writes | Relevant isolation, input validation, permission and limit cases pass; disposable fixture with effect ledger; paired authorized control | Independent effect count and final fixture state; no secrets or production targets. A harmless final-state check must not hide an intermediate forbidden action. |
| Worker crash or ack-loss extension | Dedicated processes owned by the test, disposable persistence and endpoints, named observable fault boundary, finite retries and cleanup | Injection acknowledgement; before/after persistence distinction; native identity and state; model/tool attempts separate from actual effects; reconciliation recorded. Never kill shared developer processes to obtain a trial. |
| Platform comparison or public baseline claim | Same versioned cases, settings and deployment profiles; comparable complete evidence | Core gates met per variant, blocked/not-implemented denominators reported, live repeats paired or randomized, optional capabilities declared before trials. |

A partial suite can start now and drive implementation. "Safe to evaluate" means
controlled experiments can run without harming unrelated work and their evidence
can be interpreted. It does not mean the agent has already passed or is ready for
production. Failing conformance tests are how missing behavior becomes concrete.

## Alternatives considered

Waiting until all platforms and all 21 cases are complete delays the feedback
needed to discover faulty loop mechanics. It also encourages capability additions
without a working measurement path. Reject that ordering.

A live-model-only suite reaches realistic behavior sooner, but a failure can come
from model choice, malformed mapping, lost context, or infrastructure. Use live
companions after the corresponding scripted mechanics are inspectable.

Wrapping existing integration tests in one overall green/red indicator is cheap,
but their current assertions, cleanup and applicability differ. Reuse their setup
and native test seams, while adding strict case-level grading and durable reports.

Implementing a large generic evaluation framework is premature. Start with a
small versioned report and three scenario-owned graders. Introduce reusable
abstractions only when actual cases justify them.

## Verification scope

This note used read-only repository inspection and primary-source checks. It adds
no runtime integration and launches no paid live-model, worker-crash, or ack-loss
trial. Current runtime reachability and platform pass results must come from the
main investigation and retained future reports.
