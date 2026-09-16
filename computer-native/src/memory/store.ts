import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chmod, lstat, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ComputerNativeError } from "../runtime/errors.js";
import { appendJsonLine, ensureDirectory, readJsonLines } from "../persistence/json.js";
import { SessionLock } from "../persistence/lock.js";
import type {
  MemoryProvenance,
  MemoryRecord,
  MemoryScope,
  MemorySearchResult,
  MemoryStatus,
  MemoryFlushRequest,
  MemoryFlushResult,
  MemoryActionRecord,
  MemoryBatchActionItem,
  MemoryBatchOutcome,
} from "./contracts.js";

const DEFAULT_USER_MAX_CHARS = 1_375;
const DEFAULT_WORKSPACE_MAX_CHARS = 2_200;
const DEFAULT_DAILY_MAX_CHARS = 12_000;
const MAX_SEARCH_RESULTS = 50;
const MEMORY_START = "<!-- computer-native-memory: ";
const MEMORY_END = "<!-- /computer-native-memory -->";

export type MemoryWriteOperation = "canonical-replace" | "deletion-evidence-append";

/** Diagnostic-only seam for stopping memory at a durable file boundary. */
export interface MemoryWriteHooks {
  readonly beforeWrite?: (operation: MemoryWriteOperation, filePath: string) => Promise<void> | void;
  readonly afterWrite?: (operation: MemoryWriteOperation, filePath: string) => Promise<void> | void;
}

export interface MemoryStoreOptions {
  readonly stateDir: string;
  readonly profileId: string;
  readonly workspaceId: string;
  readonly userMaxChars?: number;
  readonly workspaceMaxChars?: number;
  readonly dailyMaxChars?: number;
  readonly dailyRetentionDays?: number;
  readonly writeHooks?: MemoryWriteHooks;
}

interface MemoryMutation {
  readonly scope: MemoryScope;
  readonly content: string;
  readonly provenance: MemoryProvenance;
  readonly date?: string;
}

export type MemoryBatchMutation =
  | { readonly operation: "add"; readonly scope: MemoryScope; readonly content: string; readonly provenance: MemoryProvenance; readonly date?: string }
  | { readonly operation: "replace"; readonly id: string; readonly content: string; readonly expectedContentHash: string; readonly provenance: MemoryProvenance }
  | { readonly operation: "remove"; readonly id: string; readonly expectedContentHash: string; readonly sourceId: string };

export type MemoryBatchResult = MemoryBatchOutcome;

interface StoredMemoryRecord extends MemoryRecord {
  readonly status: "active";
}

interface MemoryFileMetadata {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly contentHash: string;
  readonly provenance: MemoryProvenance;
  readonly profileId: string;
  readonly workspaceId: string;
  readonly date?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface MemoryDeletionEvidence {
  readonly schemaVersion: 1;
  readonly recordId: string;
  readonly scope: MemoryScope;
  readonly sourcePath: string;
  readonly beforeContentHash: string;
  readonly sourceId: string;
  readonly beforeFileHash: string;
  readonly afterFileHash: string;
  readonly status: "prepared" | "committed";
  readonly recordedAt: string;
}

type IndexRow = Record<string, string | number | null>;

export class MemoryPolicyError extends ComputerNativeError {
  constructor(message: string) {
    super("invalid-input", message);
    this.name = "MemoryPolicyError";
  }
}

/**
 * Durable memory owns the human-readable Markdown files. SQLite is only a
 * rebuildable lookup index, so losing it never loses the user's memory.
 * Mutations reload the canonical files while holding a lock and replace the
 * affected file atomically before rebuilding the index.
 */
export class MemoryStore {
  private readonly memoryDir: string;
  private readonly databasePath: string;
  private readonly lockPath: string;
  private readonly deletionEvidencePath: string;
  private readonly limits: Record<MemoryScope, number>;
  private readonly dailyRetentionDays: number;
  private database: DatabaseSync;
  private records: StoredMemoryRecord[];
  private closed = false;

  private constructor(private readonly options: MemoryStoreOptions, database: DatabaseSync, records: StoredMemoryRecord[]) {
    this.memoryDir = path.join(options.stateDir, "memory");
    this.databasePath = path.join(this.memoryDir, "index.sqlite");
    this.lockPath = path.join(this.memoryDir, ".memory.lock");
    this.deletionEvidencePath = path.join(this.memoryDir, "deletions.jsonl");
    this.limits = {
      user: options.userMaxChars ?? DEFAULT_USER_MAX_CHARS,
      workspace: options.workspaceMaxChars ?? DEFAULT_WORKSPACE_MAX_CHARS,
      daily: options.dailyMaxChars ?? DEFAULT_DAILY_MAX_CHARS,
    };
    this.dailyRetentionDays = options.dailyRetentionDays ?? 30;
    this.database = database;
    this.records = records;
  }

