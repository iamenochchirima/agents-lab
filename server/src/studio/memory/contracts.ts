/**
 * Domain contracts for Studio Memory. Memory state is deliberately separate
 * from Context messages: a record may be retrieved, but only Context decides
 * whether and how it becomes model-visible.
 */

export const STUDIO_MEMORY_SCHEMA_VERSION = 1 as const;

export type StudioMemoryScope = "working" | "episodic" | "semantic" | "procedural";
export type StudioMemoryRecordState = "active" | "superseded" | "discarded" | "expired";
export type StudioMemoryOperation = "add" | "update" | "delete" | "noop" | "expire";

export interface StudioMemoryNamespace {
  readonly comparisonId: string;
  readonly trialId: string;
  readonly scenarioId: string;
  readonly sessionId: string;
}

export interface StudioMemoryRecord {
  readonly schemaVersion: typeof STUDIO_MEMORY_SCHEMA_VERSION;
  readonly recordId: string;
  readonly namespace: StudioMemoryNamespace;
  readonly scope: StudioMemoryScope;
  readonly content: string;
  readonly logicalKey: string | null;
  readonly source: string;
  readonly sourceMessageIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly state: StudioMemoryRecordState;
  readonly supersedesRecordId: string | null;
  readonly expiresAt: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface StudioMemoryState {
  readonly schemaVersion: typeof STUDIO_MEMORY_SCHEMA_VERSION;
  readonly namespace: StudioMemoryNamespace;
  readonly revision: number;
  readonly records: readonly StudioMemoryRecord[];
}

export interface StudioMemoryLimits {
  readonly maxRecords: number;
  readonly maxRecordBytes: number;
  readonly maxContentBytes: number;
  readonly maxRetrievedRecords: number;
  readonly maxJournalBytes: number;
  readonly maxConsolidationOperations: number;
}

export const DEFAULT_STUDIO_MEMORY_LIMITS: StudioMemoryLimits = Object.freeze({
  maxRecords: 500,
  maxRecordBytes: 32 * 1024,
  maxContentBytes: 16 * 1024,
  maxRetrievedRecords: 20,
  maxJournalBytes: 4 * 1024 * 1024,
  maxConsolidationOperations: 100,
});

export type StudioMemoryCancellationPhase =
  | "before-retrieval"
  | "before-persistence"
  | "during-persistence"
  | "after-persistence";

export type StudioMemoryPersistenceOutcome = "not-started" | "applied" | "unknown";

export class StudioMemoryCancellationError extends Error {
  constructor(
    readonly phase: StudioMemoryCancellationPhase,
    readonly persisted: boolean,
    readonly persistenceOutcome: StudioMemoryPersistenceOutcome,
    message: string,
  ) {
    super(message);
    // Preserve the platform's existing cancellation classification while exposing
    // the Memory-specific phase and persistence outcome to callers.
    this.name = "AbortError";
  }
}

export interface StudioMemoryJournalContext {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly timestamp: string;
}

export interface StudioMemorySeed {
  readonly recordId: string;
  readonly scope: StudioMemoryScope;
  readonly content: string;
  readonly logicalKey?: string | null;
  readonly source: string;
  readonly sourceMessageIds?: readonly string[];
  readonly createdAt: string;
  readonly expiresAt?: string | null;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface StudioMemoryCandidate {
  readonly record: StudioMemoryRecord;
  readonly score: number;
  readonly reason: string;
  readonly selected: boolean;
}

export interface StudioMemoryReadResult {
  readonly stateRevision: number;
  readonly stateRecovered?: boolean;
  readonly queryTerms: readonly string[];
  readonly candidates: readonly StudioMemoryCandidate[];
  readonly records: readonly StudioMemoryRecord[];
  readonly retrievedRecordIds: readonly string[];
  readonly omittedRecordIds: readonly string[];
}

export interface StudioMemoryWriteCandidate {
  readonly recordId?: string;
  readonly scope: StudioMemoryScope;
  readonly content: string;
  readonly logicalKey?: string | null;
  readonly source: string;
  readonly sourceMessageIds?: readonly string[];
  readonly createdAt: string;
  readonly expiresAt?: string | null;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface StudioMemoryMutation {
  readonly operationId: string;
  readonly operation: StudioMemoryOperation;
  readonly candidate?: StudioMemoryWriteCandidate;
  readonly targetRecordId?: string;
  readonly reason: string;
}

export interface StudioMemoryDecision {
  readonly operationId: string;
  readonly operation: StudioMemoryOperation;
  readonly recordId: string | null;
  readonly targetRecordId: string | null;
  readonly logicalKey: string | null;
  readonly scope: StudioMemoryScope | null;
  readonly reason: string;
  readonly stateRevision: number;
}

export interface StudioMemoryApplyResult {
  readonly state: StudioMemoryState;
  readonly decisions: readonly StudioMemoryDecision[];
  readonly appliedOperationIds: readonly string[];
}

export interface StudioMemoryWriteResult {
  readonly stateRevision: number;
  readonly decisions: readonly StudioMemoryDecision[];
  readonly writtenRecordIds: readonly string[];
  readonly updatedRecordIds: readonly string[];
  readonly discardedRecordIds: readonly string[];
  readonly expiredRecordIds: readonly string[];
  readonly activeRecordIds: readonly string[];
  readonly scopes: readonly StudioMemoryScope[];
}

export interface StudioMemoryConsolidationResult {
  readonly stateRevision: number;
  readonly decisions: readonly StudioMemoryDecision[];
  readonly expiredRecordIds: readonly string[];
  readonly activeRecordIds: readonly string[];
  readonly scopes: readonly StudioMemoryScope[];
}

export interface StudioMemoryStoreAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly scope: StudioMemoryScope | "none";
  /** Reopen durable state between turns without changing the policy. */
  readonly reopen?: () => StudioMemoryStoreAdapter;
  seed?(seeds: readonly StudioMemorySeed[], operationId: string): Promise<void>;
  read(input: {
    readonly task: string;
    readonly now?: string;
    readonly signal: AbortSignal;
  }): Promise<StudioMemoryReadResult>;
  write(input: {
    readonly trialId?: string;
    readonly task?: string;
    readonly turnId?: string;
    readonly output: string;
    readonly now?: string;
    readonly signal: AbortSignal;
  }): Promise<StudioMemoryWriteResult>;
  consolidate(input: {
    readonly turnId?: string;
    readonly now?: string;
    readonly signal: AbortSignal;
  }): Promise<StudioMemoryConsolidationResult>;
}

export interface StudioMemoryRepository {
  readonly namespace: StudioMemoryNamespace;
  readonly lastLoadRecovered?: boolean;
  load(): Promise<StudioMemoryState>;
  seed(seeds: readonly StudioMemorySeed[], operationId: string, context?: StudioMemoryJournalContext): Promise<StudioMemoryApplyResult>;
  apply(mutations: readonly StudioMemoryMutation[], context?: StudioMemoryJournalContext): Promise<StudioMemoryApplyResult>;
}

export interface StudioMemoryPolicy {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly scope: StudioMemoryScope | "none";
  retrieve(input: {
    readonly state: StudioMemoryState;
    readonly task: string;
    readonly now: string;
    readonly limits: StudioMemoryLimits;
  }): StudioMemoryReadResult;
  proposeWrite(input: {
    readonly state: StudioMemoryState;
    readonly task: string;
    readonly turnId: string;
    readonly output: string;
    readonly now: string;
  }): readonly StudioMemoryMutation[];
  proposeConsolidation(input: {
    readonly state: StudioMemoryState;
    readonly now: string;
  }): readonly StudioMemoryMutation[];
}

export interface StudioMemoryEvidenceProjection {
  readonly schemaVersion: typeof STUDIO_MEMORY_SCHEMA_VERSION;
  readonly comparisonId: string;
  readonly trialId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly stateRevision: number;
  readonly queryTerms: readonly string[];
  readonly candidates: readonly StudioMemoryCandidate[];
  readonly retrievedRecordIds: readonly string[];
  readonly omittedRecordIds: readonly string[];
  readonly decisions: readonly StudioMemoryDecision[];
  readonly activeRecordIds: readonly string[];
  readonly scopes: readonly StudioMemoryScope[];
}
