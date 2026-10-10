import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvocationReviewPanel } from "../src/features/platforms/InvocationReviewPanel";
import type { InvocationReviewView, RunView } from "../src/features/platforms/platformApi";
const action: InvocationReviewView = { requestId: "request", revision: 1, runId: "run", turnId: "turn", call: { toolCallId: "call", name: "unfamiliar_tool", round: 1 }, argumentDigest: "digest", sourceDigest: "source", connectionIdentity: null, displayArguments: { record_key: "safe-record" }, createdAt: "2026-10-10T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z", status: "pending" };
const run: RunView = { runId: "run", status: "suspended", manifest: { platform: "temporal", variant: "baseline", task: { prompt: "test" }, model: { provider: "openrouter", model: "fixture" } }, events: [], executionReference: null, result: null, context: null, projection: { state: "current", observedAt: "2026-10-10T00:00:00Z", reason: null } };
function render(value: InvocationReviewView, recordedRun: RunView = run) { return renderToStaticMarkup(createElement(InvocationReviewPanel, { run: recordedRun, action: value, evidenceUrl: "/api/runs/run/receipt/call", busy: false, now: Date.parse("2026-10-10T00:00:00Z"), onSubmit: () => { throw new Error("Rendering must never submit a decision."); } })); }
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

function toolEvent(callId: string, kind: string, sequence: number) { return { eventId: `${sequence}`, recordedSequence: sequence, source: "fixture", sourceSequence: sequence, kind, runId: "run", occurredAt: "2026-10-10T00:00:00Z", payload: { toolCallId: callId } }; }
test("a later unknown call does not relabel completed or denied actions", () => {
  const recordedRun = { ...run, status: "reconciliation_required" as const, events: [toolEvent("call", "ToolExecutionCompleted", 1), toolEvent("later", "ToolExecutionUnknown", 2)] };
  const completed = render({ ...action, status: "completed" }, recordedRun);
  assert.match(completed, /role="status">Completed<\/span>/);
  assert.doesNotMatch(completed, /Outcome unknown|Running/);
  const denied = render({ ...action, call: { ...action.call, toolCallId: "denied" }, status: "denied" }, recordedRun);
  assert.match(denied, /role="status">Denied<\/span>/);
  assert.doesNotMatch(denied, /Outcome unknown/);
  const deniedWithEffect = render({ ...action, status: "denied" }, { ...recordedRun, events: [{ ...toolEvent("call", "ToolPolicyDenied", 1), payload: { toolCallId: "call", effect: { state: "not_dispatched" } } }] });
  assert.match(deniedWithEffect, /role="status">Denied<\/span>/);
  const unknown = render({ ...action, call: { ...action.call, toolCallId: "later" }, status: "completed" }, recordedRun);
  assert.match(unknown, /role="status">Outcome unknown<\/span>/);
});
test("terminal unfinished calls stop without implying rollback or offering decisions", () => {
  for (const status of ["failed", "cancelled"] as const) {
    const html = render({ ...action, status: "dispatching" }, { ...run, status, events: [toolEvent("call", "ToolExecutionStarted", 1)] });
    assert.match(html, /role="status">Stopped<\/span>/);
    assert.match(html, /does not establish whether a dispatched action changed provider state/);
    assert.doesNotMatch(html, /Running|Approve action|Continue reviewed action/);
  }
  const uncertain = render({ ...action, status: "dispatching" }, { ...run, status: "reconciliation_required", events: [] });
  assert.match(uncertain, /role="status">Outcome unknown<\/span>/);
});

test("review separates native failure, invalid response and confirmed provider effect", () => {
  const event = { ...toolEvent("call", "ToolExecutionUnknown", 1), payload: { toolCallId: "call", effect: { state: "confirmed", evidence: "Independent provider read" }, presentation: "invalid" } };
  const html = render({ ...action, status: "completed" }, { ...run, status: "reconciliation_required", events: [event] });
  assert.match(html, /role="status">Effect confirmed<\/span>/);
  assert.match(html, /Response: Result schema invalid/);
  assert.doesNotMatch(html, /Outcome unknown|does not roll back|Approve action/);
});
