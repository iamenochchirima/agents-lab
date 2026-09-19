import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DEFAULT_STUDIO_MEMORY_LIMITS,
  type StudioMemoryApplyResult,
  type StudioMemoryDecision,
  type StudioMemoryLimits,
  type StudioMemoryMutation,
  type StudioMemoryNamespace,
  type StudioMemoryRecord,
  type StudioMemoryRepository,
  type StudioMemorySeed,
  type StudioMemoryState,
} from "./contracts.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

interface StudioMemoryJournalEvent {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly operationIds: readonly string[];
  readonly decisions: readonly StudioMemoryDecision[];
  readonly state: StudioMemoryState;
}

export class StudioMemoryRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioMemoryRepositoryError";
  }
}

export class StudioMemoryConflictError extends StudioMemoryRepositoryError {
  constructor(message: string) {
    super(message);
    this.name = "StudioMemoryConflictError";
  }
}

export class StudioMemoryCorruptStateError extends StudioMemoryRepositoryError {
  constructor(readonly path: string) {
    super(`Studio Memory state is corrupt: ${path}`);
    this.name = "StudioMemoryCorruptStateError";
  }
}

export class InMemoryStudioMemoryRepository implements StudioMemoryRepository {
  private state: StudioMemoryState;
  private readonly operations = new Map<string, StudioMemoryApplyResult>();

  constructor(
    readonly namespace: StudioMemoryNamespace,
    private readonly limits: StudioMemoryLimits = DEFAULT_STUDIO_MEMORY_LIMITS,
  ) {
    this.state = emptyState(namespace);
  }

  async load(): Promise<StudioMemoryState> {
    return cloneState(this.state);
  }

  async seed(seeds: readonly StudioMemorySeed[], operationId: string): Promise<StudioMemoryApplyResult> {
    const mutations = seeds.map((seed, index) => ({
      operationId: `${operationId}:${index + 1}`,
      operation: "add" as const,
      candidate: seedToCandidate(seed),
      reason: "Seeded by the fixed Memory fixture.",
    }));
    return this.apply(mutations);
  }

  async apply(mutations: readonly StudioMemoryMutation[]): Promise<StudioMemoryApplyResult> {
    const existingResults = mutations
      .map((mutation) => this.operations.get(mutation.operationId))
      .filter((result): result is StudioMemoryApplyResult => result !== undefined);
    if (existingResults.length === mutations.length && mutations.length > 0) {
      return cloneApplyResult(existingResults.at(-1)!);
    }
    if (existingResults.length > 0) {
      throw new StudioMemoryConflictError("A Memory operation batch mixes previously applied and new operation IDs.");
    }
    const applied = applyMutations(this.state, mutations, this.limits);
    this.state = applied.state;
    for (const mutation of mutations) this.operations.set(mutation.operationId, applied);
    return cloneApplyResult(applied);
  }
}

export class FileStudioMemoryRepository implements StudioMemoryRepository {
  private readonly recordsPath: string;
  private readonly journalPath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly rootDirectory: string,
    readonly namespace: StudioMemoryNamespace,
    private readonly limits: StudioMemoryLimits = DEFAULT_STUDIO_MEMORY_LIMITS,
  ) {
    assertNamespace(namespace);
    this.recordsPath = join(rootDirectory, "records.json");
    this.journalPath = join(rootDirectory, "events.jsonl");
  }

  load(): Promise<StudioMemoryState> {
    return this.enqueue(() => this.loadNow());
  }

  seed(seeds: readonly StudioMemorySeed[], operationId: string): Promise<StudioMemoryApplyResult> {
    const mutations = seeds.map((seed, index) => ({
      operationId: `${operationId}:${index + 1}`,
      operation: "add" as const,
      candidate: seedToCandidate(seed),
      reason: "Seeded by the fixed Memory fixture.",
    }));
    return this.apply(mutations);
  }

  apply(mutations: readonly StudioMemoryMutation[]): Promise<StudioMemoryApplyResult> {
    return this.enqueue(() => this.applyNow(mutations));
  }

  private async loadNow(): Promise<StudioMemoryState> {
    await mkdir(this.rootDirectory, { recursive: true });
    const snapshot = await readOptionalJson<StudioMemoryState>(this.recordsPath);
    const journal = await readJournal(this.journalPath, this.namespace, this.limits);
    const latest = journal.at(-1)?.state;
    if (snapshot && latest && latest.revision >= snapshot.revision) return validateState(latest, this.namespace, this.limits, this.recordsPath);
    if (snapshot) return validateState(snapshot, this.namespace, this.limits, this.recordsPath);
    if (latest) return validateState(latest, this.namespace, this.limits, this.journalPath);
    return emptyState(this.namespace);
  }

  private async applyNow(mutations: readonly StudioMemoryMutation[]): Promise<StudioMemoryApplyResult> {
    if (mutations.length === 0) {
      const state = await this.loadNow();
      return { state, decisions: [], appliedOperationIds: [] };
    }
    const journal = await readJournal(this.journalPath, this.namespace, this.limits);
    const appliedOperations = new Map<string, StudioMemoryApplyResult>();
    for (const event of journal) {
      const result: StudioMemoryApplyResult = {
        state: event.state,
        decisions: event.decisions,
        appliedOperationIds: event.operationIds,
      };
      for (const operationId of event.operationIds) appliedOperations.set(operationId, result);
    }
    const existing = mutations.map((mutation) => appliedOperations.get(mutation.operationId));
    if (existing.every((result): result is StudioMemoryApplyResult => result !== undefined)) {
      return cloneApplyResult(existing.at(-1)!);
    }
    if (existing.some((result) => result !== undefined)) {
      throw new StudioMemoryConflictError("A Memory operation batch mixes previously applied and new operation IDs.");
    }
    const state = journal.at(-1)?.state ?? await this.loadNow();
    const result = applyMutations(state, mutations, this.limits);
    const event: StudioMemoryJournalEvent = {
      schemaVersion: 1,
      sequence: journal.length + 1,
      operationIds: result.appliedOperationIds,
      decisions: result.decisions,
      state: result.state,
    };
    const serialized = `${stableJson(event)}\n`;
    const currentJournalBytes = journal.reduce((total, item) => total + Buffer.byteLength(stableJson(item), "utf8") + 1, 0);
    if (currentJournalBytes + Buffer.byteLength(serialized, "utf8") > this.limits.maxJournalBytes) {
      throw new StudioMemoryRepositoryError("Studio Memory journal exceeded its configured limit.");
    }
    await mkdir(this.rootDirectory, { recursive: true });
    await appendFile(this.journalPath, serialized, { encoding: "utf8" });
    await atomicWriteJson(this.recordsPath, result.state);
    return result;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(operation);
    this.queue = next;
    return next;
  }
}