  static async open(options: MemoryStoreOptions): Promise<MemoryStore> {
    validateIdentity(options.profileId, "profileId");
    validateIdentity(options.workspaceId, "workspaceId");
    const memoryDir = path.join(options.stateDir, "memory");
    await ensureManagedDirectory(memoryDir);
    await ensureManagedDirectory(path.join(memoryDir, "daily"));
    const databasePath = path.join(memoryDir, "index.sqlite");
    let records = await readCanonicalRecords(memoryDir);
    const database = await openDerivedDatabase(databasePath);
    await chmod(databasePath, 0o600);
    await chmod(`${databasePath}-wal`, 0o600).catch(() => undefined);
    await chmod(`${databasePath}-shm`, 0o600).catch(() => undefined);
    records = records.map((record) => ({ ...record, status: "active" as const }));
    const store = new MemoryStore(options, database, records);
    store.rebuildIndex();
    return store;
  }

  async add(mutation: MemoryMutation): Promise<MemoryRecord> {
    this.assertOpen();
    validateMutation(mutation, this.limits);
    let created: StoredMemoryRecord | undefined;
    await this.withLockedRecords(async () => {
      const now = new Date().toISOString();
      if (this.records.some((record) => this.isOwned(record) && record.scope === mutation.scope && record.date === mutation.date && record.content === mutation.content)) {
        throw new MemoryPolicyError("That memory entry already exists in this scope.");
      }
      assertScopeBudget(this.records, this.options.profileId, this.options.workspaceId, mutation.scope, mutation.date, mutation.content.length, this.limits[mutation.scope]);
      const record: StoredMemoryRecord = {
        id: randomUUID(),
        scope: mutation.scope,
        content: mutation.content,
        contentHash: hashMemoryContent(mutation.content),
        sourcePath: sourcePathFor(this.memoryDir, mutation.scope, mutation.date),
        provenance: mutation.provenance,
        profileId: this.options.profileId,
        workspaceId: this.options.workspaceId,
        ...(mutation.date ? { date: mutation.date } : {}),
        createdAt: now,
        updatedAt: now,
        status: "active",
      };
      this.records.push(record);
      created = record;
      await this.persistCanonicalRecords();
    });
    if (!created) throw new ComputerNativeError("persistence", "Memory was not created.");
    return toPublicRecord(created);
  }

  async get(id: string, range?: { readonly startLine?: number; readonly endLine?: number }): Promise<MemoryRecord | undefined> {
    this.assertOpen();
    await this.refreshFromCanonical();
    const record = this.records.find((candidate) => candidate.id === id && this.isOwned(candidate));
    if (!record) return undefined;
    if (!range || (range.startLine === undefined && range.endLine === undefined)) return toPublicRecord(record);
    const startLine = range.startLine ?? 1;
    const endLine = range.endLine ?? startLine + 199;
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine > 199) {
      throw new MemoryPolicyError("Memory line range must be positive, ordered, and no larger than 200 lines.");
    }
    return { ...toPublicRecord(record), content: record.content.split("\n").slice(startLine - 1, endLine).join("\n") };
  }

  sourcePath(scope: MemoryScope, date?: string): string {
    return sourcePathFor(this.memoryDir, scope, date);
  }

  validateDraft(scope: MemoryScope, content: string, date?: string): void {
    validateMutation({ scope, content, date, provenance: { source: "model", sourceId: "draft", trust: "model" } }, this.limits);
  }

  async bootstrap(): Promise<readonly MemoryRecord[]> {
    this.assertOpen();
    await this.refreshFromCanonical();
    return this.records
      .filter((record) => this.isOwned(record) && (record.scope === "user" || record.scope === "workspace"))
      .sort((left, right) => left.scope.localeCompare(right.scope) || left.updatedAt.localeCompare(right.updatedAt))
      .map(toPublicRecord);
  }

  async status(): Promise<MemoryStatus> {
    this.assertOpen();
    await this.refreshFromCanonical();
    const owned = this.records.filter((record) => this.isOwned(record));
    return {
      enabled: true,
      entries: owned.length,
      userEntries: owned.filter((record) => record.scope === "user").length,
      workspaceEntries: owned.filter((record) => record.scope === "workspace").length,
      dailyEntries: owned.filter((record) => record.scope === "daily").length,
      indexPath: this.databasePath,
      canonicalPaths: [path.join(this.memoryDir, "USER.md"), path.join(this.memoryDir, "MEMORY.md"), path.join(this.memoryDir, "daily")],
      dailyRetentionDays: this.dailyRetentionDays,
      indexStatus: "ready",
      indexEntries: owned.length,
    };
  }

  async pruneDaily(beforeDate: string): Promise<readonly MemoryRecord[]> {
    this.assertOpen();
    validateDate(beforeDate);
    const removed: StoredMemoryRecord[] = [];
    await this.withLockedRecords(async () => {
      const retained: StoredMemoryRecord[] = [];
      for (const record of this.records) {
        if (this.isOwned(record) && record.scope === "daily" && record.date !== undefined && record.date < beforeDate) removed.push(record);
        else retained.push(record);
      }
      this.records = retained;
      if (removed.length > 0) await this.persistCanonicalRecords();
    });
    return removed.map(toPublicRecord);
  }

