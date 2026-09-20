/**
 * Model-neutral contracts for a controlled computer environment.
 *
 * Browser and native desktop backends implement this boundary separately. The
 * model never receives a driver object and cannot choose a driver method or a
 * raw selector/coordinate outside the action produced by the environment.
 */
export type ComputerEnvironmentKind = "browser" | "ubuntu-x11-cua";

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
  readonly position?: ComputerActionPosition;
  readonly endPosition?: ComputerActionPosition;
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
  readonly targetSource?: "accessibility" | "screen";
  readonly approvalTimeoutMs?: number;
  readonly warning: string;
}

export type ComputerApprovalDecision =
  | { readonly decision: "allow-once" }
  | { readonly decision: "deny"; readonly reason?: string }
  | { readonly decision: "unavailable"; readonly reason: string };

export type ComputerApprovalEvent =
  | { readonly type: "prepared"; readonly request: ComputerApprovalRequest }
  | { readonly type: "approval_decided"; readonly request: ComputerApprovalRequest; readonly decision: ComputerApprovalDecision };

export interface ComputerEnvironment {
  readonly kind: ComputerEnvironmentKind;
  readonly sessionId: string;
  readiness(): ComputerEnvironmentReadiness;
  start(signal?: AbortSignal): Promise<ComputerEnvironmentReadiness>;
  observe(signal?: AbortSignal): Promise<ComputerEnvironmentObservation>;
  execute(action: ComputerEnvironmentAction, signal?: AbortSignal): Promise<ComputerEnvironmentResult>;
  close(signal?: AbortSignal): Promise<void>;
}
