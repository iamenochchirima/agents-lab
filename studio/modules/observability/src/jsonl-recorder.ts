import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentEvent, JsonValue, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import { parseObservabilityConfig, type ObservabilityConfig } from "./config.js";
import {
  ObservabilityError,
  type ModuleDetail,
  type ObservabilityDependencies,
  type ObservabilityModule,
  type ObservedEvent,
  type ObservationAppendReceipt,
  type ObservationFlushReceipt,
} from "./contract.js";

const IDENTITY: ModuleIdentity = Object.freeze({ id: "jsonl-observability-recorder", version: "0.1.0" });

interface IndexedEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly fingerprint: string;
  durable: boolean;
}

interface QueuedEvent {
  readonly observed: ObservedEvent;
  readonly eventId: string;
  readonly sequence: number;
  readonly fingerprint: string;
  readonly line: string;
}

interface StoredLineRead {
  readonly events: readonly QueuedEvent[];
  readonly completeByteLength: number;
  readonly hadIncompleteTail: boolean;
}

/**
 * Run-scoped JSONL recorder. A successful durable receipt follows file and
 * directory sync; ambiguous writes stay pending until a later flush reconciles
 * them against the file.
 */
class JsonlObservabilityRecorder implements ObservabilityModule {
  readonly identity = IDENTITY;

