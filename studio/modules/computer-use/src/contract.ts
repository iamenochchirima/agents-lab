import type { JsonValue, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import type { ComputerUseConfig } from "./config.js";

export type ComputerObservationKind = "accessibility-tree" | "dom" | "screenshot-reference";
export type ComputerActionKind = "click" | "type" | "keypress" | "scroll" | "navigate";
export type ComputerOperationStatus = "completed" | "failed" | "cancelled" | "timed-out" | "unknown";

export interface ComputerObservation {
  readonly observationId: string;
  readonly kind: ComputerObservationKind;
  readonly capturedAt: string;
  /** Large screenshot bytes remain in the environment and are referenced by ID. */
  readonly content: JsonValue;
}

export interface ComputerAction {
  readonly actionId: string;
  readonly kind: ComputerActionKind;
  readonly target?: string;
  readonly value?: string;
  readonly parameters?: JsonValue;
}

export interface ComputerActionReceipt {
  readonly status: ComputerOperationStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly detail: string | null;
}

export interface ComputerVerification {
  readonly status: "verified" | "not-verified" | "failed";
  readonly evidence: string;
}

export interface ComputerActionResult {
  readonly action: ComputerAction;
  readonly receipt: ComputerActionReceipt;
  readonly before: ComputerObservation;
  readonly after: ComputerObservation | null;
  readonly verification: ComputerVerification;
}

/** Scoped host capability. It performs environment operations but does not choose actions. */
export interface ComputerEnvironmentCapability {
  observe(input: { readonly scope: RunScope }, signal: AbortSignal): Promise<ComputerObservation>;
  perform(input: { readonly scope: RunScope; readonly action: ComputerAction }, signal: AbortSignal): Promise<ComputerActionReceipt>;
}

export interface ComputerUseModule {
  readonly identity: ModuleIdentity;
  observe(scope: RunScope, signal: AbortSignal): Promise<ComputerObservation>;
  act(action: ComputerAction, scope: RunScope, signal: AbortSignal): Promise<ComputerActionResult>;
}

export interface ComputerUseDependencies {
  readonly environment: ComputerEnvironmentCapability;
  /** Implementation-specific state comparison; it must report insufficient evidence honestly. */
  readonly verify: (input: { readonly action: ComputerAction; readonly before: ComputerObservation; readonly after: ComputerObservation | null }) => ComputerVerification;
}

export type ComputerUseFactory = (config: ComputerUseConfig, dependencies: ComputerUseDependencies) => ComputerUseModule;

export type ComputerUseErrorCode = "COMPUTER_USE_CANCELLED" | "ENVIRONMENT_UNAVAILABLE" | "COMPUTER_ACTION_FAILED" | "COMPUTER_OUTCOME_UNKNOWN";

export class ComputerUseError extends Error {
  constructor(readonly code: ComputerUseErrorCode, message: string) {
    super(message);
    this.name = "ComputerUseError";
  }
}