function applyMutations(
  input: StudioMemoryState,
  mutations: readonly StudioMemoryMutation[],
  limits: StudioMemoryLimits,
): StudioMemoryApplyResult {
  const records = new Map(input.records.map((record) => [record.recordId, record]));
  const decisions: StudioMemoryDecision[] = [];
  let revision = input.revision;
  for (const mutation of mutations) {
    assertOperationId(mutation.operationId);
    const target = mutation.targetRecordId ? records.get(mutation.targetRecordId) : undefined;
    const candidate = mutation.candidate;
    let recordId: string | null = target?.recordId ?? null;
    let changed = false;
    if (mutation.operation === "add" || mutation.operation === "update") {
      if (!candidate) throw new StudioMemoryRepositoryError(`Memory ${mutation.operation} requires a candidate.`);
      const next = materializeRecord(input.namespace, candidate, mutation, target, revision + 1, limits);
      if (mutation.operation === "update" && target) {
        records.set(target.recordId, { ...target, state: "superseded", updatedAt: next.updatedAt });
      }
      records.set(next.recordId, next);
      recordId = next.recordId;
      changed = true;
    } else if (mutation.operation === "delete" || mutation.operation === "expire") {
      if (target) {
        records.set(target.recordId, {
          ...target,
          state: mutation.operation === "expire" ? "expired" : "discarded",
          updatedAt: new Date().toISOString(),
        });
        recordId = target.recordId;
        changed = true;
      }
    }
    if (changed) revision += 1;
    decisions.push({
      operationId: mutation.operationId,
      operation: mutation.operation,
      recordId,
      targetRecordId: mutation.targetRecordId ?? null,
      logicalKey: candidate?.logicalKey ?? target?.logicalKey ?? null,
      scope: candidate?.scope ?? target?.scope ?? null,
      reason: mutation.reason,
      stateRevision: revision,
    });
  }
  const state: StudioMemoryState = {
    schemaVersion: 1,
    namespace: input.namespace,
    revision,
    records: [...records.values()].sort((left, right) => left.recordId.localeCompare(right.recordId)),
  };
  validateState(state, input.namespace, limits, "memory-state");
  return { state, decisions, appliedOperationIds: mutations.map((mutation) => mutation.operationId) };
}

function materializeRecord(
  namespace: StudioMemoryNamespace,
  candidate: NonNullable<StudioMemoryMutation["candidate"]>,
  mutation: StudioMemoryMutation,
  target: StudioMemoryRecord | undefined,
  revision: number,
  limits: StudioMemoryLimits,
): StudioMemoryRecord {
  const recordId = target && mutation.operation === "update"
    ? `${target.recordId}-r${revision}`
    : candidate.recordId ?? `${mutation.operationId.replace(/[^A-Za-z0-9_-]/g, "-")}-record`;
  assertSafeId(recordId, "Memory record ID");
  const now = candidate.createdAt;
  const record: StudioMemoryRecord = {
    schemaVersion: 1,
    recordId,
    namespace,
    scope: candidate.scope,
    content: candidate.content,
    logicalKey: candidate.logicalKey ?? null,
    source: candidate.source,
    sourceMessageIds: [...(candidate.sourceMessageIds ?? [])],
    createdAt: target?.createdAt ?? candidate.createdAt,
    updatedAt: now,
    revision,
    state: "active",
    supersedesRecordId: target?.recordId ?? null,
    expiresAt: candidate.expiresAt ?? null,
    metadata: { ...(candidate.metadata ?? {}) },
  };
  validateRecord(record, limits, "memory-record");
  return record;
}