  private readonly rootDirectory: string;
  private readonly runDirectory: string;
  private readonly eventFile: string;
  private readonly indexedById = new Map<string, IndexedEvent>();
  private readonly indexedBySequence = new Map<number, IndexedEvent>();
  private readonly pending: QueuedEvent[] = [];
  private pendingBytes = 0;
  private storedByteLength = 0;
  private lastAcceptedSequence = -1;
  private durableThroughSequence: number | null = null;
  private loaded = false;
  private needsReconciliation = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: ObservabilityConfig,
    private readonly scope: RunScope,
    rootDirectory: string,
  ) {
    this.rootDirectory = resolve(rootDirectory);
    const runDirectoryName = `run-${encodeURIComponent(scope.runId)}`;
    if (runDirectoryName.length > 200) {
      throw new ObservabilityError("INVALID_OBSERVABILITY_INPUT", "Encoded runId is too long for a local directory name.");
    }
    this.runDirectory = join(this.rootDirectory, runDirectoryName);
    this.eventFile = join(this.runDirectory, "events.jsonl");
  }

  async append(inputValue: ObservedEvent, signal: AbortSignal): Promise<ObservationAppendReceipt> {
    assertSignal(signal);
    throwIfCancelled(signal);
    const invalidIdentity = receiptIdentity(inputValue);
    const candidate = validateObservedEvent(inputValue, this.scope.runId, this.config);
    if (candidate.kind === "invalid") {
      return Object.freeze({
        status: "rejected",
        eventId: invalidIdentity.eventId,
        sequence: invalidIdentity.sequence,
        reason: "invalid",
      });
    }

    return this.withLock(async () => {
      throwIfCancelled(signal);
      await this.ensureLoaded();
      throwIfCancelled(signal);

      const existingById = this.indexedById.get(candidate.eventId);
      if (existingById) {
        if (existingById.fingerprint !== candidate.fingerprint || existingById.sequence !== candidate.sequence) {
          return rejected(candidate, "conflicting-duplicate");
        }
        return Object.freeze({
          status: "duplicate",
          eventId: candidate.eventId,
          sequence: candidate.sequence,
          persistence: existingById.durable ? "durable" : "buffered",
        });
      }

      const existingBySequence = this.indexedBySequence.get(candidate.sequence);
      if (existingBySequence) return rejected(candidate, "conflicting-duplicate");
      if (candidate.sequence <= this.lastAcceptedSequence) return rejected(candidate, "out-of-order");
      if (this.indexedById.size >= this.config.maxTrackedEvents) return rejected(candidate, "capacity");
      if (this.pending.length >= this.config.maxBufferedEvents
        || this.pendingBytes + utf8Bytes(candidate.line) + 1 > this.config.maxBufferedBytes) {
        return rejected(candidate, "capacity");
      }
      if (this.storedByteLength + this.pendingBytes + utf8Bytes(candidate.line) + 1 > this.config.maxStoredBytes) {
        return rejected(candidate, "capacity");
      }

      const indexed: IndexedEvent = {
        eventId: candidate.eventId,
        sequence: candidate.sequence,
        fingerprint: candidate.fingerprint,
        durable: false,
      };
      this.indexedById.set(candidate.eventId, indexed);
      this.indexedBySequence.set(candidate.sequence, indexed);
      this.lastAcceptedSequence = candidate.sequence;
      this.pending.push(candidate);
      this.pendingBytes += utf8Bytes(candidate.line) + 1;

      if (this.pending.length < this.config.flushEveryEvents) {
        return Object.freeze({ status: "accepted", eventId: candidate.eventId, sequence: candidate.sequence, persistence: "buffered" });
      }

      const flush = await this.flushLocked(signal);
      if (flush.status === "partial" && this.pending.some((event) => event.eventId === candidate.eventId)) {
        return Object.freeze({ status: "accepted", eventId: candidate.eventId, sequence: candidate.sequence, persistence: "buffered" });
      }
      if (flush.status === "durable" && candidate.sequence <= (flush.durableThroughSequence ?? -1)) {
        return Object.freeze({ status: "accepted", eventId: candidate.eventId, sequence: candidate.sequence, persistence: "durable" });
      }
      if (this.pending.some((event) => event.eventId === candidate.eventId)) {
        return Object.freeze({ status: "uncertain", eventId: candidate.eventId, sequence: candidate.sequence, persistence: "unknown" });
      }
      return Object.freeze({ status: "accepted", eventId: candidate.eventId, sequence: candidate.sequence, persistence: "durable" });
    });
  }

  async flush(scopeValue: RunScope, signal: AbortSignal): Promise<ObservationFlushReceipt> {
    assertSignal(signal);
    if (!isRecord(scopeValue) || scopeValue.runId !== this.scope.runId) {
      return Object.freeze({
        status: "failed",
        durableThroughSequence: this.durableThroughSequence,
        pendingEvents: this.pending.length,
        failure: { code: "OBSERVABILITY_RUN_MISMATCH", message: "Flush scope does not match this run-scoped recorder.", retryable: false },
      });
    }
    if (signal.aborted) {
      return Object.freeze({
        status: this.pending.length === 0 && !this.needsReconciliation ? "durable" : "partial",
        durableThroughSequence: this.durableThroughSequence,
        pendingEvents: this.pending.length,
        ...(this.pending.length === 0 && !this.needsReconciliation ? {} : { failure: { code: "OBSERVABILITY_CANCELLED", message: "Flush was cancelled before storage began.", retryable: true } }),
      });
    }

    return this.withLock(async () => {
      if (signal.aborted) {
        return Object.freeze({
          status: this.pending.length === 0 && !this.needsReconciliation ? "durable" : "partial",
          durableThroughSequence: this.durableThroughSequence,
          pendingEvents: this.pending.length,
          ...(this.pending.length === 0 && !this.needsReconciliation ? {} : { failure: { code: "OBSERVABILITY_CANCELLED", message: "Flush was cancelled before storage began.", retryable: true } }),
        });
      }
      try {
        await this.ensureLoaded();
      } catch (error) {
        return Object.freeze({
          status: "failed",
          durableThroughSequence: this.durableThroughSequence,
          pendingEvents: this.pending.length,
          failure: {
            code: isObservabilityError(error) ? error.code : "OBSERVABILITY_STORAGE_FAILURE",
            message: errorMessage(error),
            retryable: false,
          },
        });
      }
      if (signal.aborted) {
        return Object.freeze({
          status: this.pending.length === 0 && !this.needsReconciliation ? "durable" : "partial",
          durableThroughSequence: this.durableThroughSequence,
          pendingEvents: this.pending.length,
          ...(this.pending.length === 0 && !this.needsReconciliation ? {} : { failure: { code: "OBSERVABILITY_CANCELLED", message: "Flush was cancelled before storage began.", retryable: true } }),
        });
      }
      return this.flushLocked(signal);
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    let rootStats;
    try {
      const rootEntry = await lstat(this.rootDirectory);
      if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
        throw storageError("Recorder rootDirectory must name a real directory, not a symbolic link.");
      }
      rootStats = await stat(this.rootDirectory);
    } catch (error) {
      throw storageError(`Recorder root directory is unavailable: ${errorMessage(error)}`);
    }
    if (!rootStats.isDirectory()) throw storageError("Recorder rootDirectory must name an existing directory.");

    try {
      await mkdir(this.runDirectory, { recursive: true });
      const runStats = await lstat(this.runDirectory);
      if (!runStats.isDirectory() || runStats.isSymbolicLink()) {
        throw storageError("Recorder run directory must be a real directory, not a symbolic link.");
      }
      const expectedRunDirectory = join(await realpath(this.rootDirectory), `run-${encodeURIComponent(this.scope.runId)}`);
      if (await realpath(this.runDirectory) !== expectedRunDirectory) {
        throw storageError("Recorder run directory resolves outside its configured root.");
      }
      await syncDirectory(this.rootDirectory);
      const stored = await readStoredLines(this.eventFile, this.scope.runId, this.config);
      if (stored.hadIncompleteTail) {
        await truncateAndSyncRegularFile(this.eventFile, stored.completeByteLength);
      }
      if (stored.events.length > 0 || stored.hadIncompleteTail) {
        if (!stored.hadIncompleteTail) await syncRegularFile(this.eventFile);
        await syncDirectory(this.runDirectory);
      }
      this.storedByteLength = stored.completeByteLength;
      for (const event of stored.events) this.indexStored(event);
      this.loaded = true;
    } catch (error) {
      if (isObservabilityError(error)) throw error;
      throw storageError(`Could not read the recorder file: ${errorMessage(error)}`);
    }
  }

  private indexStored(event: QueuedEvent): void {
    if (this.indexedById.has(event.eventId) || this.indexedBySequence.has(event.sequence)) {
      throw storageError("Recorder file contains a repeated event ID or sequence.");
    }
    if (event.sequence <= this.lastAcceptedSequence) {
      throw storageError("Recorder file contains out-of-order event sequences.");
    }
    if (this.indexedById.size >= this.config.maxTrackedEvents) {
      throw storageError("Recorder file exceeds maxTrackedEvents; increase the configured tracking limit to reopen it.");
    }
    const indexed: IndexedEvent = {
      eventId: event.eventId,
      sequence: event.sequence,
      fingerprint: event.fingerprint,
      durable: true,
    };
    this.indexedById.set(event.eventId, indexed);
    this.indexedBySequence.set(event.sequence, indexed);
    this.lastAcceptedSequence = event.sequence;
    this.durableThroughSequence = event.sequence;
  }

  private async flushLocked(signal: AbortSignal): Promise<ObservationFlushReceipt> {
    if (this.pending.length === 0 && !this.needsReconciliation) {
      return Object.freeze({ status: "durable", durableThroughSequence: this.durableThroughSequence, pendingEvents: 0 });
    }
    if (signal.aborted && (this.pending.length > 0 || this.needsReconciliation)) return this.partialReceipt();

    try {
      if (this.needsReconciliation) await this.reconcileUncertainWrites(signal);
      this.needsReconciliation = false;
      if (signal.aborted && this.pending.length > 0) return this.partialReceipt();
      if (this.pending.length > 0) await this.writePendingBatch(signal);
      this.needsReconciliation = false;
      return Object.freeze({ status: "durable", durableThroughSequence: this.durableThroughSequence, pendingEvents: 0 });
    } catch (error) {
      if (error instanceof FlushCancelledError) return this.partialReceipt();
      this.needsReconciliation = true;
      return Object.freeze({
        status: "unknown",
        durableThroughSequence: this.durableThroughSequence,
        pendingEvents: this.pending.length,
        failure: { code: "OBSERVABILITY_WRITE_UNKNOWN", message: errorMessage(error), retryable: true },
      });
    }
  }

  private partialReceipt(): ObservationFlushReceipt {
    return Object.freeze({
      status: "partial",
      durableThroughSequence: this.durableThroughSequence,
      pendingEvents: this.pending.length,
      ...(this.pending.length === 0 && !this.needsReconciliation ? {} : { failure: { code: "OBSERVABILITY_CANCELLED", message: "Flush was cancelled before the next storage operation began.", retryable: true } }),
    });
  }

  private async writePendingBatch(signal: AbortSignal): Promise<void> {
    const batch = [...this.pending];
    await this.appendRecords(batch, signal);
    this.storedByteLength += encodedRecordsByteLength(batch);
    this.markDurable(batch);
  }

  private async reconcileUncertainWrites(signal: AbortSignal): Promise<void> {
    const stored = await readStoredLines(this.eventFile, this.scope.runId, this.config);
    throwIfFlushCancelled(signal);
    if (stored.hadIncompleteTail) {
      await truncateAndSyncRegularFile(this.eventFile, stored.completeByteLength);
      throwIfFlushCancelled(signal);
    }
    if (stored.events.length > 0 || stored.hadIncompleteTail) {
      if (!stored.hadIncompleteTail) {
        await syncRegularFile(this.eventFile);
        throwIfFlushCancelled(signal);
      }
      await syncDirectory(this.runDirectory);
      throwIfFlushCancelled(signal);
    }
    this.storedByteLength = stored.completeByteLength;

    const storedById = new Map(stored.events.map((event) => [event.eventId, event]));
    const missing: QueuedEvent[] = [];
    const alreadyStored: QueuedEvent[] = [];
    for (const pending of this.pending) {
      const previous = storedById.get(pending.eventId);
      if (previous) {
        if (previous.sequence !== pending.sequence || previous.fingerprint !== pending.fingerprint) {
          throw storageError(`Recorder file conflicts with pending event ${JSON.stringify(pending.eventId)}.`);
        }
        alreadyStored.push(pending);
        continue;
      }
      if (stored.events.some((event) => event.sequence === pending.sequence)) {
        throw storageError(`Recorder file reuses pending sequence ${pending.sequence} with different content.`);
      }
      missing.push(pending);
    }
    if (alreadyStored.length > 0) this.markDurable(alreadyStored);
    if (missing.length > 0) {
      await this.appendRecords(missing, signal);
      this.storedByteLength += encodedRecordsByteLength(missing);
      this.markDurable(missing);
    }
  }

  private async appendRecords(events: readonly QueuedEvent[], signal: AbortSignal): Promise<void> {
    throwIfFlushCancelled(signal);
    let handle;
    try {
      const appendBytes = encodedRecordsByteLength(events);
      if (this.storedByteLength + appendBytes > this.config.maxStoredBytes) {
        throw storageError("Recorder maxStoredBytes limit would be exceeded.");
      }
      handle = await open(this.eventFile, noFollowFlags(constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT), 0o600);
      await assertRecorderFile(handle);
      throwIfFlushCancelled(signal);
      await handle.writeFile(`${events.map((event) => event.line).join("\n")}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await syncDirectory(this.runDirectory);
    } finally {
      if (handle) await handle.close();
    }
  }

  private markDurable(events: readonly QueuedEvent[]): void {
    const durableSequences = new Set(events.map((event) => event.sequence));
    for (const event of events) {
      const indexed = this.indexedById.get(event.eventId);
      if (indexed) indexed.durable = true;
    }
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (durableSequences.has(this.pending[index].sequence)) {
        this.pendingBytes -= utf8Bytes(this.pending[index].line) + 1;
        this.pending.splice(index, 1);
      }
    }
    const highest = Math.max(...events.map((event) => event.sequence));
    this.durableThroughSequence = Math.max(this.durableThroughSequence ?? -1, highest);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    const current = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    this.queue = previous.then(() => current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

/** Create one JSONL recorder bound to a run and a host-selected directory. */
export function createJsonlObservability(config: unknown, dependencies: ObservabilityDependencies): ObservabilityModule {
  const parsed = parseObservabilityConfig(config);
  if (!isRecord(dependencies) || typeof dependencies.rootDirectory !== "string"
    || dependencies.rootDirectory.length > 4_096 || dependencies.rootDirectory.trim().length === 0) {
    throw new ObservabilityError("INVALID_OBSERVABILITY_INPUT", "Observability requires a non-empty rootDirectory.");
  }
  const scope = validateScope(dependencies.scope);
  return new JsonlObservabilityRecorder(parsed, scope, dependencies.rootDirectory);
}

async function readStoredLines(
  filePath: string,
  runId: string,
  config: ObservabilityConfig,
): Promise<StoredLineRead> {
  let bytes: Buffer;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, noFollowFlags(constants.O_RDONLY));
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.nlink !== 1) throw storageError("Recorder event path must be a regular file with one link.");
    if (metadata.size > config.maxStoredBytes) {
      throw storageError("Recorder file exceeds maxStoredBytes; increase the configured storage limit to reopen it.");
    }
    bytes = await handle.readFile();
  } catch (error) {
    if (isMissingFile(error)) return { events: [], completeByteLength: 0, hadIncompleteTail: false };
    throw error;
  } finally {
    if (handle) await handle.close();
  }

  const finalNewline = bytes.lastIndexOf(0x0a);
  const completeByteLength = finalNewline + 1;
  const hadIncompleteTail = completeByteLength < bytes.byteLength;
  const completeBytes = bytes.subarray(0, completeByteLength);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(completeBytes);
  const lines = text.length === 0 ? [] : text.slice(0, -1).split("\n");
  const events: QueuedEvent[] = [];
  let previousSequence = -1;
  const ids = new Set<string>();
  const sequences = new Set<number>();

  for (const [index, line] of lines.entries()) {
    if (line.length === 0) throw storageError(`Recorder file contains a blank complete line ${index + 1}.`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw storageError(`Recorder file contains invalid JSON on complete line ${index + 1}.`);
    }
    const validated = validateObservedEvent(parsed, runId, config);
    if (validated.kind === "invalid") throw storageError(`Recorder file contains an invalid event on line ${index + 1}.`);
    if (ids.has(validated.eventId) || sequences.has(validated.sequence)) {
      throw storageError(`Recorder file repeats event identity on line ${index + 1}.`);
    }
    if (validated.sequence <= previousSequence) throw storageError("Recorder file contains out-of-order sequence numbers.");
    ids.add(validated.eventId);
    sequences.add(validated.sequence);
    previousSequence = validated.sequence;
    events.push(validated);
    if (events.length > config.maxTrackedEvents) {
      throw storageError("Recorder file exceeds maxTrackedEvents; increase the configured tracking limit to reopen it.");
    }
  }
  return { events, completeByteLength, hadIncompleteTail };
}

function validateObservedEvent(
  value: unknown,
  expectedRunId: string,
  config: ObservabilityConfig,
): { readonly kind: "valid"; readonly eventId: string; readonly sequence: number; readonly line: string; readonly fingerprint: string; readonly observed: ObservedEvent } & QueuedEvent
  | { readonly kind: "invalid" } {
  if (!isRecord(value) || !isRecord(value.event)) return { kind: "invalid" };
  const event = value.event;
  if (!isIdentifierWithinBytes(event.eventId, config.maxEventBytes)
    || !Number.isSafeInteger(event.sequence) || (event.sequence as number) < 0
    || event.runId !== expectedRunId || typeof event.occurredAt !== "string" || !isRfc3339DateTime(event.occurredAt)
    || !isRecord(event.source) || !isIdentifierWithinBytes(event.source.id, config.maxEventBytes)
    || !isIdentifierWithinBytes(event.source.version, config.maxEventBytes)
    || !isIdentifierWithinBytes(event.kind, config.maxEventBytes)) {
    return { kind: "invalid" };
  }
  const payload = copyBoundedJson(event.payload, config.maxEventBytes);
  if (payload === undefined) return { kind: "invalid" };
  let moduleDetail: ModuleDetail | undefined;
  if (value.moduleDetail !== undefined) {
    const detail = value.moduleDetail;
    if (!isRecord(detail) || !isRecord(detail.module)
      || !isIdentifierWithinBytes(detail.module.id, config.maxModuleDetailBytes)
      || !isIdentifierWithinBytes(detail.module.version, config.maxModuleDetailBytes)
      || !isIdentifierWithinBytes(detail.schemaVersion, config.maxModuleDetailBytes)) {
      return { kind: "invalid" };
    }
    const copiedDetail = copyBoundedJson(detail.detail, config.maxModuleDetailBytes);
    if (copiedDetail === undefined) return { kind: "invalid" };
    moduleDetail = Object.freeze({
      module: Object.freeze({ id: detail.module.id, version: detail.module.version }),
      schemaVersion: detail.schemaVersion,
      detail: copiedDetail,
    });
  }

  const normalizedEvent: AgentEvent = Object.freeze({
    eventId: event.eventId,
    sequence: event.sequence as number,
    runId: event.runId as AgentEvent["runId"],
    occurredAt: event.occurredAt,
    source: Object.freeze({ id: event.source.id, version: event.source.version }),
    kind: event.kind,
    payload,
  });
  const candidateObserved: ObservedEvent = Object.freeze({
    event: normalizedEvent,
    ...(moduleDetail === undefined ? {} : { moduleDetail }),
  });
  const boundedObserved = copyBoundedJson(candidateObserved, config.maxEventBytes);
  if (boundedObserved === undefined) return { kind: "invalid" };
  const observed = boundedObserved as unknown as ObservedEvent;
  const line = canonicalJson(observed);
  if (utf8Bytes(line) > config.maxEventBytes) return { kind: "invalid" };
  return {
    kind: "valid",
    observed,
    eventId: normalizedEvent.eventId,
    sequence: normalizedEvent.sequence,
    fingerprint: line,
    line,
  };
}

function receiptIdentity(value: unknown): { readonly eventId: string; readonly sequence: number } {
  if (isRecord(value) && isRecord(value.event)) {
    const eventId = typeof value.event.eventId === "string" && value.event.eventId.length <= 256
      && isIdentifier(value.event.eventId) ? value.event.eventId : "";
    return {
      eventId,
      sequence: Number.isSafeInteger(value.event.sequence) && (value.event.sequence as number) >= 0 ? value.event.sequence as number : -1,
    };
  }
  return { eventId: "", sequence: -1 };
}

function rejected(event: QueuedEvent, reason: "out-of-order" | "conflicting-duplicate" | "capacity"): ObservationAppendReceipt {
  return Object.freeze({ status: "rejected", eventId: event.eventId, sequence: event.sequence, reason });
}

function validateScope(value: unknown): RunScope {
  if (!isRecord(value) || !isIdentifierWithinBytes(value.runId, 200)
    || (value.sessionId !== undefined && !isIdentifierWithinBytes(value.sessionId, 200))
    || (value.turnId !== undefined && !isIdentifierWithinBytes(value.turnId, 200))) {
    throw new ObservabilityError("INVALID_OBSERVABILITY_INPUT", "Recorder scope requires a valid runId and optional valid sessionId and turnId values.");
  }
  return {
    runId: value.runId,
    ...(value.sessionId === undefined ? {} : { sessionId: value.sessionId }),
    ...(value.turnId === undefined ? {} : { turnId: value.turnId }),
  } as unknown as RunScope;
}

function assertSignal(value: unknown): asserts value is AbortSignal {
  if (!isRecord(value) || typeof value.aborted !== "boolean"
    || typeof value.addEventListener !== "function" || typeof value.removeEventListener !== "function") {
    throw new ObservabilityError("INVALID_OBSERVABILITY_INPUT", "A valid AbortSignal is required.");
  }
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ObservabilityError("OBSERVABILITY_CANCELLED", "Observability operation was cancelled before it began.");
}

class FlushCancelledError extends Error {}

function throwIfFlushCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new FlushCancelledError("Flush was cancelled before the next storage operation began.");
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, noFollowFlags(constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)));
  try {
    if (!(await handle.stat()).isDirectory()) throw storageError("Recorder parent path must be a real directory.");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncRegularFile(filePath: string): Promise<void> {
  const handle = await open(filePath, noFollowFlags(constants.O_RDONLY));
  try {
    await assertRecorderFile(handle);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function truncateAndSyncRegularFile(filePath: string, length: number): Promise<void> {
  const handle = await open(filePath, noFollowFlags(constants.O_WRONLY));
  try {
    await assertRecorderFile(handle);
    await handle.truncate(length);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertRecorderFile(handle: Awaited<ReturnType<typeof open>>): Promise<void> {
  const metadata = await handle.stat();
  if (!metadata.isFile() || metadata.nlink !== 1) {
    throw storageError("Recorder event path must be a regular file with one link.");
  }
}

function noFollowFlags(flags: number): number {
  if (constants.O_NOFOLLOW === undefined) {
    throw storageError("This platform does not support no-follow file opens required by the JSONL recorder.");
  }
  return flags | constants.O_NOFOLLOW;
}

function encodedRecordsByteLength(events: readonly QueuedEvent[]): number {
  return events.reduce((total, event) => total + utf8Bytes(event.line) + 1, 0);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareStrings);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;

/** Copy JSON input while measuring its canonical UTF-8 size before serialization. */
function copyBoundedJson(value: unknown, maximumBytes: number): JsonValue | undefined {
  let encodedBytes = 0;
  let nodeCount = 0;
  const ancestors = new Set<object>();
  const addBytes = (length: number): boolean => {
    encodedBytes += length;
    return encodedBytes <= maximumBytes;
  };

  const visit = (item: unknown, depth: number): JsonValue | undefined => {
    nodeCount += 1;
    if (nodeCount > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return undefined;
    if (item === null) return addBytes(4) ? null : undefined;
    if (typeof item === "boolean") return addBytes(item ? 4 : 5) ? item : undefined;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) return undefined;
      const number = Object.is(item, -0) ? "0" : String(item);
      return addBytes(number.length) ? item : undefined;
    }
    if (typeof item === "string") {
      const length = jsonStringByteLength(item, maximumBytes - encodedBytes);
      if (length === undefined || !addBytes(length)) return undefined;
      return item;
    }
    if (typeof item !== "object" || item === null || ancestors.has(item)) return undefined;

    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (!addBytes(2)) return undefined;
        const copied: JsonValue[] = [];
        for (let index = 0; index < item.length; index += 1) {
          if (index > 0 && !addBytes(1)) return undefined;
          const entry = visit(item[index], depth + 1);
          if (entry === undefined) return undefined;
          copied.push(entry);
        }
        return Object.freeze(copied);
      }

      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) return undefined;
      if (Object.getOwnPropertySymbols(item).length > 0) return undefined;
      const keys: string[] = [];
      for (const key in item) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
        nodeCount += 1;
        if (nodeCount > MAX_JSON_NODES) return undefined;
        keys.push(key);
      }
      keys.sort(compareStrings);
      if (!addBytes(2)) return undefined;
      const copied: Record<string, JsonValue> = {};
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        const keyLength = jsonStringByteLength(key, maximumBytes - encodedBytes);
        if (keyLength === undefined || !addBytes(keyLength + 1)) return undefined;
        if (index > 0 && !addBytes(1)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor)) return undefined;
        const entry = visit(descriptor.value, depth + 1);
        if (entry === undefined) return undefined;
        Object.defineProperty(copied, key, { value: entry, enumerable: true, writable: false, configurable: false });
      }
      return Object.freeze(copied);
    } catch {
      return undefined;
    } finally {
      ancestors.delete(item);
    }
  };

  try {
    const copied = visit(value, 0);
    if (copied === undefined || encodedBytes > maximumBytes) return undefined;
    return copied;
  } catch {
    return undefined;
  }
}

function jsonStringByteLength(value: string, maximumBytes: number): number | undefined {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0x22 || unit === 0x5c || unit === 0x08 || unit === 0x09 || unit === 0x0a || unit === 0x0c || unit === 0x0d) {
      bytes += 2;
    } else if (unit < 0x20) {
      bytes += 6;
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return undefined;
      bytes += 4;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return undefined;
    } else if (unit <= 0x7f) {
      bytes += 1;
    } else if (unit <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
    if (bytes > maximumBytes) return undefined;
  }
  return bytes;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value) && isWellFormedUnicode(value);
}

function isIdentifierWithinBytes(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" && jsonStringByteLength(value, maximumBytes) !== undefined && isIdentifier(value);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isRfc3339DateTime(value: string): boolean {
  if (value.length > 128) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[9] ?? 0);
  const offsetMinute = Number(match[10] ?? 0);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysByMonth[month - 1] && Number.isFinite(Date.parse(value));
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isObservabilityError(error: unknown): error is ObservabilityError {
  return error instanceof ObservabilityError;
}

function storageError(message: string): ObservabilityError {
  return new ObservabilityError("OBSERVABILITY_STORAGE_FAILURE", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "unknown storage error";
}
