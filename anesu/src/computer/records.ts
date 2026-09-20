import type {
  ComputerEnvironmentKind,
  ComputerNativeOperation,
  ComputerScrollDirection,
} from "./contracts.js";
import type { CorrelationId } from "../runtime/contracts.js";
import { assertLifecycleTransition } from "../runtime/lifecycle.js";
import { stableStringify } from "../persistence/json.js";

export type ComputerActionStatus =
  | "prepared"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "ambiguous";

export type ComputerActionErrorCode =
  | "computer-approval-denied"
  | "computer-approval-unavailable"
  | "computer-ambiguous"
  | "computer-blocked"
  | "computer-cancelled"
  | "computer-decision"
  | "computer-environment"
  | "computer-verification";

/**
 * Hash-free, bounded evidence for one native desktop input. Raw typed text is
 * deliberately not persisted; the preview is redacted before this record is
 * written by the runtime.
 */
export interface ComputerActionRecord {
  readonly schemaVersion: 1;
  readonly actionId: string;
  readonly callId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly correlationId?: CorrelationId;
  readonly environment: Extract<ComputerEnvironmentKind, "ubuntu-x11-cua">;
  readonly displayId: string;
  readonly operation: Exclude<ComputerNativeOperation, "wait">;
  readonly observationId: string;
  readonly generation: number;
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
  readonly status: ComputerActionStatus;
  readonly decision?: "allow-once" | "deny" | "unavailable";
  readonly summary?: string;
  readonly errorCode?: ComputerActionErrorCode;
  readonly errorMessage?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly recordedAt: string;
}

export type ComputerRunStatus = "running" | "completed" | "failed" | "outcome-unknown";

export type ComputerRunEventKind = "started" | "observed" | "decision_attempt" | "proposed" | "approval" | "act_requested" | "verified" | "abstained" | "failed";

/** Bounded per-tool-call metadata. Raw screenshots and provider bodies do not belong here. */
export interface ComputerRunRecord {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly callId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly correlationId?: CorrelationId;
  readonly environment: ComputerEnvironmentKind;
  readonly strategy: "traditional" | "typesafe" | "compare";
  readonly goal: string;
  /** Configured action budget for this run, when the environment enforces one. */
  readonly maxActions?: number;
  readonly status: ComputerRunStatus;
  readonly summary?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly recordedAt: string;
}

export interface ComputerRunEventRecord {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly correlationId?: CorrelationId;
  readonly sequence: number;
  readonly kind: ComputerRunEventKind;
  readonly strategy: "traditional" | "typesafe" | "compare";
  readonly payload: Readonly<Record<string, unknown>>;
  readonly recordedAt: string;
}

export type ComputerRunEventInput = Omit<ComputerRunEventRecord, "sequence" | "recordedAt"> & {
  readonly recordedAt?: string;
};

const COMPUTER_RUN_TRANSITIONS: Readonly<Record<ComputerRunStatus, readonly ComputerRunStatus[]>> = {
  running: ["completed", "failed", "outcome-unknown"],
  completed: [],
  failed: [],
  "outcome-unknown": [],
};

export function assertComputerRunTransition(previous: ComputerRunRecord, next: ComputerRunRecord): void {
  const changedFields = [
    previous.runId !== next.runId ? "runId" : undefined,
    previous.callId !== next.callId ? "callId" : undefined,
    previous.sessionId !== next.sessionId ? "sessionId" : undefined,
    previous.turnId !== next.turnId ? "turnId" : undefined,
    previous.correlationId !== next.correlationId ? "correlationId" : undefined,
    previous.environment !== next.environment ? "environment" : undefined,
    previous.strategy !== next.strategy ? "strategy" : undefined,
    previous.goal !== next.goal ? "goal" : undefined,
    previous.maxActions !== next.maxActions ? "maxActions" : undefined,
    previous.startedAt !== next.startedAt ? "startedAt" : undefined,
  ].filter((field): field is string => field !== undefined);
  if (changedFields.length > 0) {
    throw new Error(`Computer run identity cannot change after it is recorded (${changedFields.join(", ")}).`);
  }
  assertLifecycleTransition(COMPUTER_RUN_TRANSITIONS, previous.status, next.status, (from, to) => `Computer run cannot transition from ${from} to ${to}.`);
}

