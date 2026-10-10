import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvocationReviewPanel } from "../src/features/platforms/InvocationReviewPanel";
import type { InvocationReviewView, RunView } from "../src/features/platforms/platformApi";
const action: InvocationReviewView = { requestId: "request", revision: 1, runId: "run", turnId: "turn", call: { toolCallId: "call", name: "unfamiliar_tool", round: 1 }, argumentDigest: "digest", sourceDigest: "source", connectionIdentity: null, displayArguments: { record_key: "safe-record" }, createdAt: "2026-10-10T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z", status: "pending" };
const run: RunView = { runId: "run", status: "suspended", manifest: { platform: "temporal", variant: "baseline", task: { prompt: "test" }, model: { provider: "openrouter", model: "fixture" } }, events: [], executionReference: null, result: null, context: null, projection: { state: "current", observedAt: "2026-10-10T00:00:00Z", reason: null } };
function render(value: InvocationReviewView) { return renderToStaticMarkup(createElement(InvocationReviewPanel, { run, action: value, evidenceUrl: "/api/runs/run/receipt/call", busy: false, now: Date.parse("2026-10-10T00:00:00Z"), onSubmit: () => { throw new Error("Rendering must never submit a decision."); } })); }
test("older review cards retain raw callable and argument names", () => {
  const html = render(action);
  assert.match(html, /<strong>unfamiliar_tool<\/strong>/);
  assert.match(html, /<dt>record_key<\/dt>/);
  assert.match(html, /Approve action/);
});
test("optional presentation renders explicit labels and source metadata as escaped text", () => {
  const html = render({ ...action, presentation: { displayName: "Adjust record", description: "<script>untrusted metadata</script>", source: { id: "fixture:records", version: "2.0" }, risk: "write", argumentLabels: { record_key: "Record identifier" } } });
  assert.match(html, /<strong>Adjust record<\/strong>/);
  assert.match(html, /<dt>Record identifier<\/dt>/);
  assert.match(html, /<details class="chat-activity"><summary>Details<\/summary>/);
  assert.match(html, /<details[^>]*>.*fixture:records.*version 2.0.*Inspect action evidence.*<\/details>/);
  assert.match(html, /write action/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Action review: unfamiliar_tool/);
});
