# Agent evals

`/evals` reads recent retained evaluation summaries and browses the baseline
specification. The page never starts evaluations. Refresh reloads the latest 25
invocations from `GET /api/evals?limit=25` on the existing lab control-plane server,
configured by `VITE_AGENTLAB_API_URL` and defaulting to port 4318.

Saved `capability-acceptance` summaries appear as Business workflows, preserving
original per-platform/task verdicts, boolean assertions, native run statuses and
model identity. Multi-platform invocations are labelled Multiple platforms and can
be filtered by their individual platform/task outcomes. Inline details use the
bounded retained summary for business assertions and service/review observations,
then anchor event/context/trajectory/result reads to its run IDs. They never invent
an `eval.json` artifact or regrade a failed workflow. Historical acceptance summaries
without timing/completion metadata remain visibly incomplete while their recorded
outcomes stay accessible. New completion markers require the declared platform ×
task outcome set. These workflows do not join benchmark comparison groups.

Filter saved results by execution mode, platform and task. Cross-platform comparison
includes only matching retained suite, grader version, model, settings, context, tool, fault and
profile controls. Historical summaries without those controls stay readable and
are labelled not comparable. Comparison shows individual observations, not rankings.

Expand a trial to load its assertions inline with expected and observed values,
recorded events in their original order, call/result identities, terminal outcome,
context and native trajectory. Full event payloads and task/fixture observations
are available through progressive disclosure. A compact fixture section shows retained
before/after state, effect counts and available lookup/write attempt counters. Missing
counters stay unavailable. Pending human review exposes the retained rubric and
challenge/control final answers beside the objective assertions. Pending human assessment is shown as
review required while the verdict remains blocked. Raw supported artifact links
remain available alongside the inline view. Blocked trials with no
admitted run show their reason without invented evidence links. Empty results and
an unavailable server remain explicit. Interrupted or malformed summaries show an
incomplete invocation, without a fabricated pass. The API scans at most 500 index
entries, returns at most 50 invocations, bounds each summary to 256 KiB, rejects
linked files/directories, and projects safe fields rather than raw configuration
or local evidence paths. The detail endpoint is
`GET /api/evals/:invocationId/cases/:caseId/trials/:trial`. It anchors access to the
retained summary's run identities, uses the supported evidence reader and bounds
each inline artifact to 256 KiB. Missing, oversized, malformed or linked artifacts
show explicit unavailable messages. Secret fields and configured credential values
are redacted. Supported report markers are `artifacts/eval.json` and the bounded
revision `artifacts/eval-grader-3.json`. A regraded invocation shows its source
invocation and grader version, reads the revised report, and leaves original
observations and verdicts intact. Summaries describe observed development
trials; their counts do not establish platform reliability or complete readiness.

Below the saved results, select core harness, real-model, or platform capability
cases, search, and expand a case to inspect task and acceptance criteria. Group
selection is retained in the URL.

The canonical source is `lab/scenarios/platform-agent-conformance/eval-cases.md`,
imported as text at build time. `evalModel.ts` reads its three-column case tables
so frontend criteria and Docs use the same saved specification. Case rows have
stable B/M/X IDs; literal pipes must be escaped. Invalid or duplicate rows fail
explicitly. Research and protocol links use existing Docs routes. Temporary
implementation plans are not published by this feature.

Validate from the repository root:

```bash
pnpm --filter @agent-harness-lab/web run build
pnpm --filter @agent-harness-lab/lab-server exec tsx --test ../apps/web/tests/evalModel.test.ts
pnpm --filter @agent-harness-lab/lab-server exec tsx --test ../apps/web/tests/evalResults.test.tsx
git diff --check
```

The result rendering check covers retained pass/fail/blocked outcomes, reasons,
safe API evidence links, absence of local filesystem paths, and an empty list.
Runtime model results require separate live execution evidence.


Coverage maps exact baseline B/M/X requirements to executable cases and retained
original outcomes through `/api/evals/coverage`. Missing variant, completion or
assertion evidence cannot become a pass. Native X evidence has its own bounded
projection; a core pass is not a full readiness or live-model score.

`EvalAssessment.tsx` submits a real local reviewer assessment bound to the server's
evidence digest/rubric. A lost acknowledgement can retry the same identity. Original
verdicts remain visible; uncertain assessments require further review. See the
[inspection guide](../../../../../docs/guides/agent-eval-coverage.md) for controls
and attribution limits.
