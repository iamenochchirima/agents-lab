import type { BrowserActionEffect, BrowserActionRoute, BrowserApprovalAction, BrowserDeliveryMode, BrowserDialogDecision, BrowserDialogObservation, BrowserDocumentId, BrowserEscalationReason, BrowserEscalationTarget, BrowserInputRoute, BrowserScrollDirection, BrowserSessionId, BrowserTabId } from "./contracts.js";
import type { BrowserDiagnostic, BrowserErrorCode } from "./errors.js";
import type { CorrelationId } from "../runtime/contracts.js";
import { assertLifecycleTransition } from "../runtime/lifecycle.js";

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
  /** The host-selected Cua delivery route is durable approval evidence. */
  readonly inputRoute?: BrowserInputRoute;
  /** Bounded identity of the high-level task that authorized this action. */
  readonly taskId?: string;
  readonly grantHash?: string;
  readonly allowedTaskActions?: readonly string[];
  readonly reference: string;
  readonly documentId: BrowserDocumentId;
  readonly text?: string;
  readonly key?: string;
  readonly value?: string;
  readonly direction?: BrowserScrollDirection;
  readonly amount?: number;
  readonly path?: string;
  readonly maxBytes?: number;
  readonly actionHash: string;
  readonly approvalTimeoutMs?: number;
  readonly status: BrowserActionStatus;
  readonly decision?: "allow-once" | "allow-task" | "deny" | "unavailable";
  readonly summary?: string;
  /** Cua's bounded effect verdict is evidence, not a task completion claim. */
  readonly effect?: BrowserActionEffect;
  readonly route?: BrowserActionRoute;
  readonly delivery?: { readonly mode: BrowserDeliveryMode; readonly deliveredCount?: number };
  readonly escalation?: { readonly target: BrowserEscalationTarget; readonly reason: BrowserEscalationReason };
  readonly errorCode?: BrowserActionErrorCode;
  readonly underlyingErrorCode?: BrowserActionErrorCode;
  readonly cuaCode?: string;
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
    previous.inputRoute !== next.inputRoute ? "inputRoute" : undefined,
    previous.taskId !== next.taskId ? "taskId" : undefined,
    previous.grantHash !== next.grantHash ? "grantHash" : undefined,
    JSON.stringify(previous.allowedTaskActions) !== JSON.stringify(next.allowedTaskActions) ? "allowedTaskActions" : undefined,
    previous.reference !== next.reference ? "reference" : undefined,
    previous.documentId !== next.documentId ? "documentId" : undefined,
    previous.text !== next.text ? "text" : undefined,
    previous.key !== next.key ? "key" : undefined,
    previous.value !== next.value ? "value" : undefined,
    previous.direction !== next.direction ? "direction" : undefined,
    previous.amount !== next.amount ? "amount" : undefined,
    previous.path !== next.path ? "path" : undefined,
    previous.maxBytes !== next.maxBytes ? "maxBytes" : undefined,
    previous.actionHash !== next.actionHash ? "actionHash" : undefined,
    previous.approvalTimeoutMs !== next.approvalTimeoutMs ? "approvalTimeoutMs" : undefined,
  ].filter((field): field is string => field !== undefined);
  if (changedFields.length > 0) {
    throw new Error(`Browser action identity cannot change after it is recorded (${changedFields.join(", ")}).`);
  }
  assertLifecycleTransition(BROWSER_ACTION_TRANSITIONS, previous.status, next.status, (from, to) => `Browser action cannot transition from ${from} to ${to}.`);
}
