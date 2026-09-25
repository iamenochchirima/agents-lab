import type { ModuleIdentity, RunScope, SessionId } from "@agent-harness-lab/agent-protocol";

export type MemoryKind = "working" | "fact" | "episode" | "procedure";
export type MemoryTrust = "trusted" | "untrusted";

export interface MemorySessionScope {
  readonly ownerId: string;
  readonly sessionId: SessionId;
}

/** Memory requires the optional protocol session ID and an owner ID on each operation. */
export interface MemoryOperationScope extends RunScope {
  readonly ownerId: string;
  readonly sessionId: SessionId;
}

export interface MemoryProvenance {
  readonly sourceId: string;
  readonly sourceKind: string;
  readonly trust: MemoryTrust;
  readonly observedAt: string;
}

export interface MemoryObservation {
  readonly observationId: string;
  readonly content: string;
  readonly kind: MemoryKind;
  readonly provenance: MemoryProvenance;
  /** Optional grouping key; v0 does not prescribe update or merge behavior for it. */
  readonly logicalKey?: string;
}

export interface MemoryRecord {
  readonly recordId: string;
  readonly content: string;
  readonly kind: MemoryKind;
  readonly provenance: MemoryProvenance;
  readonly logicalKey: string | null;
  readonly createdAt: string;
  readonly revision: number;
}

export interface MemoryCandidate {
  readonly record: MemoryRecord;
  readonly rank: number;
  /** Scores are implementation-specific and must not be compared across modules. */
  readonly score: number | null;
  readonly reason: string;
}

export interface MemoryRecallRequest {
  readonly scope: MemoryOperationScope;
  readonly query: string;
  readonly limit?: number;
}

export interface MemoryRecallResult {
  readonly stateRevision: number;
  readonly candidates: readonly MemoryCandidate[];
}

export interface MemoryObserveRequest {
  readonly scope: MemoryOperationScope;
  readonly observations: readonly MemoryObservation[];
}

export interface MemoryWriteReceipt {
  readonly outcome: "applied" | "skipped" | "unknown";
  readonly stateRevision: number;
  readonly storedRecordIds: readonly string[];
  readonly skippedObservations: readonly {
    readonly observationId: string;
    readonly reason: "duplicate" | "capacity";
  }[];
}

export type MemoryErrorCode = "INVALID_MEMORY_REQUEST" | "MEMORY_SCOPE_MISMATCH" | "MEMORY_CLOSED";

export class MemoryError extends Error {
  constructor(readonly code: MemoryErrorCode, message: string) {
    super(message);
    this.name = "MemoryError";
  }
}

/**
 * One open session owns its recall/write lifecycle. Implementations must keep
 * records scoped to the configured owner and session and report write uncertainty.
 */
export interface MemorySession {
  readonly identity: ModuleIdentity;
  readonly scope: MemorySessionScope;
  recall(request: MemoryRecallRequest, signal: AbortSignal): Promise<MemoryRecallResult>;
  observe(request: MemoryObserveRequest, signal: AbortSignal): Promise<MemoryWriteReceipt>;
  close(): Promise<void>;
}
