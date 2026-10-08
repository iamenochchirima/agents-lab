# Application

Owns create, start, cancel, observe, and complete run use cases. It coordinates ports
without knowing Fastify, a database, or a platform's internal runtime.

`RunEvidenceStore.writeEvalReport(runId, report)` retains a schema-v1 case report
at `artifacts/eval.json`, limited to 256 KiB. The report records the suite and
grader versions, case, trial, verdict, expected and observed assertions, synthetic
fixture captures, source revision, dirty state, runtime versions, and timestamps.
Configuration remains in each run's immutable `config.json`.

Reports belong to an existing run. Correlated runs must exist and share its
platform and variant; B03 turns must also share a session. Repeating the same
write succeeds, while different content conflicts. Credential-shaped fields use
the ordinary evidence sanitizer. Report reads validate the supported schema and
size; the allowlisted file reader exposes only `artifacts/eval.json`, alongside
the existing evidence files. Missing reports return null from `readEvalReport`.
Unsupported versions, malformed reports, incompatible run references, and
oversized reports fail explicitly. Real provider prompt captures do not belong
in this synthetic baseline report.

## Retained human assessments

`EvalAssessmentStore` owns append-only local assessment records under
`lab/runs/.eval-assessments/<assessment-id>.json`. The original report and summary
are never rewritten. Trial detail exposes a SHA-256 digest of the exact retained
report bytes, the retained fixture's rubric and a rubric version derived from the
suite, grader and rubric. Only a matching review-required blocked report whose
objective assertions all pass is eligible. Missing rubrics/evidence remain
unavailable; subjective review cannot override objective failures.

The local API is:

```text
GET  /api/evals/:invocationId/cases/:caseId/trials/:trial
POST /api/evals/:invocationId/cases/:caseId/trials/:trial/assessments
```

GET includes `assessmentContext`, ordered `assessments` and a separate
`assessedOutcome`; original verdict/counts stay unchanged. POST accepts
`assessmentId`, `evidenceDigest`, `rubricVersion`, `reviewerLabel`, `rationale`,
`answers: [{ questionId: "semantic-rubric", outcome: "pass" | "fail" |
"uncertain", rationale }]` and optionally `supersedesAssessmentId`. Copy the
current digest/rubric version from GET. The answer addresses the entire retained
rubric. Uncertain answers remain review-required. A revision must supersede the
latest assessment; it is a new record rather than a replacement.

Publication syncs a temporary file, atomically links it without replacing an
existing identity, and syncs the directory before acknowledging. A lost response
is retried with exactly the same identity/content, returning the same record;
conflicting reuse rejects with 409. No agent execution is dispatched. One
control-plane writer serializes lineage updates. Restart reconstructs the chain
from bounded validated records; corrupt/branched records fail closed. Multiple
independent writer processes are unsupported.

Reviewer labels are local user attribution, explicitly
`local-unverified-label`, not authenticated identity. Browser submissions must
match the configured frontend Origin. CLI submissions use local deployment
ownership; this endpoint is not a public multi-tenant authorization scheme.
The store rejects malformed inputs and unsafe record files. Grader-3 and grader-4
revision reports have explicitly allowlisted filenames; older verdict artifacts
remain immutable alongside them.

Validation: server build and six focused assessment/result projection tests
passed on 2026-10-08. Synthetic reviewers appear only in unit fixtures; no actual
retained trial has been automatically adjudicated.
