import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { failureExplanation } from "../src/features/platforms/failureExplanation";
import { RunFailureDetails } from "../src/features/platforms/RunFailureDetails";
import type { RunView } from "../src/features/platforms/platformApi";
function failedRun(code: string, kind: string): RunView {
  return { runId: "run", status: "failed", manifest: { platform: "vercel-workflows", variant: "baseline", task: { prompt: "private user content" }, model: { provider: "openrouter", model: "fixture" } }, events: [], executionReference: { platform: "vercel-workflows", variant: "baseline", executionId: "fixture-native", native: { nativeStatus: "completed", privateConfiguration: "secret-settings" } }, result: { runId: "run", status: "failed", finishedAt: "2026-10-10T00:00:00Z", attemptCount: 1, usage: { inputTokens: null, outputTokens: null, totalTokens: null }, output: null, error: { code, message: "Bearer fictional-token /private/credentials private response body", failureKind: kind, retryable: false } }, context: null, projection: { state: "current", observedAt: "2026-10-10T00:00:00Z", reason: null } };
}
test("known HTTP 429 retains native completion separately from model/provider failure", () => {
  const run = failedRun("OPENROUTER_RATE_LIMITED", "provider");
  const view = failureExplanation(run)!;
  assert.deepEqual(view.chain.map(cause => [cause.phase, cause.category, cause.code]), [["Native execution", "completed", "NATIVE_EXECUTION"], ["Model request", "provider", "MODEL_REQUEST_FAILED"], ["Provider response", "provider", "OPENROUTER_RATE_LIMITED"]]);
  assert.match(view.guidance, /Wait for provider capacity/);
  assert.equal(run.executionReference!.native!.nativeStatus, "completed");
  assert.equal(run.result!.status, "failed");
});
test("review preparation explains the pre-dispatch boundary without inventing a host cause", () => {
  const view = failureExplanation(failedRun("ACTION_REVIEW_PREPARATION_FAILED", "pre_dispatch"))!;
  assert.equal(view.chain[1]!.category, "pre_dispatch");
  assert.equal(view.chain[2]!.phase, "Capability host / review policy");
  assert.match(view.guidance, /This call was not dispatched/);
  assert.match(view.guidance, /Check the capability host connection and review policy/);
});
test("unresolved dispatch asks for receipt inspection rather than another mutation", () => {
  const view = failureExplanation(failedRun("TOOL_OUTCOME_UNKNOWN", "outcome_unknown"))!;
  assert.equal(view.chain[2]!.category, "outcome_unknown");
  assert.match(view.guidance, /retained receipt and provider state before repeating/);
  assert.match(failureExplanation(failedRun("OPENROUTER_TRANSPORT_ERROR", "outcome_unknown"))!.guidance, /no confirmed response/);
});
test("static presentation excludes exception bodies, secrets, arbitrary cause codes and private native status", () => {
  for (const code of ["OPENROUTER_RATE_LIMITED", "ACTION_REVIEW_PREPARATION_FAILED", "TOOL_OUTCOME_UNKNOWN", "fictional-token /private/credentials"]) {
    const run = failedRun(code, "provider");
    if (code.includes("fictional-token")) run.executionReference!.native!.nativeStatus = "Bearer fictional-token";
    const html = renderToStaticMarkup(createElement(RunFailureDetails, { run }));
    assert.doesNotMatch(html, /fictional-token|private\/credentials|private response body|private user content|secret-settings/);
    assert.match(html, /Failure details/);
  }
  assert.equal(failureExplanation({ ...failedRun("UNKNOWN", "internal"), result: null }), null);
});
