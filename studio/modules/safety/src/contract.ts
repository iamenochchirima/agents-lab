import type { CapabilityDescriptor, JsonValue, ModuleCancellation, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import type { SafetyDecisionKind } from "./config.js";

export type SafetyCheckpointKind = "tool-call" | "environment-operation" | "output-action" | "memory-write";

export interface SafetyCheckpoint {
  readonly checkpointId: string;
  readonly kind: SafetyCheckpointKind;
  readonly action: JsonValue;
  readonly capability?: CapabilityDescriptor;
  readonly evidence?: JsonValue;
}

export interface SafetyDecision {
  readonly checkpointId: string;
  readonly decisionId: string;
  readonly decision: SafetyDecisionKind;
  readonly reasonCode: string;
  readonly explanation: string;
  readonly approvalRequest?: { readonly requiredOperations: readonly string[]; readonly expiresAt?: string };
}

export type SafetyEvaluation =
  | { readonly status: "evaluated"; readonly decision: SafetyDecision }
  | { readonly status: "unavailable"; readonly checkpointId: string; readonly code: string; readonly message: string };

/** Evaluates proposed actions. It never dispatches, commits, or approves them. */
export interface SafetyModule {
  readonly identity: ModuleIdentity;
  evaluate(input: { readonly scope: RunScope; readonly checkpoint: SafetyCheckpoint }, signal: ModuleCancellation): Promise<SafetyEvaluation>;
}
