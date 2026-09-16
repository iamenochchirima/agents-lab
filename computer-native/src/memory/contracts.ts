import type { MemoryScope, MemoryTrust, MemorySource } from "./types.js";

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

export interface MemoryBatchApprovalItem {
  readonly operation: Exclude<MemoryOperation, "batch">;
  readonly scope: MemoryScope;
  readonly recordId?: string;
  readonly sourcePath: string;
  readonly beforeContentHash?: string;
  readonly afterContentHash?: string;
  readonly contentPreview: string;
}

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
  | { readonly type: "failed"; readonly request: MemoryApprovalRequest; readonly reason: string };

export type MemoryActionStatus = "proposed" | "approved" | "denied" | "committed" | "failed";

export interface MemoryActionRecord {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly operation: MemoryOperation;
  readonly recordId?: string;
  readonly scope: MemoryScope;
  readonly sourcePath: string;
  readonly beforeContentHash?: string;
  readonly afterContentHash?: string;
  readonly inputHash: string;
  readonly status: MemoryActionStatus;
  readonly decision?: MemoryApprovalDecision["decision"];
  readonly reason?: string;
  readonly recordedAt: string;
}
