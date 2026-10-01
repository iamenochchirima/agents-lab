/**
 * Model-neutral contracts for a controlled computer environment.
 *
 * Browser and native desktop backends implement this boundary separately. The
 * model never receives a driver object and cannot choose a driver method or a
 * raw selector/coordinate outside the action produced by the environment.
 */
import type { ComputerTaskApprovalDecision, ComputerTaskApprovalRequest, ComputerTaskGrantState, ComputerTaskSpec } from "./task.js";
import type { ComputerVerificationSpec } from "./verification.js";

export type ComputerEnvironmentKind = "browser" | "ubuntu-x11-cua";

/** Bounded, content-free proof of the Cua contract admitted for one runtime. */
export interface ComputerRuntimeEvidence {
  readonly provider: "cua";
  readonly schemaVersion: string;
  /** Installed TypeScript package and Rust runtime identities are diagnostic evidence. */
  readonly packageVersion?: string;
  readonly driverVersion?: string;
  readonly contractVersion?: string;
  readonly capabilityVersion?: string;
  readonly capabilityFingerprint: string;
  readonly requiredOperations: readonly string[];
  /** Native visual-region support is optional and must be proven by both Cua operations. */
  readonly visualRegionCapability?: "available" | "unavailable";
}

/** Content-free identity returned by the TypeSafe readiness contract. */
export interface TypeSafeModelEvidence {
  readonly requestedModel: string;
  readonly resolvedModel: string;
}

/** A model confidence signal is a safety gate, never an approval decision. */
export const MIN_COMPUTER_CONFIDENCE = 0.5;

export type ComputerNativeOperation = "click" | "move" | "type" | "press" | "scroll" | "drag" | "wait";

export type ComputerScrollDirection = "up" | "down" | "left" | "right";

export interface ComputerEnvironmentReadiness {
  readonly kind: ComputerEnvironmentKind;
  readonly available: boolean;
  readonly display?: string;
  readonly isolated: boolean;
  readonly reason?: string;
}

export interface ComputerEnvironmentObservation {
  readonly observationId: string;
  readonly environment: ComputerEnvironmentKind;
  readonly sessionId: string;
  readonly generation: number;
  readonly text: string;
  readonly structuredJson?: string;
  readonly imageCount: number;
  readonly imageBytes: number;
  readonly display?: string;
  readonly screenWidth?: number;
  readonly screenHeight?: number;
  readonly scaleFactor?: number;
  readonly cursorX?: number;
  readonly cursorY?: number;
  /** The exact X11 window used for accessibility-backed native actions. */
  readonly windowPid?: number;
  readonly windowId?: string;
  readonly windowSnapshotId?: string;
  readonly screenshotPath?: string;
}

export type ComputerActionPosition =
  | { readonly kind: "coordinates"; readonly x: number; readonly y: number }
  | { readonly kind: "element"; readonly token: string };

export interface ComputerEnvironmentAction {
  readonly actionId: string;
  readonly operation: ComputerNativeOperation;
  readonly observationId: string;
  readonly generation: number;
  /** Immutable observation facts the host adapter must match before input. */
  readonly display?: string;
  readonly screenWidth?: number;
  readonly screenHeight?: number;
  readonly scaleFactor?: number;
  readonly windowPid?: number;
  readonly windowId?: string;
  readonly windowSnapshotId?: string;
  /** Code-owned native application-menu path derived from the current snapshot. */
  readonly menuPath?: readonly string[];
  readonly position?: ComputerActionPosition;
  readonly endPosition?: ComputerActionPosition;
  /** Element-bound text uses CUA's explicit semantic input route. */
  readonly inputMethod?: "set_value" | "type_text";
  readonly text?: string;
  readonly key?: string;
  readonly modifiers?: readonly string[];
  readonly direction?: ComputerScrollDirection;
  readonly amount?: number;
}

export interface ComputerEnvironmentResult {
  readonly ok: boolean;
  readonly status: "completed" | "unknown" | "refused";
  readonly summary: string;
}

/** A bounded native proof returned by an environment-owned verifier. */
export interface ComputerEnvironmentVerification {
  readonly status: "verified" | "unsatisfied" | "unknown";
  readonly summary: string;
  readonly evidence: Readonly<Record<string, string>>;
}

export interface ComputerApprovalRequest {
  readonly callId: string;
  readonly actionId: string;
  readonly sessionId: string;
  readonly environment: ComputerEnvironmentKind;
  readonly operation: Exclude<ComputerNativeOperation, "wait">;
  readonly observationId: string;
  readonly generation: number;
  readonly displayId: string;
  readonly x?: number;
  readonly y?: number;
  readonly endX?: number;
  readonly endY?: number;
  readonly textLength?: number;
  readonly textPreview?: string;
  readonly key?: string;
  readonly modifiers?: readonly string[];
  readonly direction?: ComputerScrollDirection;
  readonly amount?: number;
  readonly targetLabel?: string;
  readonly targetRole?: string;
  readonly targetSource?: "accessibility" | "focused" | "screen";
  /** Exact Cua application-menu path, when derived from the current snapshot. */
  readonly menuPath?: readonly string[];
  readonly approvalTimeoutMs?: number;
  readonly warning: string;
  /** The code-owned condition checked after this exact input, when available. */
  readonly expectedVerification?: {
    readonly kind: string;
    readonly expected?: string;
    readonly state?: string;
  };
  readonly step?: number;
  readonly maxActions?: number;
  /** Scope shown to the approver for a high-level compiled computer task. */
  readonly taskId?: string;
  readonly grantHash?: string;
  readonly allowedTaskActions?: readonly string[];
  /** The decision strategy selected for this action, when routed by auto mode. */
  readonly strategy?: "traditional" | "typesafe" | "compare";
}

export type ComputerApprovalDecision =
  | { readonly decision: "allow-once" }
  | { readonly decision: "allow-task"; readonly grantHash: string; readonly reason?: string }
  | { readonly decision: "deny"; readonly reason?: string }
  | { readonly decision: "unavailable"; readonly reason: string };

export type ComputerApprovalEvent =
  | { readonly type: "prepared"; readonly request: ComputerApprovalRequest }
  | { readonly type: "approval_decided"; readonly request: ComputerApprovalRequest; readonly decision: ComputerApprovalDecision };

export interface ComputerTaskContext {
  readonly task: ComputerTaskSpec;
  readonly grant: ComputerTaskGrantState;
}

export type { ComputerTaskApprovalDecision, ComputerTaskApprovalRequest };

export interface ComputerEnvironment {
  readonly kind: ComputerEnvironmentKind;
  readonly sessionId: string;
  readiness(): ComputerEnvironmentReadiness;
  /** Optional read-only capability/app proof; must not launch or mutate state. */
  preflight?(signal?: AbortSignal): Promise<ComputerEnvironmentReadiness>;
  start(signal?: AbortSignal): Promise<ComputerEnvironmentReadiness>;
  observe(signal?: AbortSignal): Promise<ComputerEnvironmentObservation>;
  /** Optional host-native postcondition proof; deterministic fakes may omit it. */
  verify?(spec: ComputerVerificationSpec, observation: ComputerEnvironmentObservation, signal?: AbortSignal): Promise<ComputerEnvironmentVerification | undefined>;
  /** Optional presentation-only feedback for an approved action; it must not dispatch application input. */
  presentAction?(action: ComputerEnvironmentAction, signal?: AbortSignal): Promise<void>;
  execute(action: ComputerEnvironmentAction, signal?: AbortSignal): Promise<ComputerEnvironmentResult>;
  close(signal?: AbortSignal): Promise<void>;
}
