import type { RunView } from "./platformApi";

export interface SafeFailureCause {
  readonly phase: string;
  readonly code: string;
  readonly category: string;
}
export interface FailureExplanation {
  readonly chain: readonly SafeFailureCause[];
  readonly guidance: string;
}
const nativeStatuses = new Set(["created", "pending", "queued", "running", "suspended", "completed", "failed", "cancelled", "succeeded", "terminated", "backing-off", "ready"]);

/** Derived inspection only. Known adapter codes explain their recorded boundary;
 * arbitrary exception messages, nested causes, payloads and local paths are excluded.
 * Native completion is separate from a failed agent result or an uncertain effect.
 */
export function failureExplanation(run: RunView): FailureExplanation | null {
  const error = run.result?.error;
  if (!error) return null;
  const native = run.executionReference?.native?.nativeStatus;
  const chain: SafeFailureCause[] = [{ phase: "Native execution", code: "NATIVE_EXECUTION", category: typeof native === "string" && nativeStatuses.has(native) ? native : "unreported" }];
  if (["OPENROUTER_RATE_LIMITED", "OPENROUTER_HTTP_429"].includes(error.code)) {
    chain.push({ phase: "Model request", code: "MODEL_REQUEST_FAILED", category: "provider" }, { phase: "Provider response", code: error.code, category: "provider" });
    return { chain, guidance: "The model provider rejected the request with HTTP 429. Wait for provider capacity before starting a new run. Earlier confirmed tool effects remain recorded." };
  }
  if (error.code === "ACTION_REVIEW_PREPARATION_FAILED") {
    chain.push({ phase: "Action review", code: error.code, category: "pre_dispatch" }, { phase: "Capability host / review policy", code: "REVIEW_PREPARATION_UNAVAILABLE", category: "pre_dispatch" });
    return { chain, guidance: "The action review could not be prepared. This call was not dispatched. Check the capability host connection and review policy before trying again." };
  }
  if (["OPENROUTER_TRANSPORT_ERROR", "OPENROUTER_TIMEOUT", "MODEL_ACTIVITY_HEARTBEAT_LOST"].includes(error.code)) {
    chain.push({ phase: "Model request", code: "MODEL_REQUEST_UNCONFIRMED", category: "outcome_unknown" }, { phase: "Provider response", code: error.code, category: "outcome_unknown" });
    return { chain, guidance: "The dispatched model request has no confirmed response. Inspect native execution and provider request evidence before starting another request." };
  }
  if (["TOOL_UNKNOWN", "TOOL_OUTCOME_UNKNOWN", "TOOL_ACTIVITY_FAILED", "CAPABILITY_OUTCOME_UNKNOWN"].includes(error.code)) {
    chain.push({ phase: "Tool execution", code: "TOOL_DISPATCH_UNCONFIRMED", category: "outcome_unknown" }, { phase: "Tool acknowledgement", code: error.code, category: "outcome_unknown" });
    return { chain, guidance: "The tool response requires reconciliation. Inspect its retained receipt and provider state before repeating the action. Confirmed effects remain recorded separately. A stopped run does not roll back a dispatched call." };
  }
  chain.push({ phase: "Failure", code: "UNCLASSIFIED_FAILURE", category: "unknown" });
  return { chain, guidance: "The adapter did not retain a classified cause. Inspect the run's recorded evidence. Do not infer provider effects from the native run status." };
}
