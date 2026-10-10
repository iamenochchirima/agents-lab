import assert from "node:assert/strict";
import test from "node:test";
import { canReviewAction, defaultCapabilityProfile, invocationDecision, memoryMutationNotice, requiresUpfrontApproval, toolActivityState, toolOutcomeView } from "../src/features/platforms/connectedToolState";
import type { CapabilityProfile, InvocationReviewView } from "../src/features/platforms/platformApi";

const capability: CapabilityProfile["capabilities"][number] = { id: "assign", version: "1.0.0", kind: "tool", displayName: "Assign", description: "Assign a record", risk: "write", operations: ["execute"] };
const action: InvocationReviewView = { requestId: "action-one", revision: 3, runId: "run-one", turnId: "turn-one", call: { toolCallId: "call-one", name: "assign", round: 1 }, argumentDigest: "current-arguments", sourceDigest: "source", connectionIdentity: "account", displayArguments: { owner: "Morgan" }, createdAt: "2026-10-08T00:00:00Z", expiresAt: "2026-10-08T00:15:00Z", status: "pending" };

test("unfinished tool activity stops when its run ends without a tool outcome", () => {
  for (const kind of ["ToolCallRequested", "ToolExecutionStarted"]) {
    assert.equal(toolActivityState(kind, "running"), "active");
    for (const status of ["failed", "cancelled", "completed"] as const) {
      assert.equal(toolActivityState(kind, status), "failed");
    }
    assert.equal(toolActivityState(kind, "reconciliation_required"), "unknown");
  }
});

test("run failure preserves recorded tool completion and uncertain effects", () => {
  assert.equal(toolActivityState("ToolExecutionCompleted", "failed"), "completed");
  assert.equal(toolActivityState("ToolExecutionUnknown", "failed"), "unknown");
  assert.equal(toolActivityState("ToolExecutionFailed", "running"), "failed");
});

test("invocation policy skips blanket approval and exact action review retains revision and argument identity", () => {
  assert.equal(requiresUpfrontApproval(capability), true);
  assert.equal(requiresUpfrontApproval({ ...capability, approvalMode: "tool_grant" }), true);
  assert.equal(requiresUpfrontApproval({ ...capability, approvalMode: "invocation" }), false);
  assert.equal(requiresUpfrontApproval({ ...capability, approvalMode: "automatic" }), false);
  assert.equal(canReviewAction(action, Date.parse("2026-10-08T00:10:00Z")), true);
  assert.equal(canReviewAction(action, Date.parse(action.expiresAt)), false);
  assert.equal(canReviewAction({ ...action, status: "cancelled" }, Date.parse(action.createdAt)), false);
  assert.deepEqual(invocationDecision(action, "approved", "stable-decision-id"), { requestId: "action-one", revision: 3, argumentDigest: "current-arguments", decisionId: "stable-decision-id", decision: "approved", reason: "Action approved from Chat." });
  for (const platform of ["mastra", "langgraph", "temporal", "restate"]) assert.equal(defaultCapabilityProfile(platform, "baseline"), "connected-agent");
  assert.equal(defaultCapabilityProfile("mastra", "workflow"), "connected-agent"); assert.equal(defaultCapabilityProfile("inngest", "baseline"), "connected-agent");
});


test("tool outcomes distinguish rejection, invalid acknowledgement and uncertainty without inferring legacy effects", () => {
  assert.equal(toolOutcomeView({ effect: { state: "rejected", evidence: "Provider rejected mutation" }, presentation: "not_declared" }, "ToolExecutionFailed").label, "Rejected · No change");
  const invalid = toolOutcomeView({ effect: { state: "acknowledged", evidence: "HTTP 200" }, presentation: "invalid" }, "ToolExecutionUnknown");
  assert.equal(invalid.label, "Acknowledged · Invalid result"); assert.equal(invalid.presentation, "Result schema invalid"); assert.equal(invalid.uncertain, true);
  assert.equal(toolOutcomeView({ effect: { state: "unknown" } }, "ToolExecutionUnknown").label, "Uncertain · Needs reconciliation");
  assert.equal(toolOutcomeView({}, "ToolExecutionCompleted").label, null);
  assert.equal(toolOutcomeView({ effect: { state: "acknowledged" }, presentation: "valid" }, "ToolExecutionCompleted").label, "Acknowledged");
  assert.equal(toolOutcomeView({ effect: { state: "confirmed" }, presentation: "invalid" }, "ToolExecutionUnknown").label, "Effect confirmed");
});

test("invalid presentation and native unknown status do not erase confirmed effects", () => {
  const view = toolOutcomeView({ effect: { state: "confirmed", evidence: "Independent provider read" }, presentation: "invalid" }, "ToolExecutionUnknown");
  assert.equal(view.label, "Effect confirmed");
  assert.equal(view.presentation, "Result schema invalid");
  assert.equal(view.uncertain, false);
  assert.equal(toolOutcomeView({ effect: { state: "unknown" }, presentation: "valid" }, "ToolExecutionCompleted").uncertain, true);
});

test("memory notices distinguish completed writes from proposed, failed and uncertain writes", () => {
  const payload = { toolName: "memory_save", status: "completed" };
  assert.equal(memoryMutationNotice(payload, "ToolExecutionCompleted"), "Memory saved");
  for (const kind of ["ToolCallRequested", "ToolExecutionStarted", "ToolExecutionUnknown", "ToolExecutionFailed"]) assert.equal(memoryMutationNotice(payload, kind), null);
  assert.equal(memoryMutationNotice({ ...payload, presentation: "invalid" }, "ToolExecutionCompleted"), null);
  assert.equal(memoryMutationNotice({ ...payload, status: "failed" }, "ToolExecutionCompleted"), null);
  assert.match(memoryMutationNotice({ toolName: "memory_forget" }, "ToolExecutionCompleted")!, /earlier chat history is retained/);
});
