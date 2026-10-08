import type { CapabilityProfile, InvocationDecision, InvocationReviewView } from "./platformApi";

export function requiresUpfrontApproval(capability: CapabilityProfile["capabilities"][number]): boolean {
  return (capability.risk === "write" || capability.risk === "external") && (capability.approvalMode === undefined || capability.approvalMode === "tool_grant");
}
export function canReviewAction(action: InvocationReviewView, now = Date.now()): boolean {
  return action.status === "pending" && new Date(action.expiresAt).getTime() > now;
}
export function invocationDecision(action: InvocationReviewView, decision: InvocationDecision["decision"], decisionId: string): InvocationDecision {
  return { requestId: action.requestId, revision: action.revision, argumentDigest: action.argumentDigest, decisionId, decision, reason: decision === "denied" ? "Action denied from Chat." : "Action approved from Chat." };
}
export function defaultBusinessProfile(platform: string, variant: string): string {
  return variant === "baseline" && ["mastra", "langgraph", "temporal", "restate"].includes(platform) ? "business-agent" : "local-safe";
}
