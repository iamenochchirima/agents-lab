import type { MemoryScope, MemoryTrust, MemorySource } from "./types.js";
import type { CorrelationId } from "../runtime/contracts.js";
import { assertLifecycleTransition } from "../runtime/lifecycle.js";

export type { MemoryScope, MemoryTrust, MemorySource } from "./types.js";

export interface MemoryProvenance {
  readonly source: MemorySource;
  readonly sourceId: string;
  readonly trust: MemoryTrust;
}

export interface MemoryRecord {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly content: string;
  readonly contentHash: string;
  readonly sourcePath: string;
  readonly provenance: MemoryProvenance;
  readonly profileId: string;
  readonly workspaceId: string;
  readonly date?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryStatus {
  readonly enabled: boolean;
  readonly entries: number;
  readonly userEntries: number;
  readonly workspaceEntries: number;
  readonly dailyEntries: number;
  readonly indexPath: string;
  readonly canonicalPaths: readonly string[];
  readonly dailyRetentionDays: number;
  readonly indexStatus: "ready";
  readonly indexEntries: number;
}

export interface MemoryFlushRequest {
  readonly reason: "context-pressure" | "manual";
  readonly maxChars: number;
}

export interface MemoryFlushResult {
  readonly status: "not-supported";
  readonly recordsWritten: 0;
  readonly reason: string;
}

export type MemoryFlush = (request: MemoryFlushRequest, signal?: AbortSignal) => Promise<MemoryFlushResult>;

export interface MemorySearchResult {
  readonly recordId: string;
  readonly scope: MemoryScope;
  readonly content: string;
  readonly contentHash: string;
  readonly sourcePath: string;
  readonly provenance: MemoryProvenance;
  readonly score: number;
  readonly sourceLine?: number;
  readonly snippet?: string;
  readonly date?: string;
}

/**
 * Redacted evidence for one search. The query itself is intentionally absent;
 * callers persist only its digest and the returned record references.
 */
export interface MemorySearchEvidence {
  readonly schemaVersion: 1;
  readonly searchId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly correlationId?: CorrelationId;
  readonly callId: string;
  readonly queryHash: string;
  readonly scopes?: readonly MemoryScope[];
  readonly maxResults: number;
  readonly resultIds: readonly string[];
  readonly resultCount: number;
  readonly truncated: boolean;
  readonly recordedAt: string;
}

export type MemoryOperation = "add" | "replace" | "remove" | "batch";

export interface MemoryBatchOutcome {
  readonly operation: Exclude<MemoryOperation, "batch">;
  readonly record?: MemoryRecord;
  readonly recordId?: string;
}

export interface MemoryBatchApprovalItem {
  readonly operation: Exclude<MemoryOperation, "batch">;
  readonly scope: MemoryScope;
  readonly recordId?: string;
  readonly sourcePath: string;
  readonly beforeContentHash?: string;
  readonly afterContentHash?: string;
  readonly contentPreview: string;
}

/** Redacted, hash-only manifest retained for restart reconciliation. */
export type MemoryBatchActionItem = Omit<MemoryBatchApprovalItem, "contentPreview">;

export interface MemoryApprovalRequest {
  readonly operationId: string;
  readonly callId: string;
  readonly operation: MemoryOperation;
  readonly recordId?: string;
  readonly scope: MemoryScope;
  readonly sourcePath: string;
  readonly beforeContentHash?: string;
  readonly afterContentHash?: string;
  readonly contentPreview: string;
  readonly risk: "remember" | "replace" | "forget" | "batch";
  readonly approvalTimeoutMs?: number;
  readonly batch?: readonly MemoryBatchApprovalItem[];
}

export type MemoryApprovalDecision =
  | { readonly decision: "allow-once" }
  | { readonly decision: "deny"; readonly reason?: string }
  | { readonly decision: "unavailable"; readonly reason: string };

export type MemoryApproval = (
  request: MemoryApprovalRequest,
  signal?: AbortSignal,
) => Promise<MemoryApprovalDecision>;

export type MemoryEvent =
  | { readonly type: "prepared"; readonly request: MemoryApprovalRequest }
  | { readonly type: "approval_decided"; readonly request: MemoryApprovalRequest; readonly decision: MemoryApprovalDecision }
  | { readonly type: "committed"; readonly request: MemoryApprovalRequest; readonly record: MemoryRecord }
  | { readonly type: "forgotten"; readonly request: MemoryApprovalRequest }
  | { readonly type: "batch_committed"; readonly request: MemoryApprovalRequest; readonly results: readonly MemoryBatchOutcome[] }
  | { readonly type: "failed"; readonly request: MemoryApprovalRequest; readonly reason: string };

export type MemoryActionStatus = "proposed" | "approved" | "denied" | "committed" | "failed";

export interface MemoryActionRecord {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly correlationId?: CorrelationId;
  readonly callId: string;
  readonly operation: MemoryOperation;
  readonly recordId?: string;
  readonly scope: MemoryScope;
  readonly sourcePath: string;
  readonly beforeContentHash?: string;
  readonly afterContentHash?: string;
  readonly inputHash: string;
  readonly batch?: readonly MemoryBatchActionItem[];
  readonly approvalTimeoutMs?: number;
  readonly status: MemoryActionStatus;
  readonly decision?: MemoryApprovalDecision["decision"];
  readonly reason?: string;
  readonly recordedAt: string;
}

const MEMORY_ACTION_TRANSITIONS: Readonly<Record<MemoryActionStatus, readonly MemoryActionStatus[]>> = {
  proposed: ["approved", "denied", "failed"],
  approved: ["denied", "committed", "failed"],
  denied: [],
  committed: [],
  failed: [],
};

function sameBatchIdentity(left: readonly MemoryBatchActionItem[] | undefined, right: readonly MemoryBatchActionItem[] | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return other !== undefined
      && item.operation === other.operation
      && item.scope === other.scope
      && item.recordId === other.recordId
      && item.sourcePath === other.sourcePath
      && item.beforeContentHash === other.beforeContentHash
      && item.afterContentHash === other.afterContentHash;
  });
}

