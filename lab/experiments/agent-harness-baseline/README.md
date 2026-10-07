# Agent harness baseline evaluation

Status: protocol version 1, updated 2026-10-08. B01–B12 scripted development
cases and L01–L06 free-model probes are executable on the four priority profiles.
The scripted suite is version 2; live task suite version 2 uses grader version 3.
Saved development trials establish only their observed assertions, not reliability. See [run and inspection instructions](development-evals.md). Start with the [case specification](../../scenarios/platform-agent-conformance/eval-cases.md)
and [source research](../../../docs/research/platform-agent-evals.md).

## Question and hypothesis

Can each platform variant execute the Lab's basic agent contract through its native
runner while preserving authorization, context, bounded execution, and truthful
evidence?

Hypothesis: all selected variants can satisfy the shared B01–B12 contracts with
scripted model responses, although their internal mechanisms and optional recovery
guarantees differ. Live M01–M04 success may vary even when core conformance passes.

The changed variable is the harness/platform variant. Model quality is held out of
the core experiment by scripted responses. Live-model experiments change that
control explicitly. Fault conditions are separate trials, never hidden changes.

## Boundaries and choices

- Scenarios own tasks, fixture inputs, and expected outcomes.
- This experiment owns controls, trial schedule, faults, and result interpretation.
- Platform variants own model/tool loops, state, retries, and native telemetry.
- Graders consume captured requests, normalized/native evidence, and independent
  fixture state. They must not trust an agent's completion claim alone.

We choose a behavioral contract over a shared runtime implementation so the suite
can detect errors in each platform's own loop. We choose per-case results over one
weighted score because a cheap correct answer cannot offset an unauthorized write.
We choose scripted core tests plus live companion tests over live-only testing so
we can separate context delivery and lifecycle defects from model decisions. Scripts
cannot establish reasoning capability or realistic model-provider behavior.

## Controls and prerequisites

Start with Temporal, Restate, LangGraph, and Mastra, the existing priority profile.
Expand to other registered variants once each has declared its deployment profile
and case coverage. Include compositions as explicit variants when relevant.

Freeze suite/fixture/grader versions, repository revision and dirty patch identity,
platform SDK/runtime versions, prompt, tool schemas and policies, model settings,
context strategy, memory policy, budgets, and fault schedule. Each trial gets fresh
fixture state and independent run/session identities; B03/B04/B10 deliberately share
only the identities their cases require. Never reuse artifacts from earlier trials
as undisclosed context.

The scripted core needs no live-model credential. Native acceptance needs each
platform's documented services. Live companions require explicit opt-in and the
chosen model credential. Record unavailable infrastructure as blocked; do not silently
replace the native runner with a mock or change the model. Do not launch paid live
trials automatically when implementing this protocol.

## Trial procedure

1. Validate the fixture and grader together using known passing and failing controls.
2. Declare capability applicability and expected retry/cancellation policies before
   execution. Record missing implementations as not implemented.
3. Reset the environment and capture the full resolved configuration.
4. Submit the case through the normal Lab server and selected runner. A unit fixture
   that replaces the runner is a unit test, not native acceptance.
5. Trigger any fault at a named observable boundary. Retain its acknowledgement and
   timestamp. If the boundary was never reached, record the trial as not exercised.
6. Capture model requests, tool calls/results, terminal status, native references, and
   independent final fixture state. Preserve partial evidence on timeout or crash.
7. Grade each assertion, attach evidence references, and classify the failure.
8. Repeat and compare per case. Review surprising passes as well as failures.

B08 faults include a known provider failure and malformed response before completion.
B12 distinguishes pre-admission unavailability from lost acknowledgement after
dispatch. B09 requests cancellation at an observed dispatch boundary, not an arbitrary
sleep. Recovery extensions use the dedicated fault experiments and must specify exact
before/after persistence and side-effect boundaries before implementation.

## Grading and reporting

Keep the application's run status distinct from the eval verdict. A failed run can
pass a test that expects truthful failure; a completed run can fail a permissions test.

Report each case as pass, fail, blocked, not implemented, or not applicable, with a
reason and evidence. Unknown or unexercised assertions cannot pass. Optional cases
are not applicable only when the capability is not claimed. Report counts for every
category so excluding unavailable cases cannot inflate apparent readiness.

For a first development gate, run each implemented scripted case three times from
clean state and require every core assertion to pass. This is a Lab policy to catch
obvious instability, not statistical proof of reliability. Mark readiness incomplete
while any core case is blocked or not implemented. M01–M04 are separate measurements;
their release thresholds must be chosen for the intended agent before results are seen.

The [first implementation slice](../../../development/implementation-plans/platforms/active/agent-harness-baseline-evals.md)
uses one trial per case for normal development feedback, following the user's
2026-10-07 preference for minimal testing and working results first. This is a
partial diagnostic mode. The three-trial readiness gate above and the full core
acceptance claim remain separate; neither is established by a one-trial report.

For initial live characterization, use ten trials per case and report successful
trials/attempted trials, uncertainty, latency distribution, actual model/tool attempts,
usage completeness, and cost per successful task when cost is known. Ten trials are
exploratory. Increase samples for close comparisons; paired task sets and randomized
platform order help reduce task and provider-time confounding. One success in several
attempts and consistent success across all attempts answer different questions.

Classify failures as harness, model/provider, environment, fixture/grader, or unresolved
only when evidence supports attribution. Keep unresolved failures visible. Correcting
a broken grader requires a new grader version and regrading all comparable runs.

## Evidence contract

Reuse `lab/runs/<run-id>/` with `config.json`, `events.jsonl`, `trajectory.json`,
`metrics.json`, `result.json`, native evidence, and artifact/log references. Add an
eval artifact under `artifacts/` only through the evidence writer's supported path.
The full protocol record must include:

- suite/case/grader/fixture versions, trial index, run ID, and declared capabilities;
- all controlled settings above, timestamps and seeds where applicable; a seed does
  not guarantee deterministic behavior from a remote model;
- fault trigger, observed injection point, attempt counts, and external effect counts;
- per-assertion verdict, expected/observed values, safe evidence references, attribution;
- aggregate denominators, unavailable/not-implemented cases, and known limitations.

The development evaluator retains B01/B02/B03/B07 reports through the supported
`artifacts/eval.json` evidence path. Full fault and readiness records remain future work. Preserve
native diagnostic detail using safe bounded capture. Use synthetic credentials as
redaction sentinels; retain no keys, headers, personal data, or sensitive tool payloads.

## Existing checks and next implementation

These existing commands inspect starting coverage. They do not execute the full new
suite:

```bash
pnpm --filter @agent-harness-lab/lab-server run test
pnpm --filter @agent-harness-lab/web run generate:docs
git diff --check
```

With native services and the local HTTP fixture already running, the existing opt-in
matrix provides part of B06/B09/B11 coverage:

```bash
pnpm --filter @agent-harness-lab/lab-server run test:platform-capability-matrix
```

Implement in the order set out in the [platform eval implementation plan](../../../development/implementation-plans/platforms/active/agent-harness-baseline-evals.md).
There is currently no command that produces a complete B01–B12 report.

## Interpretation limits

Passing establishes observed behavior for these versions, profiles, tasks, and fault
points. It does not prove a perfect agent, general intelligence, universal security,
production reliability, or exactly-once effects. Local restart behavior must not be
presented as a hosted deployment guarantee. A shared-core pass does not rank platform
strengths; extension experiments make those differences inspectable.
