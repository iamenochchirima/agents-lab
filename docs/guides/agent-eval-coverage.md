# Inspect agent eval coverage

The Lab evaluates exact backend platform variants, not a business-agent product.
Mastra, LangGraph, Temporal and Restate baseline agents use native model/tool loops
and connected capabilities. Native filesystem management is excluded. File tools
may use an external provider, just as other capabilities use configured services.

## Read the coverage view

Open **Agent evals → Coverage and remaining gaps**. Choose a baseline and requirement
group. Implementation means an executable evaluator exists; observed outcome means
retained evidence exists for that exact variant. A case can be implemented and fail,
or remain unexercised. Old passes do not establish readiness at the current revision.

B cases measure harness mechanics with synthetic model responses through real native
execution. M cases measure model and harness behavior together. The executable L
companions map to M requirements explicitly: M01 uses L02, M02 uses L07, M03 uses L05,
and M04 uses L06. L03 marker recall does not establish language-correction behavior.

X cases measure explicitly claimed native capabilities at named boundaries.
X01 active restart recovery is claimed for Temporal/Restate in this deployment;
Mastra/LangGraph waiting review reconstruction belongs to X04. X03 logical event
processing is unclaimed for these baseline workloads; telemetry deduplication is a
separate contract. X02 depends on the configured external provider's idempotency
semantics and explicit reconciliation; it does not establish exactly-once effects
for arbitrary tools. Expand native evidence to inspect checks and source references.

Coverage scans are bounded: up to 50 recent eval invocations and 200 native-proof
entries. Truncation and incomplete evidence are reported. Missing variant identity,
missing completion or unsupported evidence cannot produce a passing coverage cell.
The server registry is `lab/experiments/agent-harness-baseline/coverage.mjs`.
The read-only endpoints are `/api/evals/coverage` and `/api/evals/extensions`.

## Assess a retained answer

Expand a saved review-required trial and inspect the rubric, actual answers and
objective assertions. Enter a reviewer name, judgment and evidence-based rationale,
then **Save assessment**. Reviewer names are local attribution, not authenticated
accounts. The server binds the assessment to the exact evidence digest and rubric
version. Reloading the trial retains its history and separate assessed outcome.

An uncertain judgment remains review-required. Original machine verdicts and
historical reports stay unchanged. A revised assessment explicitly supersedes the
latest one; identity replay is idempotent and conflicting or stale reuse rejects.
After a lost acknowledgement, **Retry same assessment** uses the same identity and
never calls a model or tool. The application cannot invent a human reviewer or
replace a failed objective assertion with a favorable subjective judgment.

## Remaining readiness work

The historical B01–B12 milestone recorded 48 passing reports, one trial per case
across four baselines. The protocol's three-clean-trial gate is a separate readiness
measurement at a frozen revision. Larger live reliability campaigns are deferred
under the current minimal-testing preference; one observation is not a success rate.

The latest historical connected-tool trial retains two passes, three strict failures
and three errors. Three failures skipped autonomous skill activation despite its
instruction being delivered. Explicit skill preload is a separate control and cannot
pass an assertion requiring autonomous loader choice. Timeout evidence distinguishes
native execution, provider/model operations, transport limits, observation windows
and later cancellation settlement. Increasing every limit is not an eval fix.

See [executable commands](../../lab/experiments/agent-harness-baseline/development-evals.md),
[the capability experiment](../../lab/experiments/agent-capabilities-live/README.md)
and [compatibility limits](connected-tool-compatibility.md). New trials, assessments
and bounded native acceptance are additional evidence; they do not rewrite the
historical outcomes above.
