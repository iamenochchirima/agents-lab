import type { BrowserApprovalAction, BrowserDialogDecision, BrowserDialogObservation, BrowserDocumentId, BrowserSessionId, BrowserTabId } from "./contracts.js";
import type { BrowserDiagnostic, BrowserErrorCode } from "./errors.js";
import type { CorrelationId } from "../runtime/contracts.js";

export type BrowserActionStatus =
  | "prepared"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "ambiguous";

export type BrowserActionErrorCode = BrowserErrorCode | "browser-approval-denied" | "browser-approval-unavailable";

export interface BrowserActionRecord {
  readonly schemaVersion: 1;
  readonly actionId: string;
  readonly callId: string;
  readonly sessionId: BrowserSessionId;
  readonly turnId: string;
  readonly correlationId?: CorrelationId;
  readonly tabId: BrowserTabId;
  readonly action: BrowserApprovalAction;
  readonly reference: string;
  readonly documentId: BrowserDocumentId;
  readonly text?: string;
  readonly key?: string;
  readonly path?: string;
  readonly maxBytes?: number;
  readonly actionHash: string;
  readonly approvalTimeoutMs?: number;
  readonly status: BrowserActionStatus;
  readonly decision?: "allow-once" | "deny" | "unavailable";
  readonly summary?: string;
  readonly errorCode?: BrowserActionErrorCode;
  readonly underlyingErrorCode?: BrowserActionErrorCode;
  readonly errorMessage?: string;
  readonly dialog?: BrowserDialogObservation;
  readonly dialogDecision?: BrowserDialogDecision;
  readonly cancellationConfirmed?: boolean;
  readonly diagnostic?: BrowserDiagnostic;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly recordedAt: string;
}

const BROWSER_ACTION_TRANSITIONS: Readonly<Record<BrowserActionStatus, readonly BrowserActionStatus[]>> = {
  prepared: ["approved", "failed", "cancelled"],
  approved: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled", "ambiguous"],
  completed: [],
  failed: [],
  cancelled: [],
  ambiguous: [],
};

/**
 * Browser actions are durable observations, not replay instructions. Their identity
 * fields must remain fixed while the state advances, and an uncertain adapter outcome
 * is terminally ambiguous rather than silently retried.
 */
export function assertBrowserActionTransition(previous: BrowserActionRecord, next: BrowserActionRecord): void {
  const changedFields = [
    previous.actionId !== next.actionId ? "actionId" : undefined,
    previous.callId !== next.callId ? "callId" : undefined,
    previous.sessionId !== next.sessionId ? "sessionId" : undefined,
    previous.turnId !== next.turnId ? "turnId" : undefined,
    previous.correlationId !== undefined && previous.correlationId !== next.correlationId ? "correlationId" : undefined,
    previous.tabId !== next.tabId ? "tabId" : undefined,
    previous.action !== next.action ? "action" : undefined,
    previous.reference !== next.reference ? "reference" : undefined,
    previous.documentId !== next.documentId ? "documentId" : undefined,
    previous.text !== next.text ? "text" : undefined,
    previous.key !== next.key ? "key" : undefined,
    previous.path !== next.path ? "path" : undefined,
    previous.maxBytes !== next.maxBytes ? "maxBytes" : undefined,
    previous.actionHash !== next.actionHash ? "actionHash" : undefined,
    previous.approvalTimeoutMs !== next.approvalTimeoutMs ? "approvalTimeoutMs" : undefined,
  ].filter((field): field is string => field !== undefined);
  if (changedFields.length > 0) {
    throw new Error(`Browser action identity cannot change after it is recorded (${changedFields.join(", ")}).`);
  }
  if (previous.status === next.status) return;
  if (!BROWSER_ACTION_TRANSITIONS[previous.status].includes(next.status)) {
    throw new Error(`Browser action cannot transition from ${previous.status} to ${next.status}.`);
  }
}
