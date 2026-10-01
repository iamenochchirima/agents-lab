import type { ModuleIdentity } from "@agent-harness-lab/agent-protocol";
import { MemoryError, type MemoryCandidate, type MemoryObservation, type MemoryOperationScope, type MemoryRecord, type MemoryRecallRequest, type MemoryRecallResult, type MemoryObserveRequest, type MemorySession, type MemorySessionScope, type MemoryWriteReceipt } from "./contract.js";
import { parseMemoryConfig, type MemoryConfig } from "./config.js";

export const IN_MEMORY_SESSION_IDENTITY: ModuleIdentity = Object.freeze({ id: "in-memory-session", version: "0.1.0" });

/**
 * Deterministic session-scoped reference implementation. State lives only in this
 * object and is lost on close or process exit; it is not a durable store.
 */
class InMemorySessionImpl implements MemorySession {
  readonly identity = IN_MEMORY_SESSION_IDENTITY;
  readonly scope: MemorySessionScope;
  private readonly records = new Map<string, MemoryRecord>();
  private readonly observationIds = new Set<string>();
  private revision = 0;
  private closed = false;

  constructor(
    scope: MemorySessionScope,
    private readonly config: MemoryConfig,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.scope = Object.freeze({ ...scope });
  }

  async recall(request: MemoryRecallRequest, signal: AbortSignal): Promise<MemoryRecallResult> {
    this.assertOpen();
    assertScope(this.scope, request.scope);
    assertNotAborted(signal, "Memory recall was cancelled before it began.");
    if (typeof request.query !== "string") throw new MemoryError("INVALID_MEMORY_REQUEST", "Memory query must be text.");
    const limit = request.limit ?? this.config.maxRecallResults;
    if (!Number.isInteger(limit) || limit < 1 || limit > this.config.maxRecallResults) {
      throw new MemoryError("INVALID_MEMORY_REQUEST", `Recall limit must be between 1 and ${this.config.maxRecallResults}.`);
    }

    const queryTerms = terms(request.query);
    const ranked = [...this.records.values()]
      .map((record) => ({ record, overlap: overlapCount(queryTerms, terms(record.content)) }))
      .filter((entry) => entry.overlap > 0)
      .sort((left, right) => right.overlap - left.overlap || left.record.recordId.localeCompare(right.record.recordId))
      .slice(0, limit);
    assertNotAborted(signal, "Memory recall was cancelled before results were returned.");
    const candidates: MemoryCandidate[] = ranked.map((entry, index) => ({
      record: entry.record,
      rank: index + 1,
      score: entry.overlap,
      reason: `Matched ${entry.overlap} query term${entry.overlap === 1 ? "" : "s"}.`,
    }));
    return { stateRevision: this.revision, candidates };
  }

  async observe(request: MemoryObserveRequest, signal: AbortSignal): Promise<MemoryWriteReceipt> {
    this.assertOpen();
    assertScope(this.scope, request.scope);
    assertNotAborted(signal, "Memory write was cancelled before persistence.");
    if (!Array.isArray(request.observations)) throw new MemoryError("INVALID_MEMORY_REQUEST", "Observations must be an array.");

    // Validate the full batch before mutating state so invalid data cannot leave a partial write.
    for (const observation of request.observations) validateObservation(observation, this.config.maxContentBytes);
    const storedRecordIds: string[] = [];
    const skippedObservations: MemoryWriteReceipt["skippedObservations"][number][] = [];
    for (const observation of request.observations) {
      if (signal.aborted) {
        // The synchronous commit section cannot be interrupted between these checks and Map writes.
        throw abortError("Memory write was cancelled before its next observation was committed.");
      }
      if (this.observationIds.has(observation.observationId)) {
        skippedObservations.push({ observationId: observation.observationId, reason: "duplicate" });
        continue;
      }
      if (this.records.size >= this.config.maxRecords) {
        skippedObservations.push({ observationId: observation.observationId, reason: "capacity" });
        continue;
      }
      const recordId = `memory-${encodeURIComponent(this.scope.sessionId)}-${encodeURIComponent(observation.observationId)}`;
      const record: MemoryRecord = Object.freeze({
        recordId,
        content: observation.content,
        kind: observation.kind,
        provenance: Object.freeze({ ...observation.provenance }),
        logicalKey: observation.logicalKey ?? null,
        createdAt: this.now(),
        revision: this.revision + 1,
      });
      this.records.set(recordId, record);
      this.observationIds.add(observation.observationId);
      this.revision += 1;
      storedRecordIds.push(recordId);
    }
    return {
      outcome: storedRecordIds.length > 0 ? "applied" : "skipped",
      stateRevision: this.revision,
      storedRecordIds,
      skippedObservations,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.records.clear();
    this.observationIds.clear();
  }

  private assertOpen(): void {
    if (this.closed) throw new MemoryError("MEMORY_CLOSED", "This Memory session is closed.");
  }
}

export function createInMemorySession(
  scope: MemorySessionScope,
  config: MemoryConfig,
  now?: () => string,
): MemorySession {
  if (!scope || typeof scope.ownerId !== "string" || scope.ownerId.trim() !== scope.ownerId || scope.ownerId.length === 0
    || typeof scope.sessionId !== "string" || scope.sessionId.trim() !== scope.sessionId || scope.sessionId.length === 0) {
    throw new MemoryError("INVALID_MEMORY_REQUEST", "Memory session scope requires a non-empty ownerId and sessionId.");
  }
  return new InMemorySessionImpl(scope, parseMemoryConfig(config), now);
}

function assertScope(expected: MemorySessionScope, actual: MemoryOperationScope): void {
  if (actual.sessionId !== expected.sessionId || actual.ownerId !== expected.ownerId) {
    throw new MemoryError("MEMORY_SCOPE_MISMATCH", "The run must identify the owner and session that own this Memory instance.");
  }
}

function validateObservation(value: MemoryObservation, maxContentBytes: number): void {
  if (!value || typeof value !== "object" || typeof value.observationId !== "string" || value.observationId.length === 0) {
    throw new MemoryError("INVALID_MEMORY_REQUEST", "Each observation needs a non-empty observationId.");
  }
  if (typeof value.content !== "string" || byteLength(value.content) > maxContentBytes) {
    throw new MemoryError("INVALID_MEMORY_REQUEST", `Observation content must be text within ${maxContentBytes} bytes.`);
  }
  if (value.kind !== "working" && value.kind !== "fact" && value.kind !== "episode" && value.kind !== "procedure") {
    throw new MemoryError("INVALID_MEMORY_REQUEST", "Observation kind is not supported.");
  }
  if (value.logicalKey !== undefined && typeof value.logicalKey !== "string") {
    throw new MemoryError("INVALID_MEMORY_REQUEST", "Observation logicalKey must be text when provided.");
  }
  if (!value.provenance || typeof value.provenance.sourceId !== "string" || typeof value.provenance.sourceKind !== "string"
    || (value.provenance.trust !== "trusted" && value.provenance.trust !== "untrusted")
    || typeof value.provenance.observedAt !== "string") {
    throw new MemoryError("INVALID_MEMORY_REQUEST", "Observation provenance is incomplete.");
  }
}

function terms(value: string): ReadonlySet<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((term) => term.length > 2) ?? []);
}

function overlapCount(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0;
  for (const term of right) if (left.has(term)) count += 1;
  return count;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertNotAborted(signal: AbortSignal, message: string): void {
  if (signal.aborted) throw abortError(message);
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
