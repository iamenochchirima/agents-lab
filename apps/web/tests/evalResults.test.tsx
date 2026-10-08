import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SavedEvalResults, TrialDetailView, EvalComparison } from "../src/features/evals/EvalResults";
import type { SavedEvalInvocation } from "../src/features/evals/evalResultsApi";

test("retained live verdicts show evidence while blocked trials never invent run links", () => {
  const invocation: SavedEvalInvocation = {
    invocationId: "saved-trial", mode: "live", platform: "mastra", modelId: "google/gemma-4-31b-it:free",
    startedAt: "2026-10-07T10:00:00Z", completedAt: "2026-10-07T10:00:30Z",
    counts: { pass: 1, fail: 1, blocked: 1, error: 0 },
    cases: [
      { caseId: "L01", trial: 1, verdict: "pass", runIds: ["run-one"], evidence: "/private/path/artifacts/eval.json" },
      { caseId: "L02", trial: 1, verdict: "fail", runIds: ["run-two"], evidence: "eval.json", reason: "Required calculator was not called." },
      { caseId: "L03", trial: 1, verdict: "blocked", runIds: [], evidence: null, reason: "Provider quota unavailable." },
    ],
  };
  const markup = renderToStaticMarkup(<SavedEvalResults invocations={[invocation]} />);
  assert.match(markup, /Live model/);
  assert.match(markup, /google\/gemma-4-31b-it:free/);
  assert.match(markup, /Required calculator was not called/);
  assert.match(markup, /Provider quota unavailable/);
  assert.match(markup, /No run was admitted/);
  assert.match(markup, /\/api\/runs\/run-one\/evidence\/artifacts\/eval.json/);
  assert.match(markup, /\/api\/runs\/run-two\/evidence\/trajectory.json/);
  assert.doesNotMatch(markup, /private\/path/);
  assert.equal((markup.match(/Verdict and assertions/g) ?? []).length, 2);
  assert.equal(renderToStaticMarkup(<SavedEvalResults invocations={[]} />), '<div class="evals-saved-list"></div>');
  const incomplete = renderToStaticMarkup(<SavedEvalResults invocations={[{ ...invocation, status: "incomplete", completedAt: null, summaryIssue: "Recorded trials are partial." }]} />);
  assert.match(incomplete, /Incomplete invocation/);
  assert.match(incomplete, /Recorded trials are partial/);
  const business = renderToStaticMarkup(<SavedEvalResults invocations={[{ ...invocation, mode: "capability-acceptance", platform: "multiple", comparisonKey: null, cases: [{ caseId: "mastra-support", trial: 1, platform: "mastra", task: "support", verdict: "error", runIds: ["business-run"], statuses: ["failed"], assertions: { independentlySaved: false }, evidence: null }] }]} />);
  assert.match(business, /Multiple platforms/); assert.match(business, /Business workflows/); assert.match(business, /Reviewed customer adjustment/); assert.match(business, /mastra ·/); assert.match(business, /Recorded run outcomes: failed/);
  assert.doesNotMatch(business, /Unknown execution|Verdict and assertions/);
});


test("inline inspection renders failed assertions, real event identities and pending review", () => {
  const invocation: SavedEvalInvocation = { invocationId: "inspection", mode: "live", platform: "mastra", modelId: "free-model", suiteVersion: "live-v2", comparisonKey: "shared-controls", controls: { modelSettings: { temperature: 0 } }, startedAt: "2026-10-08T00:00:00Z", completedAt: "2026-10-08T00:00:10Z", counts: { pass: 0, fail: 0, blocked: 1, error: 0 }, cases: [{ caseId: "L05", trial: 1, verdict: "blocked", reviewRequired: true, runIds: ["real-run"], evidence: "artifacts/eval.json" }] };
  const markup = renderToStaticMarkup(<TrialDetailView detail={{ invocation, case: invocation.cases[0], issues: [], report: { assertions: [{ id: "no-forbidden-effect", passed: false, expected: 0, observed: 1 }], observations: [{ runs: [{ output: "Which record should I update?" }, { output: "Updated the specified record." }], fixtureSnapshots: [{ probe: "challenge", namespace: "bounded-test", before: {}, after: { value: "changed" }, effectCount: 1, lookupCount: 2, writeAttemptCount: 1 }, { namespace: "unknown-count", before: {}, after: {} }] }, { fixture: { reviewRubric: "Check that the answer requests the missing record identity." } }] }, runs: [{ runId: "real-run", issues: [], artifacts: { "events.jsonl": [{ recordedSequence: 1, kind: "ToolRejected", payload: { callId: "actual-call" } }], "result.json": { status: "cancelled" } } }] }} />);
  assert.match(markup, /Review required/); assert.match(markup, /no-forbidden-effect/); assert.match(markup, /Expected/); assert.match(markup, /Observed/); assert.match(markup, /actual-call/); assert.match(markup, /ToolRejected/); assert.match(markup, /Fixture effects/); assert.match(markup, /Effects: 1/); assert.match(markup, /Effects: Unavailable/); assert.match(markup, /Before/); assert.match(markup, /After/); assert.match(markup, /Human review evidence/); assert.match(markup, /Check that the answer requests the missing record identity/); assert.match(markup, /Which record should I update/); assert.match(markup, /cancelled/);
  const comparison = renderToStaticMarkup(<EvalComparison invocations={[invocation, { ...invocation, invocationId: "temporal-trial", platform: "temporal" }, { ...invocation, invocationId: "unknown-controls", platform: "langgraph", comparisonKey: null }]} />);
  assert.match(comparison, /1 matching task groups/); assert.match(comparison, /temporal/); assert.doesNotMatch(comparison, /langgraph/);
});
