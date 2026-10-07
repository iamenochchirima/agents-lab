import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SavedEvalResults } from "../src/features/evals/EvalResults";
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
});
