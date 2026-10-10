import assert from "node:assert/strict";
import test from "node:test";
import { projectTurnActivity, upsertRunMessages, mergeSessionHistory } from "../src/features/platforms/chatState";
import { canReviewAction, invocationDecision } from "../src/features/platforms/connectedToolState";
import type { InvocationReviewView, RunView } from "../src/features/platforms/platformApi";
const action: InvocationReviewView = { requestId: "request", revision: 2, runId: "first", turnId: "turn-first", call: { toolCallId: "call", name: "unfamiliar_tool", round: 1 }, argumentDigest: "digest", sourceDigest: "source", connectionIdentity: null, displayArguments: { arbitrary: "value" }, createdAt: "2026-10-10T00:00:00Z", expiresAt: "2030-01-01T00:00:00Z", status: "approved" };
function run(id: string): RunView { return { runId: id, status: "completed", manifest: { platform: "temporal", variant: "baseline", task: { prompt: id }, model: { provider: "openrouter", model: "fixture" } }, events: [], executionReference: null, result: null, context: null, projection: { state: "current", observedAt: "2026-10-10T00:00:00Z", reason: null } }; }
test("two runs retain separate assistant messages and reviews belong to their original run", () => {
  const first = run("first"), second = run("second");
  const messages = upsertRunMessages(upsertRunMessages([], first), second);
  assert.deepEqual(messages.map(item => [item.runId, item.role]), [["first", "user"], ["first", "assistant"], ["second", "user"], ["second", "assistant"]]);
  assert.equal(projectTurnActivity(first, [action]).length, 1);
  assert.equal(projectTurnActivity(second, [action]).length, 0);
  assert.equal(canReviewAction(action), false, "terminal decisions cannot be newly approved");
});
test("multiple calls follow recorded event order and include results after their own reviews", () => {
  const first = run("first");
  const events = ["other", "call", "call"].map((id, index) => ({ eventId: `${index}`, recordedSequence: index + 1, source: "fixture", sourceSequence: index + 1, kind: index === 2 ? "ToolExecutionCompleted" : "ToolExecutionStarted", runId: "first", occurredAt: action.createdAt, payload: { toolCallId: id } }));
  const projected = projectTurnActivity({ ...first, events: [...events].reverse() }, [action, { ...action, requestId: "other-request", call: { ...action.call, toolCallId: "other" } }]);
  assert.deepEqual(projected.map(item => item.kind === "review" ? item.action.call.toolCallId : item.event.eventId), ["other", "0", "call", "1", "2"]);
});
test("a retained decision can be submitted twice without changing revision, digest or identity", () => {
  const pending = { ...action, status: "pending" as const };
  const decision = invocationDecision(pending, "denied", "stable-decision");
  assert.deepEqual(invocationDecision(pending, "denied", decision.decisionId), decision);
  assert.equal(decision.revision, 2);
  assert.equal(decision.argumentDigest, "digest");
  assert.equal(canReviewAction({ ...pending, expiresAt: "2020-01-01T00:00:00Z" }), false);
});

test("session hydration reconciles an admission placeholder without duplicate messages", () => {
  const recorded = { ...run("first"), manifest: { ...run("first").manifest, context: { clientTurnId: "client" } } };
  const current = [{ id: "user", role: "user" as const, content: "first", status: "completed" as const, clientTurnId: "client" }, { id: "assistant", role: "assistant" as const, content: "", status: "pending" as const, clientTurnId: "client" }];
  const merged = mergeSessionHistory(current, [recorded]);
  assert.deepEqual(merged.map(message => message.id), ["user", "assistant"]);
  assert.equal(merged[0]?.runId, "first");
});