  /**
   * Typed seam for a future context owner. Memory does not invent compaction or
   * silently promote transcript text; until that owner exists this is an
   * explicit no-op result rather than a hidden background write.
   */
  async flushBeforeCompaction(_request: MemoryFlushRequest, _signal?: AbortSignal): Promise<MemoryFlushResult> {
    this.assertOpen();
    return { status: "not-supported", recordsWritten: 0, reason: "Context compaction is not owned by the Computer Native memory slice." };
  }

  async replace(input: {
    readonly id: string;
    readonly content: string;
    readonly expectedContentHash: string;
    readonly provenance: MemoryProvenance;
  }): Promise<MemoryRecord> {
    this.assertOpen();
    validateContent(input.content, this.limits.workspace);
    let replaced: StoredMemoryRecord | undefined;
    await this.withLockedRecords(async () => {
      const index = this.records.findIndex((record) => record.id === input.id && this.isOwned(record));
      const current = index >= 0 ? this.records[index] : undefined;
      if (!current) throw new MemoryPolicyError("Memory entry was not found in this profile and workspace.");
      assertCurrentHash(current, input.expectedContentHash);
      validateContent(input.content, this.limits[current.scope]);
      assertScopeBudget(this.records, this.options.profileId, this.options.workspaceId, current.scope, current.date, input.content.length - current.content.length, this.limits[current.scope]);
      replaced = {
        ...current,
        content: input.content,
        contentHash: hashMemoryContent(input.content),
        provenance: input.provenance,
        updatedAt: new Date().toISOString(),
      };
      this.records[index] = replaced;
      await this.persistCanonicalRecords();
    });
    if (!replaced) throw new ComputerNativeError("persistence", "Memory was not replaced.");
    return toPublicRecord(replaced);
  }

  async remove(input: { readonly id: string; readonly expectedContentHash: string; readonly sourceId: string }): Promise<void> {
    this.assertOpen();
    if (input.sourceId.trim().length === 0) throw new MemoryPolicyError("A sourceId is required to remove memory.");
    await this.withLockedRecords(async () => {
      const index = this.records.findIndex((record) => record.id === input.id && this.isOwned(record));
      const current = index >= 0 ? this.records[index] : undefined;
      if (!current) throw new MemoryPolicyError("Memory entry was not found in this profile and workspace.");
      assertCurrentHash(current, input.expectedContentHash);
      const before = this.records;
      const working = [...this.records];
      working.splice(index, 1);
      const evidence = this.createDeletionEvidence(current, before, working, input.sourceId);
      await this.appendDeletionEvidence({ ...evidence, status: "prepared" });
      this.records = working;
      await this.persistCanonicalRecords();
      await this.appendDeletionEvidence({ ...evidence, status: "committed" });
    });
  }

  /**
   * Apply a small consolidation batch under one lock. Canonical files are still
   * published one by one, so this is not advertised as a cross-file transaction.
   */
  async applyBatch(mutations: readonly MemoryBatchMutation[]): Promise<readonly MemoryBatchResult[]> {
    this.assertOpen();
    if (mutations.length === 0 || mutations.length > 8) throw new MemoryPolicyError("Memory batches must contain between 1 and 8 operations.");
    const results: MemoryBatchResult[] = [];
    await this.withLockedRecords(async () => {
      const working = [...this.records];
      const deletions: Array<{ readonly record: StoredMemoryRecord; readonly sourceId: string }> = [];
      for (const mutation of mutations) {
        if (mutation.operation === "add") {
          validateMutation(mutation, this.limits);
          if (working.some((record) => this.isOwned(record) && record.scope === mutation.scope && record.date === mutation.date && record.content === mutation.content)) {
            throw new MemoryPolicyError("That memory entry already exists in this scope.");
          }
          assertScopeBudget(working, this.options.profileId, this.options.workspaceId, mutation.scope, mutation.date, mutation.content.length, this.limits[mutation.scope]);
          const now = new Date().toISOString();
          const record: StoredMemoryRecord = {
            id: randomUUID(),
            scope: mutation.scope,
            content: mutation.content,
            contentHash: hashMemoryContent(mutation.content),
            sourcePath: sourcePathFor(this.memoryDir, mutation.scope, mutation.date),
            provenance: mutation.provenance,
            profileId: this.options.profileId,
            workspaceId: this.options.workspaceId,
            ...(mutation.date ? { date: mutation.date } : {}),
            createdAt: now,
            updatedAt: now,
            status: "active",
          };
          working.push(record);
          results.push({ operation: mutation.operation, record: toPublicRecord(record) });
          continue;
        }
        const index = working.findIndex((record) => record.id === mutation.id && this.isOwned(record));
        const current = index >= 0 ? working[index] : undefined;
        if (!current) throw new MemoryPolicyError("Memory entry was not found in this profile and workspace.");
        assertCurrentHash(current, mutation.expectedContentHash);
        if (mutation.operation === "replace") {
          validateContent(mutation.content, this.limits[current.scope]);
          assertScopeBudget(working, this.options.profileId, this.options.workspaceId, current.scope, current.date, mutation.content.length - current.content.length, this.limits[current.scope]);
          const replaced: StoredMemoryRecord = {
            ...current,
            content: mutation.content,
            contentHash: hashMemoryContent(mutation.content),
            provenance: mutation.provenance,
            updatedAt: new Date().toISOString(),
          };
          working[index] = replaced;
          results.push({ operation: mutation.operation, record: toPublicRecord(replaced) });
        } else {
          working.splice(index, 1);
          deletions.push({ record: current, sourceId: mutation.sourceId });
          results.push({ operation: mutation.operation, recordId: current.id });
        }
      }
      const deletionEvidence = deletions.map(({ record, sourceId }) => this.createDeletionEvidence(record, this.records, working, sourceId));
      for (const evidence of deletionEvidence) await this.appendDeletionEvidence({ ...evidence, status: "prepared" });
      this.records = working;
      await this.persistCanonicalRecords();
      for (const evidence of deletionEvidence) await this.appendDeletionEvidence({ ...evidence, status: "committed" });
    });
    return results;
  }

