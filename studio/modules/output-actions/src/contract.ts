import type { JsonValue, ModuleCancellation, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";

export interface OutputActionRequest {
  readonly actionId: string;
  readonly kind: string;
  readonly payload: JsonValue;
}

/** Preparation validates and describes an action; it does not deliver it. */
export interface OutputActionProposal {
  readonly actionId: string;
  readonly kind: string;
  readonly payload: JsonValue;
  readonly status: "proposed";
  readonly summary: string;
  readonly evidence?: JsonValue;
}

export type OutputActionReceipt =
  | { readonly actionId: string; readonly status: "committed"; readonly receipt: JsonValue }
  | { readonly actionId: string; readonly status: "rejected"; readonly reason: string }
  | { readonly actionId: string; readonly status: "uncertain"; readonly reason: string; readonly receipt?: JsonValue };

export interface OutputActionsModule {
  readonly identity: ModuleIdentity;
  prepare(input: { readonly scope: RunScope; readonly action: OutputActionRequest }, signal: ModuleCancellation): Promise<OutputActionProposal>;
  deliver(input: {
    readonly scope: RunScope;
    readonly proposal: OutputActionProposal;
    readonly idempotencyKey?: string;
  }, signal: ModuleCancellation): Promise<OutputActionReceipt>;
}
