import type { JsonValue, ModuleCancellation, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import type { OutputActionsConfig } from "./config.js";

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

/** Host-owned destination for a prepared output. The module does not choose a sink. */
export interface OutputActionSink {
  deliver(input: {
    readonly scope: RunScope;
    readonly proposal: OutputActionProposal;
    readonly idempotencyKey?: string;
  }, signal: ModuleCancellation): Promise<OutputActionReceipt>;
}

export interface OutputActionsDependencies {
  readonly sink: OutputActionSink;
}

export type OutputActionsFactory = (config: OutputActionsConfig, dependencies: OutputActionsDependencies) => OutputActionsModule;

export type OutputActionsErrorCode =
  | "INVALID_OUTPUT_ACTION_INPUT"
  | "OUTPUT_ACTION_TOO_LARGE"
  | "OUTPUT_ACTION_CANCELLED";

export class OutputActionsError extends Error {
  constructor(readonly code: OutputActionsErrorCode, message: string) {
    super(message);
    this.name = "OutputActionsError";
  }
}