  async search(input: { readonly query: string; readonly scopes?: readonly MemoryScope[]; readonly maxResults?: number }): Promise<MemorySearchResult[]> {
    this.assertOpen();
    await this.refreshFromCanonical();
    const maxResults = Math.min(Math.max(input.maxResults ?? 10, 1), MAX_SEARCH_RESULTS);
    const scopes = input.scopes ? new Set(input.scopes) : undefined;
    const terms = tokenize(input.query);
    const indexedRows = this.database.prepare("SELECT id, content_hash FROM memory_records WHERE profile_id = ? AND workspace_id = ?").all(this.options.profileId, this.options.workspaceId) as IndexRow[];
    const indexedHashes = new Map(indexedRows.map((row) => [String(row.id), String(row.content_hash)]));
    const candidates = this.records.filter(
      (record) => this.isOwned(record) && indexedHashes.get(record.id) === record.contentHash && (!scopes || scopes.has(record.scope)),
    );
    return candidates
      .map((record) => ({ record, score: scoreRecord(record.content, terms) }))
      .filter(({ score }) => terms.length === 0 || score > 0)
      .sort((left, right) => right.score - left.score || right.record.updatedAt.localeCompare(left.record.updatedAt))
      .slice(0, maxResults)
      .map(({ record, score }) => ({
        recordId: record.id,
        scope: record.scope,
        content: record.content,
        contentHash: record.contentHash,
        sourcePath: record.sourcePath,
        provenance: record.provenance,
        score,
        ...searchLocation(record.content, terms),
        ...(record.date ? { date: record.date } : {}),
      }));
  }

  /**
   * Reconcile an approved memory mutation after the parent stopped before its
   * action record acknowledged the commit. Provenance is the idempotency evidence:
   * a matching record is already durable, so recovery records it and never repeats
   * the write. Removal and batch operations remain failed-closed until their
   * operation-specific evidence is implemented.
   */
  async reconcileAction(action: MemoryActionRecord): Promise<MemoryActionRecord> {
    this.assertOpen();
    if (action.status !== "approved") return action;
    await this.refreshFromCanonical();
    if (action.operation === "remove") return this.reconcileRemoval(action);
    if (action.operation === "batch") return this.reconcileBatch(action);
    if (action.operation !== "add" && action.operation !== "replace") {
      return {
        ...action,
        status: "failed",
        reason: "This memory operation stopped before its terminal evidence was acknowledged and cannot yet be reconciled automatically.",
        recordedAt: new Date().toISOString(),
      };
    }
    const matches = this.records.filter((record) => {
      if (!this.isOwned(record) || record.scope !== action.scope || record.sourcePath !== action.sourcePath || record.provenance.sourceId !== action.callId || record.contentHash !== action.afterContentHash) return false;
      return action.operation === "add" || (action.operation === "replace" && record.id === action.recordId);
    });
    if (matches.length === 1) {
      return {
        ...action,
        status: "committed",
        decision: "allow-once",
        recordId: matches[0]!.id,
        reason: "The durable memory entry matched its approved content hash and call provenance during restart reconciliation.",
        recordedAt: new Date().toISOString(),
      };
    }
    if (matches.length > 1) {
      return {
        ...action,
        status: "failed",
        reason: "Multiple durable memory entries matched the approved call provenance; automatic reconciliation was not safe.",
        recordedAt: new Date().toISOString(),
      };
    }
    return {
      ...action,
      status: "denied",
      decision: "unavailable",
      reason: "No durable memory entry matched the approved call during restart reconciliation; the write was not replayed.",
      recordedAt: new Date().toISOString(),
    };
  }

