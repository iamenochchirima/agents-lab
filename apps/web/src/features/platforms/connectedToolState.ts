import type { CapabilityProfile, InvocationDecision, InvocationReviewView, RunStatus } from "./platformApi";

/** A terminal run stops unfinished activity without inventing a tool outcome or side-effect guarantee. */
export function toolActivityState(eventKind: string, runStatus?: RunStatus): "completed" | "unknown" | "failed" | "active" {
  if (eventKind === "ToolExecutionCompleted") return "completed";
  if (eventKind === "ToolExecutionUnknown") return "unknown";
  if (["ToolExecutionFailed", "ToolExecutionCancelled", "ToolPolicyDenied", "ToolCallRejected"].includes(eventKind)) return "failed";
  if (runStatus === "reconciliation_required") return "unknown";
  if (runStatus === "failed" || runStatus === "cancelled" || runStatus === "completed") return "failed";
  return "active";
}

export function requiresUpfrontApproval(capability: CapabilityProfile["capabilities"][number]): boolean {
  return (capability.risk === "write" || capability.risk === "external") && (capability.approvalMode === undefined || capability.approvalMode === "tool_grant");
}
export function canReviewAction(action: InvocationReviewView, now = Date.now()): boolean {
  return action.status === "pending" && new Date(action.expiresAt).getTime() > now;
}
export function invocationDecision(action: InvocationReviewView, decision: InvocationDecision["decision"], decisionId: string): InvocationDecision {
  return { requestId: action.requestId, revision: action.revision, argumentDigest: action.argumentDigest, decisionId, decision, reason: decision === "denied" ? "Action denied from Chat." : "Action approved from Chat." };
}
/** New platform chats implicitly use the shared connected-tools profile. */
export function defaultCapabilityProfile(_platform: string, _variant: string): string {
  return "connected-agent";
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
