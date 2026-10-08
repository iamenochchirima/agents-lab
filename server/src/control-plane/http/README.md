# HTTP

Owns Fastify routes, request validation, response translation, and event streaming.

`GET /api/evals?limit=25` reads retained invocation summaries. The limit is 1–50,
defaulting to 25. `readEvalResults` scans at most 500 entries beneath the configured
run root's `.evals/` directory and bounds each summary to 256 KiB. `scanTruncated`
indicates the scan ceiling was reached; results then cover a bounded subset.
The endpoint projects invocation/model/platform identity, timestamps, mode,
case verdicts, reasons, run IDs, and a safe report marker. It never returns raw
runner configuration, provider credentials, or local evidence paths, and it never
dispatches model work. Historical summaries without `mode` remain scripted.

`POST /api/runs` resolves the selected capability profile before dispatch. If the
profile was removed or one of its required dependencies is unavailable, the
request returns `409` with `CAPABILITY_PROFILE_NOT_FOUND` or
`CAPABILITY_PROFILE_UNAVAILABLE`; no model run is started. Refresh the capability
list and choose an available profile before retrying.

Interrupted summaries have `status: "incomplete"` and `completedAt: null`.
Malformed, oversized, missing, or unsafe summaries produce incomplete placeholders
with no case verdicts. Linked directories are excluded and linked summary files
are rejected. Counts are derived from retained cases rather than trusted from the
stored aggregate. Existing `/api/runs/:runId/evidence/*` routes supply the report
and trajectory files after normal evidence validation.

Focused validation:

```bash
pnpm --filter @agent-harness-lab/lab-server exec tsx --test tests/control-plane/eval-results.test.ts
pnpm --filter @agent-harness-lab/lab-server exec tsx --test --test-name-pattern 'eval result API' tests/control-plane/http.test.ts
```

## Hosted tool receipt inspection

`GET /api/runs/:runId/tool-receipts/:toolCallId` returns `{runId,receipt}` from
an existing hashed call receipt. It exposes pending/complete status, effect and
presentation evidence and sanitized source attempts. It does not retry, reconcile
or change an external operation. Action-review raw arguments are separate and are
not exposed by this route. Unknown runs/calls return 404; invalid call IDs return
400. Reads are bounded and reject linked receipt files/directories.
