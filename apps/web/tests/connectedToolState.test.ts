import assert from "node:assert/strict";
import test from "node:test";
import { canReviewAction, defaultBusinessProfile, invocationDecision, requiresUpfrontApproval } from "../src/features/platforms/connectedToolState";
import type { CapabilityProfile, InvocationReviewView } from "../src/features/platforms/platformApi";

const capability: CapabilityProfile["capabilities"][number] = { id: "assign", version: "1.0.0", kind: "tool", displayName: "Assign", description: "Assign a record", risk: "write", operations: ["execute"] };
const action: InvocationReviewView = { requestId: "action-one", revision: 3, runId: "run-one", turnId: "turn-one", call: { toolCallId: "call-one", name: "assign", round: 1 }, argumentDigest: "current-arguments", sourceDigest: "source", connectionIdentity: "account", displayArguments: { owner: "Morgan" }, createdAt: "2026-10-08T00:00:00Z", expiresAt: "2026-10-08T00:15:00Z", status: "pending" };

test("invocation policy skips blanket approval and exact action review retains revision and argument identity", () => {
  assert.equal(requiresUpfrontApproval(capability), true);
  assert.equal(requiresUpfrontApproval({ ...capability, approvalMode: "tool_grant" }), true);
  assert.equal(requiresUpfrontApproval({ ...capability, approvalMode: "invocation" }), false);
  assert.equal(requiresUpfrontApproval({ ...capability, approvalMode: "automatic" }), false);
  assert.equal(canReviewAction(action, Date.parse("2026-10-08T00:10:00Z")), true);
  assert.equal(canReviewAction(action, Date.parse(action.expiresAt)), false);
  assert.equal(canReviewAction({ ...action, status: "cancelled" }, Date.parse(action.createdAt)), false);
  assert.deepEqual(invocationDecision(action, "approved", "stable-decision-id"), { requestId: "action-one", revision: 3, argumentDigest: "current-arguments", decisionId: "stable-decision-id", decision: "approved", reason: "Action approved from Chat." });
  for (const platform of ["mastra", "langgraph", "temporal", "restate"]) assert.equal(defaultBusinessProfile(platform, "baseline"), "business-agent");
  assert.equal(defaultBusinessProfile("mastra", "workflow"), "local-safe"); assert.equal(defaultBusinessProfile("inngest", "baseline"), "local-safe");
});