/**
 * Keep append-only memory evidence tied to one prepared operation. Recovery may
 * classify an approved operation as denied or failed, but it must never skip the
 * approval boundary or rewrite the operation identity.
 */
export function assertMemoryActionTransition(previous: MemoryActionRecord, next: MemoryActionRecord): void {
  const changedFields = [
    previous.operationId !== next.operationId ? "operationId" : undefined,
    previous.sessionId !== next.sessionId ? "sessionId" : undefined,
    previous.turnId !== next.turnId ? "turnId" : undefined,
    previous.correlationId !== undefined && previous.correlationId !== next.correlationId ? "correlationId" : undefined,
    previous.callId !== next.callId ? "callId" : undefined,
    previous.operation !== next.operation ? "operation" : undefined,
    previous.operation !== "add" && previous.recordId !== next.recordId ? "recordId" : undefined,
    previous.scope !== next.scope ? "scope" : undefined,
    previous.sourcePath !== next.sourcePath ? "sourcePath" : undefined,
    previous.beforeContentHash !== next.beforeContentHash ? "beforeContentHash" : undefined,
    previous.afterContentHash !== next.afterContentHash ? "afterContentHash" : undefined,
    previous.inputHash !== next.inputHash ? "inputHash" : undefined,
    !sameBatchIdentity(previous.batch, next.batch) ? "batch" : undefined,
    previous.approvalTimeoutMs !== next.approvalTimeoutMs ? "approvalTimeoutMs" : undefined,
  ].filter((field): field is string => field !== undefined);
  if (changedFields.length > 0) {
    throw new Error(`Memory action identity cannot change after it is recorded (${changedFields.join(", ")}).`);
  }
  if (previous.status === next.status) {
    if (previous.decision !== next.decision || previous.reason !== next.reason) {
      throw new Error("Memory action has conflicting duplicate outcome evidence.");
    }
    return;
  }
  assertLifecycleTransition(MEMORY_ACTION_TRANSITIONS, previous.status, next.status, (from, to) => `Memory action cannot transition from ${from} to ${to}.`);
}