  private async reconcileRemoval(action: MemoryActionRecord): Promise<MemoryActionRecord> {
    if (!action.recordId || !action.beforeContentHash) return this.failedReconciliation(action, "The approved memory removal did not contain a complete record identity.");
    const evidence = await this.latestDeletionEvidence(action.recordId, action.scope, action.sourcePath, action.beforeContentHash, action.callId);
    if (!evidence) return this.failedReconciliation(action, "No durable deletion evidence matched the approved memory removal; the write was not replayed.");
    const current = this.records.find((record) => this.isOwned(record) && record.id === action.recordId);
    const currentFileHash = await this.canonicalFileHash(action.sourcePath);
    if (!current && currentFileHash === evidence.afterFileHash) {
      return {
        ...action,
        status: "committed",
        decision: "allow-once",
        reason: "The canonical memory file matched its recorded post-removal hash during restart reconciliation.",
        recordedAt: new Date().toISOString(),
      };
    }
    if (current?.contentHash === action.beforeContentHash && currentFileHash === evidence.beforeFileHash) {
      return {
        ...action,
        status: "denied",
        decision: "unavailable",
        reason: "The canonical memory file still matched its pre-removal hash during restart reconciliation; the removal was not replayed.",
        recordedAt: new Date().toISOString(),
      };
    }
    return this.failedReconciliation(action, "The approved memory removal has an ambiguous canonical-file outcome; it was not replayed.");
  }

  private async reconcileBatch(action: MemoryActionRecord): Promise<MemoryActionRecord> {
    if (!action.batch || action.batch.length === 0) return this.failedReconciliation(action, "The approved memory batch has no durable member manifest; it was not replayed.");
    const outcomes = await Promise.all(action.batch.map((item) => this.reconcileBatchItem(item, action.callId)));
    if (outcomes.every((outcome) => outcome === "committed")) {
      return {
        ...action,
        status: "committed",
        decision: "allow-once",
        reason: "Every approved memory batch member matched its canonical record or deletion evidence during restart reconciliation.",
        recordedAt: new Date().toISOString(),
      };
    }
    if (outcomes.every((outcome) => outcome === "not-applied")) {
      return {
        ...action,
        status: "denied",
        decision: "unavailable",
        reason: "No approved memory batch member had been applied when restart reconciliation ran; the batch was not replayed.",
        recordedAt: new Date().toISOString(),
      };
    }
    return this.failedReconciliation(action, "The approved memory batch has a partial or ambiguous canonical outcome; it was not replayed.");
  }

  private async reconcileBatchItem(item: MemoryBatchActionItem, sourceId: string): Promise<"committed" | "not-applied" | "ambiguous"> {
    if (item.operation === "remove") {
      if (!item.recordId || !item.beforeContentHash) return "ambiguous";
      const evidence = await this.latestDeletionEvidence(item.recordId, item.scope, item.sourcePath, item.beforeContentHash, sourceId);
      if (!evidence) return "ambiguous";
      const current = this.records.find((record) => this.isOwned(record) && record.id === item.recordId);
      const currentFileHash = await this.canonicalFileHash(item.sourcePath);
      if (!current && currentFileHash === evidence.afterFileHash) return "committed";
      if (current?.contentHash === item.beforeContentHash && currentFileHash === evidence.beforeFileHash) return "not-applied";
      return "ambiguous";
    }
    const matches = this.records.filter((record) =>
      this.isOwned(record)
      && record.scope === item.scope
      && record.sourcePath === item.sourcePath
      && record.provenance.sourceId === sourceId
      && record.contentHash === item.afterContentHash
      && (item.operation === "add" || record.id === item.recordId),
    );
    return matches.length === 1 ? "committed" : "ambiguous";
  }

  private failedReconciliation(action: MemoryActionRecord, reason: string): MemoryActionRecord {
    return { ...action, status: "failed", reason, recordedAt: new Date().toISOString() };
  }

  private async latestDeletionEvidence(recordId: string, scope: MemoryScope, sourcePath: string, beforeContentHash: string, sourceId: string): Promise<MemoryDeletionEvidence | undefined> {
    const evidence = await readJsonLines<MemoryDeletionEvidence>(this.deletionEvidencePath);
    return evidence.reverse().find((candidate) =>
      candidate.schemaVersion === 1
      && candidate.recordId === recordId
      && candidate.scope === scope
      && candidate.sourcePath === sourcePath
      && candidate.beforeContentHash === beforeContentHash
      && candidate.sourceId === sourceId
      && (candidate.status === "prepared" || candidate.status === "committed"),
    );
  }