export function assertComputerRunEvent(event: ComputerRunEventRecord): void {
  if (event.schemaVersion !== 1
    || typeof event.eventId !== "string" || event.eventId.trim().length === 0
    || typeof event.runId !== "string" || event.runId.trim().length === 0
    || typeof event.sessionId !== "string" || event.sessionId.trim().length === 0
    || typeof event.turnId !== "string" || event.turnId.trim().length === 0
    || !Number.isSafeInteger(event.sequence) || event.sequence <= 0
    || !["started", "observed", "decision_attempt", "proposed", "approval", "act_requested", "verified", "abstained", "failed"].includes(event.kind)
    || !["traditional", "typesafe", "compare"].includes(event.strategy)
    || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)
    || Buffer.byteLength(stableStringify(event.payload), "utf8") > 16 * 1024
    || typeof event.recordedAt !== "string" || event.recordedAt.trim().length === 0) {
    throw new Error(`Computer run event '${event.eventId}' is invalid or exceeds its bounded payload.`);
  }
}

const COMPUTER_ACTION_TRANSITIONS: Readonly<Record<ComputerActionStatus, readonly ComputerActionStatus[]>> = {
  prepared: ["approved", "failed", "cancelled"],
  approved: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled", "ambiguous"],
  completed: [],
  failed: [],
  cancelled: [],
  ambiguous: [],
};

/**
 * Native input is not replay-safe. Its identity remains fixed and uncertain
 * outcomes become terminal rather than being retried after an acknowledgement
 * or process failure.
 */
export function assertComputerActionTransition(previous: ComputerActionRecord, next: ComputerActionRecord): void {
  const changedFields = [
    previous.actionId !== next.actionId ? "actionId" : undefined,
    previous.callId !== next.callId ? "callId" : undefined,
    previous.sessionId !== next.sessionId ? "sessionId" : undefined,
    previous.turnId !== next.turnId ? "turnId" : undefined,
    previous.correlationId !== undefined && previous.correlationId !== next.correlationId ? "correlationId" : undefined,
    previous.environment !== next.environment ? "environment" : undefined,
    previous.displayId !== next.displayId ? "displayId" : undefined,
    previous.operation !== next.operation ? "operation" : undefined,
    previous.observationId !== next.observationId ? "observationId" : undefined,
    previous.generation !== next.generation ? "generation" : undefined,
    previous.x !== next.x ? "x" : undefined,
    previous.y !== next.y ? "y" : undefined,
    previous.endX !== next.endX ? "endX" : undefined,
    previous.endY !== next.endY ? "endY" : undefined,
    previous.textLength !== next.textLength ? "textLength" : undefined,
    previous.textPreview !== next.textPreview ? "textPreview" : undefined,
    previous.key !== next.key ? "key" : undefined,
    JSON.stringify(previous.modifiers) !== JSON.stringify(next.modifiers) ? "modifiers" : undefined,
    previous.direction !== next.direction ? "direction" : undefined,
    previous.amount !== next.amount ? "amount" : undefined,
    previous.targetLabel !== next.targetLabel ? "targetLabel" : undefined,
    previous.targetRole !== next.targetRole ? "targetRole" : undefined,
    previous.targetSource !== next.targetSource ? "targetSource" : undefined,
    previous.approvalTimeoutMs !== next.approvalTimeoutMs ? "approvalTimeoutMs" : undefined,
  ].filter((field): field is string => field !== undefined);
  if (changedFields.length > 0) {
    throw new Error(`Computer action identity cannot change after it is recorded (${changedFields.join(", ")}).`);
  }
  assertLifecycleTransition(COMPUTER_ACTION_TRANSITIONS, previous.status, next.status, (from, to) => `Computer action cannot transition from ${from} to ${to}.`);
}