function seedToCandidate(seed: StudioMemorySeed) {
  return {
    recordId: seed.recordId,
    scope: seed.scope,
    content: seed.content,
    logicalKey: seed.logicalKey ?? null,
    source: seed.source,
    sourceMessageIds: [...(seed.sourceMessageIds ?? [])],
    createdAt: seed.createdAt,
    expiresAt: seed.expiresAt ?? null,
    metadata: { ...(seed.metadata ?? {}), "seed-created-at": seed.createdAt },
  };
}

function emptyState(namespace: StudioMemoryNamespace): StudioMemoryState {
  return { schemaVersion: 1, namespace, revision: 0, records: [] };
}

async function readJournal(path: string, namespace: StudioMemoryNamespace, limits: StudioMemoryLimits): Promise<readonly StudioMemoryJournalEvent[]> {
  const contents = await readOptionalText(path);
  if (contents === null) return [];
  if (Buffer.byteLength(contents, "utf8") > limits.maxJournalBytes) throw new StudioMemoryCorruptStateError(path);
  const lines = contents.split("\n").filter((line) => line.length > 0);
  return lines.map((line) => {
    let event: StudioMemoryJournalEvent;
    try {
      event = JSON.parse(line) as StudioMemoryJournalEvent;
    } catch {
      throw new StudioMemoryCorruptStateError(path);
    }
    if (event.schemaVersion !== 1 || !Number.isInteger(event.sequence) || event.sequence < 1 || event.state.namespace.comparisonId !== namespace.comparisonId || event.state.namespace.trialId !== namespace.trialId) {
      throw new StudioMemoryCorruptStateError(path);
    }
    return validateJournalEvent(event, path, lines.length, namespace, limits);
  });
}

function validateJournalEvent(
  event: StudioMemoryJournalEvent,
  path: string,
  _lineCount: number,
  namespace: StudioMemoryNamespace,
  limits: StudioMemoryLimits,
): StudioMemoryJournalEvent {
  validateState(event.state, namespace, limits, path);
  if (event.operationIds.length !== event.decisions.length || event.operationIds.some((operationId) => !event.decisions.some((decision) => decision.operationId === operationId))) {
    throw new StudioMemoryCorruptStateError(path);
  }
  return event;
}

function validateState(state: StudioMemoryState, namespace: StudioMemoryNamespace, limits: StudioMemoryLimits, path: string): StudioMemoryState {
  if (state.schemaVersion !== 1 || stableJson(state.namespace) !== stableJson(namespace) || !Number.isInteger(state.revision) || state.revision < 0 || state.records.length > limits.maxRecords) {
    throw new StudioMemoryCorruptStateError(path);
  }
  for (const record of state.records) validateRecord(record, limits, path);
  return state;
}

function validateRecord(record: StudioMemoryRecord, limits: StudioMemoryLimits, path: string): void {
  if (record.schemaVersion !== 1 || !SAFE_ID.test(record.recordId) || !record.content || Buffer.byteLength(record.content, "utf8") > limits.maxContentBytes || Buffer.byteLength(stableJson(record), "utf8") > limits.maxRecordBytes || !SAFE_KEY.test(record.source) || !Number.isInteger(record.revision) || record.revision < 1) {
    throw new StudioMemoryCorruptStateError(path);
  }
  if (record.logicalKey !== null && !SAFE_KEY.test(record.logicalKey)) throw new StudioMemoryCorruptStateError(path);
  if (!["working", "episodic", "semantic", "procedural"].includes(record.scope)) throw new StudioMemoryCorruptStateError(path);
  if (!["active", "superseded", "discarded", "expired"].includes(record.state)) throw new StudioMemoryCorruptStateError(path);
}

function assertNamespace(namespace: StudioMemoryNamespace): void {
  assertSafeId(namespace.comparisonId, "Memory comparison ID");
  assertSafeId(namespace.trialId, "Memory trial ID");
  assertSafeId(namespace.scenarioId, "Memory scenario ID");
  assertSafeId(namespace.sessionId, "Memory session ID");
}

function assertOperationId(value: string): void {
  if (!SAFE_KEY.test(value)) throw new StudioMemoryRepositoryError(`Invalid Memory operation ID: ${value}`);
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new StudioMemoryRepositoryError(`${label} is invalid.`);
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${stableJson(value)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  const contents = await readOptionalText(path);
  if (contents === null) return null;
  try {
    return JSON.parse(contents) as T;
  } catch {
    throw new StudioMemoryCorruptStateError(path);
  }
}

function cloneState(state: StudioMemoryState): StudioMemoryState {
  return JSON.parse(JSON.stringify(state)) as StudioMemoryState;
}

function cloneApplyResult(result: StudioMemoryApplyResult): StudioMemoryApplyResult {
  return JSON.parse(JSON.stringify(result)) as StudioMemoryApplyResult;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