  private async canonicalFileHash(filePath: string): Promise<string> {
    const relative = path.relative(this.memoryDir, path.resolve(filePath));
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ComputerNativeError("persistence", "Memory recovery referenced a path outside the managed memory directory.");
    try {
      return hashMemoryContent(await readFile(filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return hashMemoryContent("");
      throw new ComputerNativeError("persistence", "Could not inspect the canonical memory file during recovery.", { cause: error });
    }
  }

  private createDeletionEvidence(record: StoredMemoryRecord, before: readonly StoredMemoryRecord[], after: readonly StoredMemoryRecord[], sourceId: string): MemoryDeletionEvidence {
    const beforeFile = renderMemoryFile(record.sourcePath, before.filter((candidate) => candidate.sourcePath === record.sourcePath));
    const afterFile = renderMemoryFile(record.sourcePath, after.filter((candidate) => candidate.sourcePath === record.sourcePath));
    return {
      schemaVersion: 1,
      recordId: record.id,
      scope: record.scope,
      sourcePath: record.sourcePath,
      beforeContentHash: record.contentHash,
      sourceId,
      beforeFileHash: hashMemoryContent(beforeFile),
      afterFileHash: hashMemoryContent(afterFile),
      status: "prepared",
      recordedAt: new Date().toISOString(),
    };
  }

  private async appendDeletionEvidence(evidence: MemoryDeletionEvidence): Promise<void> {
    await this.options.writeHooks?.beforeWrite?.("deletion-evidence-append", this.deletionEvidencePath);
    await appendJsonLine(this.deletionEvidencePath, evidence);
    await this.options.writeHooks?.afterWrite?.("deletion-evidence-append", this.deletionEvidencePath);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private async withLockedRecords(operation: () => Promise<void>): Promise<void> {
    const lock = await SessionLock.acquire(this.lockPath, { waitMs: 2_000 });
    try {
      this.records = await readCanonicalRecords(this.memoryDir);
      this.records = this.records.map((record) => ({ ...record, status: "active" as const }));
      await operation();
      this.rebuildIndex();
    } finally {
      await lock.release();
    }
  }

  private async refreshFromCanonical(): Promise<void> {
    const canonical = (await readCanonicalRecords(this.memoryDir)).map((record) => ({ ...record, status: "active" as const }));
    if (sameRecordSet(this.records, canonical)) return;
    this.records = canonical;
    // Canonical Markdown is authoritative. Reconciliation only repairs the
    // disposable index; it never writes canonical memory during a read.
    this.rebuildIndex();
  }

  private async persistCanonicalRecords(): Promise<void> {
    const byPath = new Map<string, StoredMemoryRecord[]>();
    for (const record of this.records) {
      const records = byPath.get(record.sourcePath) ?? [];
      records.push(record);
      byPath.set(record.sourcePath, records);
    }
    const paths = [
      path.join(this.memoryDir, "USER.md"),
      path.join(this.memoryDir, "MEMORY.md"),
      ...(await dailyFiles(this.memoryDir)).map((file) => file.filePath),
      ...this.records.filter((record) => record.scope === "daily").map((record) => record.sourcePath),
    ];
    for (const filePath of new Set(paths)) {
      const records = byPath.get(filePath) ?? [];
      await this.writeCanonicalFile(filePath, renderMemoryFile(filePath, records));
    }
  }

  private async writeCanonicalFile(filePath: string, content: string): Promise<void> {
    await this.options.writeHooks?.beforeWrite?.("canonical-replace", filePath);
    await atomicWriteText(filePath, content);
    await this.options.writeHooks?.afterWrite?.("canonical-replace", filePath);
  }

  private rebuildIndex(): void {
    this.database.exec("DELETE FROM memory_records;");
    const statement = this.database.prepare(`
      INSERT INTO memory_records
        (id, profile_id, workspace_id, scope, content, content_hash, source_path, source, source_id, trust, date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const record of this.records) {
      statement.run(
        record.id,
        record.profileId,
        record.workspaceId,
        record.scope,
        record.content,
        record.contentHash,
        record.sourcePath,
        record.provenance.source,
        record.provenance.sourceId,
        record.provenance.trust,
        record.date ?? null,
        record.createdAt,
        record.updatedAt,
      );
    }
  }

  private isOwned(record: StoredMemoryRecord): boolean {
    return record.profileId === this.options.profileId && record.workspaceId === this.options.workspaceId;
  }

  private assertOpen(): void {
    if (this.closed) throw new ComputerNativeError("persistence", "Memory store is closed.");
  }
}

async function openDerivedDatabase(databasePath: string): Promise<DatabaseSync> {
  try {
    const information = await lstat(databasePath);
    if (information.isSymbolicLink() || !information.isFile()) throw new ComputerNativeError("persistence", "The durable memory index must be a regular file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { timeout: 2_000 });
    initialiseDatabase(database);
    return database;
  } catch (error) {
    try {
      database?.close();
    } catch {
      // A failed open may not be closable; the canonical Markdown is unaffected.
    }
    try {
      await rename(databasePath, `${databasePath}.corrupt-${Date.now()}-${randomUUID()}`);
    } catch (renameError) {
      throw new ComputerNativeError("persistence", "The durable memory index is corrupt and could not be moved aside for rebuild.", { cause: renameError });
    }
    try {
      const rebuilt = new DatabaseSync(databasePath, { timeout: 2_000 });
      initialiseDatabase(rebuilt);
      return rebuilt;
    } catch (rebuildError) {
      throw new ComputerNativeError("persistence", "The durable memory index could not be rebuilt from canonical memory.", { cause: rebuildError ?? error });
    }
  }
}

function initialiseDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS memory_records (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source_path TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      trust TEXT NOT NULL,
      date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS memory_records_owner_idx ON memory_records(profile_id, workspace_id, scope);
  `);
}

async function readCanonicalRecords(memoryDir: string): Promise<StoredMemoryRecord[]> {
  const files = [
    { filePath: path.join(memoryDir, "USER.md"), scope: "user" as const },
    { filePath: path.join(memoryDir, "MEMORY.md"), scope: "workspace" as const },
    ...await dailyFiles(memoryDir),
  ];
  const records: StoredMemoryRecord[] = [];
  for (const file of files) {
    let content: string;
    try {
      const information = await lstat(file.filePath);
      if (information.isSymbolicLink() || !information.isFile()) throw new ComputerNativeError("persistence", `Memory file '${path.basename(file.filePath)}' must be a regular file.`);
      content = await readFile(file.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new ComputerNativeError("persistence", `Could not read memory file '${path.basename(file.filePath)}'.`, { cause: error });
    }
    records.push(...parseMemoryFile(content, file.filePath, file.scope));
  }
  return records;
}

async function dailyFiles(memoryDir: string): Promise<Array<{ filePath: string; scope: "daily"; date: string }>> {
  const directory = path.join(memoryDir, "daily");
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({ filePath: path.join(directory, entry.name), scope: "daily" as const, date: entry.name.slice(0, -3) }));
}

function parseMemoryFile(content: string, filePath: string, expectedScope: MemoryScope): StoredMemoryRecord[] {
  const records: StoredMemoryRecord[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf(MEMORY_START, cursor);
    if (start < 0) {
      if (content.slice(cursor).trim().length > 0 && !content.slice(cursor).trim().startsWith("#")) {
        throw new ComputerNativeError("persistence", `Memory file '${path.basename(filePath)}' contains unmarked content.`);
      }
      break;
    }
    const metadataEnd = content.indexOf(" -->", start);
    const bodyStart = metadataEnd + 5;
    const end = content.indexOf(MEMORY_END, bodyStart);
    if (metadataEnd < 0 || end < 0) throw new ComputerNativeError("persistence", `Memory file '${path.basename(filePath)}' contains an incomplete entry.`);
    const metadata = decodeMetadata(content.slice(start + MEMORY_START.length, metadataEnd));
    const entryContent = content.slice(bodyStart, end).replace(/^\n/u, "").replace(/\n$/u, "");
    if (metadata.scope !== expectedScope || !/^[a-f0-9]{64}$/u.test(metadata.contentHash)) {
      throw new ComputerNativeError("persistence", `Memory file '${path.basename(filePath)}' failed its integrity check.`);
    }
    try {
      validateProvenance(metadata.provenance);
      validateIdentity(metadata.profileId, "profileId");
      validateIdentity(metadata.workspaceId, "workspaceId");
      if (metadata.scope === "daily") {
        if (!metadata.date) throw new Error("missing daily date");
        validateDate(metadata.date);
      } else if (metadata.date !== undefined) {
        throw new Error("non-daily entry has a date");
      }
    } catch (error) {
      throw new ComputerNativeError("persistence", `Memory file '${path.basename(filePath)}' contains invalid entry metadata.`, { cause: error });
    }
    if (metadata.contentHash !== hashMemoryContent(entryContent)) {
      throw new ComputerNativeError("persistence", `Memory file '${path.basename(filePath)}' failed its integrity check.`);
    }
    records.push({
      ...metadata,
      content: entryContent,
      sourcePath: filePath,
      status: "active",
    });
    cursor = end + MEMORY_END.length;
  }
  return records;
}

function decodeMetadata(encoded: string): MemoryFileMetadata {
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<MemoryFileMetadata>;
    if (
      typeof value.id !== "string" ||
      typeof value.scope !== "string" ||
      typeof value.contentHash !== "string" ||
      !value.provenance ||
      typeof value.profileId !== "string" ||
      typeof value.workspaceId !== "string" ||
      typeof value.createdAt !== "string" ||
      typeof value.updatedAt !== "string"
    ) throw new Error("missing metadata");
    return value as MemoryFileMetadata;
  } catch (error) {
    throw new ComputerNativeError("persistence", "A memory entry has invalid metadata.", { cause: error });
  }
}

function renderMemoryFile(filePath: string, records: readonly StoredMemoryRecord[]): string {
  const title = path.basename(filePath, ".md");
  const blocks = records.map((record) => {
    const metadata: MemoryFileMetadata = {
      id: record.id,
      scope: record.scope,
      contentHash: record.contentHash,
      provenance: record.provenance,
      profileId: record.profileId,
      workspaceId: record.workspaceId,
      ...(record.date ? { date: record.date } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    const encoded = Buffer.from(JSON.stringify(metadata), "utf8").toString("base64url");
    return `${MEMORY_START}${encoded} -->\n${record.content}\n${MEMORY_END}`;
  });
  return `# ${title}\n\n${blocks.join("\n\n")}${blocks.length > 0 ? "\n" : ""}`;
}

async function atomicWriteText(filePath: string, content: string): Promise<void> {
  await ensureDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw new ComputerNativeError("persistence", `Could not replace memory file '${path.basename(filePath)}'.`, { cause: error });
  }
}

async function ensureManagedDirectory(directory: string): Promise<void> {
  try {
    const information = await lstat(directory);
    if (!information.isDirectory() || information.isSymbolicLink()) {
      throw new ComputerNativeError("persistence", `Memory path '${path.basename(directory)}' must be a private real directory.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await ensureDirectory(directory);
  }
  await chmod(directory, 0o700);
}

function validateMutation(mutation: MemoryMutation, limits: Record<MemoryScope, number>): void {
  if (!Object.hasOwn({ user: true, workspace: true, daily: true }, mutation.scope)) throw new MemoryPolicyError("Unsupported memory scope.");
  validateContent(mutation.content, limits[mutation.scope]);
  validateProvenance(mutation.provenance);
  if (mutation.scope === "daily" && (!mutation.date || !/^\d{4}-\d{2}-\d{2}$/u.test(mutation.date))) {
    throw new MemoryPolicyError("Daily memory requires a valid YYYY-MM-DD date.");
  }
  if (mutation.scope !== "daily" && mutation.date !== undefined) throw new MemoryPolicyError("Only daily memory may have a date.");
}

function validateContent(content: string, maxChars: number): void {
  if (typeof content !== "string" || content.trim().length === 0) throw new MemoryPolicyError("Memory content cannot be empty.");
  if (content.length > maxChars) throw new MemoryPolicyError(`Memory content exceeds its ${maxChars}-character budget.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u.test(content)) {
    throw new MemoryPolicyError("Memory content contains invisible or control characters.");
  }
  if (/(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions|reveal\s+(?:the\s+)?(?:api\s*key|secret)|system\s+message|developer\s+message/i.test(content)) {
    throw new MemoryPolicyError("Memory content looks like an instruction-injection attempt.");
  }
  if (/bearer\s+[A-Za-z0-9._~+/=-]+|-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----|(?:api[_ -]?key|secret|password|passwd|cookie|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+/i.test(content)) {
    throw new MemoryPolicyError("Memory content looks like a credential or secret.");
  }
}

function validateProvenance(provenance: MemoryProvenance): void {
  if (!provenance || !provenance.sourceId.trim()) throw new MemoryPolicyError("Memory provenance requires a sourceId.");
  if (!["user", "model", "tool", "browser", "system"].includes(provenance.source)) throw new MemoryPolicyError("Unsupported memory source.");
  if (!["user", "model", "local", "untrusted"].includes(provenance.trust)) throw new MemoryPolicyError("Unsupported memory trust level.");
}

function validateIdentity(value: string, label: string): void {
  if (!value || value.length > 128 || /[\u0000/\\]/u.test(value)) throw new MemoryPolicyError(`${label} is invalid.`);
}

function validateDate(date: string): void {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new MemoryPolicyError("Daily memory requires a valid calendar date.");
  }
}

function sourcePathFor(memoryDir: string, scope: MemoryScope, date?: string): string {
  if (scope === "daily") {
    if (!date) throw new MemoryPolicyError("Daily memory requires a date.");
    validateDate(date);
    return path.join(memoryDir, "daily", `${date}.md`);
  }
  return path.join(memoryDir, scope === "user" ? "USER.md" : "MEMORY.md");
}

function assertCurrentHash(record: StoredMemoryRecord, expectedContentHash: string): void {
  if (record.contentHash !== expectedContentHash) throw new MemoryPolicyError("Memory entry changed since it was read; refresh it before editing.");
}

function assertScopeBudget(
  records: readonly StoredMemoryRecord[],
  profileId: string,
  workspaceId: string,
  scope: MemoryScope,
  date: string | undefined,
  contentDelta: number,
  budget: number,
): void {
  const current = records
    .filter((record) => record.profileId === profileId && record.workspaceId === workspaceId && record.scope === scope && record.date === date)
    .reduce((total, record) => total + record.content.length, 0);
  if (current + contentDelta > budget) throw new MemoryPolicyError(`Memory scope exceeds its ${budget}-character budget.`);
}

export function hashMemoryContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function tokenize(query: string): string[] {
  return query.toLocaleLowerCase().split(/\s+/u).map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, "")).filter((term) => term.length > 0);
}

function scoreRecord(content: string, terms: readonly string[]): number {
  const normalized = content.toLocaleLowerCase();
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

function searchLocation(content: string, terms: readonly string[]): { readonly sourceLine?: number; readonly snippet?: string } {
  const lines = content.split("\n");
  const lineIndex = terms.length === 0
    ? 0
    : lines.findIndex((line) => terms.some((term) => line.toLocaleLowerCase().includes(term)));
  if (lineIndex < 0) return {};
  return { sourceLine: lineIndex + 1, snippet: lines[lineIndex]?.slice(0, 480) };
}

function toPublicRecord(record: StoredMemoryRecord): MemoryRecord {
  const { status: _status, ...publicRecord } = record;
  return publicRecord;
}

function sameRecordSet(left: readonly StoredMemoryRecord[], right: readonly StoredMemoryRecord[]): boolean {
  if (left.length !== right.length) return false;
  const key = (record: StoredMemoryRecord): string => `${record.id}\u0000${record.contentHash}\u0000${record.updatedAt}\u0000${record.sourcePath}`;
  const rightKeys = new Set(right.map(key));
  return left.every((record) => rightKeys.has(key(record)));
}
