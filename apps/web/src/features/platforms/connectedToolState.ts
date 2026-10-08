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


/** Historical events without effect metadata stay unspecified; tool success alone is not business confirmation. */
export function toolOutcomeView(payload: Readonly<Record<string, unknown>>, eventKind: string): {
  readonly label: string | null; readonly presentation: string | null; readonly evidence: string | null; readonly uncertain: boolean;
} {
  const effect = payload.effect && typeof payload.effect === "object" && !Array.isArray(payload.effect) ? payload.effect as Record<string, unknown> : null;
  const labels: Record<string, string> = { not_dispatched: "Not dispatched", none: "No mutation", rejected: "Rejected · No change", acknowledged: "Acknowledged", confirmed: "Effect confirmed", unknown: "Uncertain · Needs reconciliation" };
  const state = typeof effect?.state === "string" ? effect.state : null;
  const uncertain = state === "unknown" || eventKind === "ToolExecutionUnknown";
  const invalidAcknowledgement = state === "acknowledged" && payload.presentation === "invalid";
  return {
    label: invalidAcknowledgement ? "Acknowledged · Invalid result" : state && labels[state] ? labels[state] : uncertain ? labels.unknown! : null,
    presentation: payload.presentation === "invalid" ? "Result schema invalid" : payload.presentation === "valid" ? "Result schema valid" : null,
    evidence: typeof effect?.evidence === "string" ? effect.evidence : null,
    uncertain,
  };
}
