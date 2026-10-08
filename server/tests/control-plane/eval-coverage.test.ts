import assert from "node:assert/strict";
import test from "node:test";
import { projectEvalCoverage } from "../../src/control-plane/application/eval-coverage.js";
import type { EvalResultInvocation } from "../../src/control-plane/application/eval-results.js";

test("coverage requires exact variant, retains review and reports unexercised requirements", () => {
  const invocation: EvalResultInvocation = { invocationId: "proof", platform: "langgraph", variant: "baseline", mode: "live", modelId: "synthetic", startedAt: "2026-10-08T00:00:00Z", completedAt: "2026-10-08T00:01:00Z", status: "complete", counts: {pass: 0, fail: 0, blocked: 1, error: 0}, cases: [{caseId: "L05", trial: 1, verdict: "blocked", reviewRequired: true, runIds: ["one"], evidence: "artifacts/eval.json"}] };
  const cell = (result: ReturnType<typeof projectEvalCoverage>, id: string) => result.cells.find(item => item.platform === "langgraph" && item.requirementId === id)!;
  assert.equal(cell(projectEvalCoverage([invocation]), "M03").measurement, "review-required");
  assert.equal(cell(projectEvalCoverage([{...invocation, variant: undefined}]), "M03").measurement, "not-exercised");
  assert.equal(cell(projectEvalCoverage([invocation]), "M02").measurement, "not-exercised");
  assert.equal(cell(projectEvalCoverage([invocation]), "X03").measurement, "not-applicable");
  assert.equal(projectEvalCoverage([], true).scanTruncated, true);
});
