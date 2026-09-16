import type { PreparedPatch, WorkspaceMutationOperation } from "./patch.js";
import type { MutationErrorCode } from "../runtime/contracts.js";
import { ComputerNativeError } from "../runtime/errors.js";

export const MAX_PATCH_REQUEST_BYTES = 256 * 1024;
export const MAX_WRITE_FILE_REQUEST_BYTES = 256 * 1024;
export const MAX_MUTATION_SET_FILES = 16;
export const MAX_MUTATION_SET_REQUEST_BYTES = 256 * 1024;

export type MutationRisk =
  | "create-file"
  | "replace-file"
  | "patch-file"
  | "create-directory"
  | "quarantine-file"
  | "delete-directory"
  | "delete-directory-tree"
  | "restore-file"
  | "restore-directory"
  | "purge-quarantine"
  | "copy-file"
  | "copy-directory"
  | "move-file"
  | "move-directory"
  | "rename-file"
  | "rename-directory"
  | "multi-file-patch";

export interface MutationMember {
  readonly path: string;
  readonly operation: "add" | "update";
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly diff: string;
}

export type MutationJournalState = "prepared" | "staging" | "committing" | "committed" | "reconciled" | "reconciliation_required";

export interface MutationJournalMember {
  readonly path: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly commitOrder: number;
  readonly state: "pending" | "staged" | "committed";
  readonly temporaryPath?: string;
}

export interface MutationJournal {
  readonly schemaVersion: 1;
  readonly state: MutationJournalState;
  readonly transactionPath: string;
  readonly members: readonly MutationJournalMember[];
}

export interface MutationApprovalRequest {
  readonly callId?: string;
  readonly mutationId: string;
  readonly operation: WorkspaceMutationOperation;
  readonly risk: MutationRisk;
  readonly kind?: "file" | "directory";
  readonly paths?: readonly string[];
  readonly members?: readonly MutationMember[];
  readonly journal?: MutationJournal;
  readonly path: string;
  readonly beforeHash?: string;
  readonly afterHash?: string;
  readonly quarantinePath?: string;
  readonly sourceMutationId?: string;
  readonly sourcePath?: string;
  readonly sourceHash?: string;
  readonly manifestHash?: string;
  readonly entryCount?: number;
  readonly totalBytes?: number;
  readonly maxDepth?: number;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly diff: string;
}

export type MutationApprovalDecision =
  | { readonly decision: "allow-once" }
  | { readonly decision: "deny"; readonly reason?: string }
  | { readonly decision: "unavailable"; readonly reason: string };

export type MutationApproval = (request: MutationApprovalRequest, signal?: AbortSignal) => Promise<MutationApprovalDecision>;

export type MutationEvent =
  | { readonly type: "proposed"; readonly request: MutationApprovalRequest }
  | { readonly type: "approval_decided"; readonly request: MutationApprovalRequest; readonly decision: MutationApprovalDecision }
  | { readonly type: "applying"; readonly request: MutationApprovalRequest; readonly journal?: MutationJournal }
  | { readonly type: "progress"; readonly request: MutationApprovalRequest; readonly journal: MutationJournal }
  | { readonly type: "failed"; readonly request: MutationApprovalRequest; readonly reason: string; readonly code?: MutationErrorCode; readonly journal?: MutationJournal }
  | { readonly type: "committed"; readonly request: MutationApprovalRequest; readonly afterHash?: string; readonly bytesWritten?: number; readonly journal?: MutationJournal };

export type MutationRecordStatus = "proposed" | "approved" | "applying" | "denied" | "failed" | "committed" | "reconciled" | "reconciliation_required";

export interface WorkspaceMutationRecord {
  readonly schemaVersion: 1;
  readonly mutationId: string;
  readonly callId?: string;
  readonly operation: WorkspaceMutationOperation;
  readonly risk?: MutationRisk;
  readonly kind?: "file" | "directory";
  readonly paths?: readonly string[];
  readonly members?: readonly MutationMember[];
  readonly journal?: MutationJournal;
  readonly path: string;
  readonly beforeHash?: string;
  readonly afterHash?: string;
  readonly quarantinePath?: string;
  readonly sourceMutationId?: string;
  readonly sourcePath?: string;
  readonly sourceHash?: string;
  readonly manifestHash?: string;
  readonly entryCount?: number;
  readonly totalBytes?: number;
  readonly maxDepth?: number;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly diff: string;
  readonly status: MutationRecordStatus;
  readonly decision?: "allow-once" | "deny" | "unavailable";
  readonly errorCode?: MutationErrorCode;
  readonly reason?: string;
  readonly bytesWritten?: number;
  readonly recordedAt: string;
}

