# Invocation review

A profile grant permits proposing an invocation; approval authorizes its exact
retained arguments. The capability host validates the frozen run catalog and
persists a proposal before any write. Native agents suspend independently using
platform snapshots, checkpoints, workflow history or journals.

`GET /api/runs/:runId/actions` returns safe review values. Submit a decision to
`POST /api/runs/:runId/actions/:requestId/decision` with `requestId`, `revision`,
`argumentDigest`, `decisionId`, and `decision` (`approved` or `denied`). An optional
reason becomes denial feedback. Duplicate identical decisions are retained;
conflicting decisions or stale argument/revision identities fail.

Expired reviews require `POST /api/runs/:runId/actions/:requestId/renew`. The server
revalidates the retained call, creates a new revision and resumes the native waiting
reference with a server-issued renewal identity. Renewal neither approves nor
executes the action. A subsequent decision must use the fresh revision. Retrying
renewal after a lost response resumes the retained renewal rather than creating an
unbounded series of revisions.

Pending reviews expire after 24 hours; approved dispatch permission expires after
15 minutes. Human waiting is separate from model and tool deadlines. Cancellation
invalidates pending permissions. The host rechecks run state and claims dispatch
under the same single-host run lock used by decisions and cancellation. Once I/O
has dispatched, cancellation cannot promise reversal of an external effect.

Protected raw arguments are stored under the run's `artifacts/action-reviews/` with
0600 permissions. Browser values redact schema-marked sensitive fields and common
secret names. Redaction does not change the argument digest. Call receipts retain
same-call replay independently of review state. An interrupted pending receipt
remains unknown and cannot be re-executed merely by approving again.

The store is not a distributed lock service. API restart and native waiting restart
are separate acceptance requirements. See the [decision record](../../../../docs/adr/0006-connected-business-agent-boundary.md).