const mutationTransitions: Readonly<Record<MutationRecordStatus, readonly MutationRecordStatus[]>> = {
  proposed: ["approved", "denied"],
  approved: ["applying", "committed", "failed", "reconciled", "reconciliation_required"],
  applying: ["committed", "failed", "reconciled", "reconciliation_required"],
  denied: [],
  failed: [],
  committed: [],
  reconciled: [],
  reconciliation_required: [],
};

function sameOptional(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

function sameMembers(left: readonly MutationMember[] | undefined, right: readonly MutationMember[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.length !== right.length) return false;
  return left.every((member, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && member.path === candidate.path
      && member.operation === candidate.operation
      && member.beforeHash === candidate.beforeHash
      && member.afterHash === candidate.afterHash
      && member.addedLines === candidate.addedLines
      && member.removedLines === candidate.removedLines
      && member.diff === candidate.diff;
  });
}

export function assertMutationTransition(previous: WorkspaceMutationRecord, next: WorkspaceMutationRecord): void {
  const changedFields = [
    previous.schemaVersion !== next.schemaVersion ? "schemaVersion" : undefined,
    previous.mutationId !== next.mutationId ? "mutationId" : undefined,
    previous.operation !== next.operation ? "operation" : undefined,
    previous.risk !== next.risk ? "risk" : undefined,
    previous.kind !== next.kind ? "kind" : undefined,
    JSON.stringify(previous.paths) !== JSON.stringify(next.paths) ? "paths" : undefined,
    !sameMembers(previous.members, next.members) ? "members" : undefined,
    previous.path !== next.path ? "path" : undefined,
    !sameOptional(previous.beforeHash, next.beforeHash) ? "beforeHash" : undefined,
    !sameOptional(previous.afterHash, next.afterHash) ? "afterHash" : undefined,
    !sameOptional(previous.quarantinePath, next.quarantinePath) ? "quarantinePath" : undefined,
    !sameOptional(previous.sourceMutationId, next.sourceMutationId) ? "sourceMutationId" : undefined,
    !sameOptional(previous.sourcePath, next.sourcePath) ? "sourcePath" : undefined,
    !sameOptional(previous.sourceHash, next.sourceHash) ? "sourceHash" : undefined,
    !sameOptional(previous.manifestHash, next.manifestHash) ? "manifestHash" : undefined,
    previous.entryCount !== next.entryCount ? "entryCount" : undefined,
    previous.totalBytes !== next.totalBytes ? "totalBytes" : undefined,
    previous.maxDepth !== next.maxDepth ? "maxDepth" : undefined,
    previous.addedLines !== next.addedLines ? "addedLines" : undefined,
    previous.removedLines !== next.removedLines ? "removedLines" : undefined,
    previous.diff !== next.diff ? "diff" : undefined,
  ].filter((field): field is string => field !== undefined);
  if (changedFields.length > 0) {
    throw new ComputerNativeError("persistence", `Mutation '${previous.mutationId}' identity cannot be changed after it is recorded (${changedFields.join(", ")}).`);
  }
  if (previous.status === next.status) return;
  if (!mutationTransitions[previous.status].includes(next.status)) {
    throw new ComputerNativeError("persistence", `Mutation '${previous.mutationId}' cannot transition from ${previous.status} to ${next.status}.`);
  }
}

export function mutationRequest(mutationId: string, prepared: PreparedPatch): MutationApprovalRequest {
  return {
    mutationId,
    operation: prepared.operation,
    risk: prepared.operation === "add" ? "create-file" : prepared.operation === "update" ? "patch-file" : "replace-file",
    path: prepared.path,
    beforeHash: prepared.beforeHash,
    afterHash: prepared.afterHash,
    addedLines: prepared.addedLines,
    removedLines: prepared.removedLines,
    diff: prepared.diff,
  };
}
