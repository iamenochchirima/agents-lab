import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  RunEvent,
  RunEventIntent,
  RunManifest,
  RunMetrics,
  PlatformExecutionReference,
  RunResult,
  RunTrajectory,
} from "../domain/types.js";
import type { ContextSnapshot } from "../../capabilities/context/contracts.js";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_EVENT_BYTES = 256 * 1024;
const MAX_EXECUTION_REFERENCE_BYTES = 128 * 1024;
const MAX_RESULT_BYTES = 512 * 1024;
const MAX_TRAJECTORY_BYTES = 512 * 1024;
const MAX_METRICS_BYTES = 128 * 1024;
const MAX_CONTEXT_BYTES = 512 * 1024;

export class InvalidRunIdError extends Error {
  constructor(readonly runId: string) {
    super(`Invalid run ID: ${runId}`);
    this.name = "InvalidRunIdError";
  }
}

export class EvidenceNotFoundError extends Error {
  constructor(readonly path: string) {
    super(`Evidence was not found: ${path}`);
    this.name = "EvidenceNotFoundError";
  }
}

export class EvidenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceConflictError";
  }
}

export class EventOrderingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventOrderingError";
  }
}

export class CorruptEvidenceError extends Error {
  constructor(readonly path: string, readonly line?: number) {
    super(`Corrupt evidence at ${path}${line === undefined ? "" : ` (line ${line})`}.`);
    this.name = "CorruptEvidenceError";
  }
}

export class EvidenceLimitError extends Error {
  constructor(readonly path: string, readonly maxBytes: number) {
    super(`Evidence exceeds the ${maxBytes}-byte safety limit: ${path}`);
    this.name = "EvidenceLimitError";
  }
}

/** Returns true for local I/O failures where the platform result may still be authoritative. */
export function isEvidenceProjectionUnavailable(error: unknown): boolean {
  if (!isNodeError(error)) return false;
  return ["EACCES", "EBUSY", "EIO", "EMFILE", "ENFILE", "ENOSPC", "EROFS", "ETIMEDOUT"].includes(error.code ?? "");
}

export interface RunEvidenceSnapshot {
  readonly manifest: RunManifest;
  readonly events: readonly RunEvent[];
  readonly executionReference: PlatformExecutionReference | null;
  readonly trajectory: RunTrajectory | null;
  readonly metrics: RunMetrics | null;
  readonly result: RunResult | null;
  readonly context: ContextSnapshot | null;
}

/**
 * Owns the Lab's retained evidence files. Platform execution code must not use
 * this class directly. Platform state remains in the selected platform, while
 * this store is a restart-safe projection for inspection and comparison.
 */
export class RunEvidenceStore {
  private readonly eventQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly rootDirectory: string) {}

  runDirectory(runId: string): string {
    assertSafeRunId(runId);
    return join(this.rootDirectory, runId);
  }

  async createRun(manifest: RunManifest): Promise<void> {
    const safeManifest = sanitizeEvidenceValue(manifest) as RunManifest;
    const runDirectory = this.runDirectory(manifest.runId);
    await mkdir(join(runDirectory, "logs"), { recursive: true });
    await mkdir(join(runDirectory, "artifacts"), { recursive: true });
    await mkdir(join(runDirectory, "native"), { recursive: true });

    const configPath = join(runDirectory, "config.json");
    try {
      const existing = await readJson<RunManifest>(configPath);
      if (!deepEqual(existing, safeManifest)) {
        throw new EvidenceConflictError(`Run manifest already exists with different content: ${manifest.runId}`);
      }
    } catch (error) {
      if (!(error instanceof EvidenceNotFoundError)) {
        throw error;
      }

      assertEvidenceSize(safeManifest, configPath, MAX_MANIFEST_BYTES);
      await atomicWriteJson(configPath, safeManifest);
    }

    const eventsPath = join(runDirectory, "events.jsonl");
    try {
      await readFile(eventsPath, "utf8");
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        throw error;
      }

      await writeFile(eventsPath, "", { encoding: "utf8", flag: "wx" });
    }
  }

  async appendEvent<TPayload extends Record<string, unknown>>(
    intent: RunEventIntent<TPayload>,
  ): Promise<RunEvent<TPayload>> {
    const safeIntent = sanitizeEvidenceValue(intent) as RunEventIntent<TPayload>;
    const previous = this.eventQueues.get(safeIntent.runId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.appendEventNow(safeIntent));
    this.eventQueues.set(safeIntent.runId, operation);

    try {
      return await operation;
    } finally {
      if (this.eventQueues.get(safeIntent.runId) === operation) {
        this.eventQueues.delete(safeIntent.runId);
      }
    }
  }

  async readManifest(runId: string): Promise<RunManifest> {
    return readJson<RunManifest>(join(this.runDirectory(runId), "config.json"));
  }

  async readEvents(runId: string): Promise<readonly RunEvent[]> {
    const path = join(this.runDirectory(runId), "events.jsonl");
    let contents: string;
    try {
      contents = await readFile(path, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        throw new EvidenceNotFoundError(path);
      }
      throw error;
    }

    if (contents.length === 0) {
      return [];
    }

    const events = contents.split("\n").flatMap((line, index, lines) => {
      if (index === lines.length - 1 && line === "") {
        return [];
      }
      if (line.trim() === "") {
        throw new CorruptEvidenceError(path, index + 1);
      }

      let event: RunEvent;
      try {
        event = JSON.parse(line) as RunEvent;
      } catch {
        throw new CorruptEvidenceError(path, index + 1);
      }
      validateStoredEvent(event, path, index + 1);
      return [event];
    });

    validateEventCollection(events, path);
    return events;
  }

  async writeExecutionReference(runId: string, reference: PlatformExecutionReference): Promise<void> {
    const safeReference = sanitizeEvidenceValue(reference) as PlatformExecutionReference;
    const manifest = await this.readManifest(runId);
    const path = join(this.runDirectory(runId), nativeReferenceFile(safeReference.platform));
    validateExecutionReference(safeReference, manifest, `native/${manifest.platform}.json`);
    assertEvidenceSize(safeReference, path, MAX_EXECUTION_REFERENCE_BYTES);

    // The execution identity is immutable, but inspection may enrich the native
    // payload with an invocation ID, retry count, or terminal status. Replace the
    // single platform-scoped reference atomically so recovery uses the newest
    // known native identity without allowing a different execution to overwrite it.
    try {
      const existing = await readJson<PlatformExecutionReference>(path);
      if (existing.executionId !== safeReference.executionId) {
        throw new EvidenceConflictError(`Execution identity changed for native evidence: ${path}`);
      }
    } catch (error) {
      if (!(error instanceof EvidenceNotFoundError)) throw error;
    }

    await atomicWriteJson(path, safeReference);
  }

  async writeResult(result: RunResult): Promise<void> {
    const safeResult = sanitizeEvidenceValue(result) as RunResult;
    const path = join(this.runDirectory(safeResult.runId), "result.json");
    assertEvidenceSize(safeResult, path, MAX_RESULT_BYTES);
    const existing = await this.readOptionalJson<RunResult>(path);
    if (!existing || deepEqual(existing, safeResult)) {
      if (!existing) await atomicWriteJson(path, safeResult);
      return;
    }
    // A reconciliation-required result is a provisional observation made
    // after an ambiguous submission. Once the retained platform execution is
    // found, replace that observation with the durable terminal result. Every
    // other terminal result remains immutable.
    if (existing.status === "reconciliation_required" && safeResult.status !== "reconciliation_required") {
      await atomicWriteJson(path, safeResult);
      return;
    }
    throw new EvidenceConflictError(`Evidence already exists with different content: ${path}`);
  }

  async writeTrajectory(trajectory: RunTrajectory): Promise<void> {
    const safeTrajectory = sanitizeEvidenceValue(trajectory) as RunTrajectory;
    const path = join(this.runDirectory(safeTrajectory.runId), "trajectory.json");
    assertEvidenceSize(safeTrajectory, path, MAX_TRAJECTORY_BYTES);
    await this.writeIdempotent(path, safeTrajectory);
  }

  async writeMetrics(metrics: RunMetrics): Promise<void> {
    const safeMetrics = sanitizeEvidenceValue(metrics) as RunMetrics;
    const path = join(this.runDirectory(safeMetrics.runId), "metrics.json");
    assertEvidenceSize(safeMetrics, path, MAX_METRICS_BYTES);
    await this.writeIdempotent(path, safeMetrics);
  }

  async writeContextSnapshot(runId: string, snapshot: ContextSnapshot): Promise<void> {
    const safeSnapshot = sanitizeEvidenceValue(snapshot) as ContextSnapshot;
    const manifest = await this.readManifest(runId);
    if (manifest.context.sessionId !== safeSnapshot.sessionId) {
      throw new EvidenceConflictError(`Context snapshot belongs to a different session: ${runId}`);
    }
    const path = join(this.runDirectory(runId), "context.json");
    const existing = await this.readOptionalJson<ContextSnapshot>(path);
    assertEvidenceSize(safeSnapshot, path, MAX_CONTEXT_BYTES);
    if (existing && existing.sessionRevision > safeSnapshot.sessionRevision) {
      throw new EvidenceConflictError(`Context evidence moved backwards in session revision: ${runId}`);
    }
    if (existing && existing.snapshotId === safeSnapshot.snapshotId) return;
    await atomicWriteJson(path, safeSnapshot);
  }

  async readSnapshot(runId: string): Promise<RunEvidenceSnapshot> {
    const runDirectory = this.runDirectory(runId);
    const manifest = await this.readManifest(runId);
    const storedReference = await this.readOptionalJson<unknown>(join(runDirectory, nativeReferenceFile(manifest.platform)));
    return {
      manifest,
      events: await this.readEvents(runId),
      executionReference: storedReference === null ? null : normalizeExecutionReference(storedReference, manifest),
      trajectory: await this.readOptionalJson<RunTrajectory>(join(runDirectory, "trajectory.json")),
      metrics: await this.readOptionalJson<RunMetrics>(join(runDirectory, "metrics.json")),
      result: await this.readOptionalJson<RunResult>(join(runDirectory, "result.json")),
      context: await this.readOptionalJson<ContextSnapshot>(join(runDirectory, "context.json")),
    };
  }

  async readAllowlistedFile(runId: string, fileName: EvidenceFileName): Promise<string> {
    const path = join(this.runDirectory(runId), fileName);
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        throw new EvidenceNotFoundError(path);
      }
      throw error;
    }
  }

  private async appendEventNow<TPayload extends Record<string, unknown>>(
    intent: RunEventIntent<TPayload>,
  ): Promise<RunEvent<TPayload>> {
    const path = join(this.runDirectory(intent.runId), "events.jsonl");
    const events = await this.readEvents(intent.runId);
    const eventId = `${intent.runId}:${intent.source}:${intent.sourceSequence}`;
    const existing = events.find((event) => event.eventId === eventId);
    if (existing) {
      if (!sameEventIntent(existing, intent)) {
        throw new EvidenceConflictError(`Event identity has different content: ${eventId}`);
      }
      return existing as RunEvent<TPayload>;
    }

    const lastSourceSequence = events.reduce(
      (maximum, event) => (event.source === intent.source ? Math.max(maximum, event.sourceSequence) : maximum),
      0,
    );
    if (intent.sourceSequence !== lastSourceSequence + 1) {
      throw new EventOrderingError(
        `Expected ${intent.source} source sequence ${lastSourceSequence + 1}, received ${intent.sourceSequence}.`,
      );
    }

    const lastRecordedSequence = events.at(-1)?.recordedSequence ?? 0;
    if (events.some((event, index) => event.recordedSequence !== index + 1)) {
      throw new CorruptEvidenceError(path);
    }

    const event: RunEvent<TPayload> = {
      schemaVersion: 1,
      eventId,
      recordedSequence: lastRecordedSequence + 1,
      source: intent.source,
      sourceSequence: intent.sourceSequence,
      kind: intent.kind,
      runId: intent.runId,
      occurredAt: intent.occurredAt,
      payload: intent.payload,
    };
    assertEvidenceSize(event, path, MAX_EVENT_BYTES);
    await appendFile(path, `${stableJson(event)}\n`, "utf8");
    return event;
  }

  private async writeIdempotent<T>(path: string, value: T): Promise<void> {
    try {
      const existing = await readJson<T>(path);
      if (!deepEqual(existing, value)) {
        throw new EvidenceConflictError(`Evidence already exists with different content: ${path}`);
      }
      return;
    } catch (error) {
      if (!(error instanceof EvidenceNotFoundError)) {
        throw error;
      }
    }

    await atomicWriteJson(path, value);
  }

  private async readOptionalJson<T>(path: string): Promise<T | null> {
    try {
      return await readJson<T>(path);
    } catch (error) {
      if (error instanceof EvidenceNotFoundError) {
        return null;
      }
      throw error;
    }
  }
}

export type EvidenceFileName =
  | "config.json"
  | "events.jsonl"
  | "trajectory.json"
  | "metrics.json"
  | "context.json"
  | "result.json"
  | `native/${string}.json`;

export function isAllowlistedEvidenceFile(fileName: string, platform: string): fileName is EvidenceFileName {
  return fileName === "config.json" ||
    fileName === "events.jsonl" ||
    fileName === "trajectory.json" ||
    fileName === "metrics.json" ||
    fileName === "context.json" ||
    fileName === "result.json" ||
    fileName === nativeReferenceFile(platform);
}

function nativeReferenceFile(platform: string): `native/${string}.json` {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(platform)) {
    throw new Error("Platform identifier is not safe for a native evidence path.");
  }
  return `native/${platform}.json`;
}

function normalizeExecutionReference(value: unknown, manifest: RunManifest): PlatformExecutionReference {
  if (!isRecord(value)) {
    throw new CorruptEvidenceError(`native/${manifest.platform}.json`);
  }

  if (typeof value.executionId === "string" && isRecord(value.native)) {
    const reference: PlatformExecutionReference = {
      platform: typeof value.platform === "string" ? value.platform : manifest.platform,
      variant: typeof value.variant === "string" ? value.variant : manifest.variant,
      executionId: value.executionId,
      native: value.native,
    };
    validateExecutionReference(reference, manifest, `native/${manifest.platform}.json`);
    return reference;
  }

  // Schema-v1 Temporal evidence predates the generic execution reference. Keep
  // it readable so a server upgrade does not discard the only native identity.
  if (manifest.platform === "temporal" && typeof value.workflowId === "string") {
    return {
      platform: "temporal",
      variant: manifest.variant,
      executionId: value.workflowId,
      native: value,
    };
  }

  throw new CorruptEvidenceError(`native/${manifest.platform}.json`);
}

function validateExecutionReference(
  reference: PlatformExecutionReference,
  manifest: RunManifest,
  path: string,
): void {
  if (
    reference.platform !== manifest.platform ||
    reference.variant !== manifest.variant ||
    reference.executionId.trim().length === 0 ||
    !isRecord(reference.native)
  ) {
    throw new CorruptEvidenceError(path);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSafeRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new InvalidRunIdError(runId);
  }
}

async function readJson<T>(path: string): Promise<T> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new EvidenceNotFoundError(path);
    }
    throw error;
  }

  try {
    return JSON.parse(contents) as T;
  } catch {
    throw new CorruptEvidenceError(path);
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${stableJson(value)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, path);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function assertEvidenceSize(value: unknown, path: string, maxBytes: number): void {
  let serialized: string;
  try {
    serialized = stableJson(value);
  } catch {
    throw new EvidenceLimitError(path, maxBytes);
  }
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new EvidenceLimitError(path, maxBytes);
  }
}

const SENSITIVE_EVIDENCE_KEY = /^(?:api[-_]?key|authorization|cookie|password|secret|credential|access[-_]?token|refresh[-_]?token|private[-_]?key)$/i;

/** Redacts credential-shaped object fields before any retained evidence write. */
function sanitizeEvidenceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeEvidenceValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_EVIDENCE_KEY.test(key) ? "[REDACTED]" : sanitizeEvidenceValue(nestedValue),
    ]),
  );
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
    );
  }
  return value;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function sameEventIntent(event: RunEvent, intent: RunEventIntent): boolean {
  return (
    event.runId === intent.runId &&
    event.source === intent.source &&
    event.sourceSequence === intent.sourceSequence &&
    event.kind === intent.kind &&
    event.occurredAt === intent.occurredAt &&
    deepEqual(event.payload, intent.payload)
  );
}

function validateStoredEvent(event: RunEvent, path: string, line: number): void {
  if (
    event.schemaVersion !== 1 ||
    typeof event.eventId !== "string" ||
    !Number.isInteger(event.recordedSequence) ||
    event.recordedSequence < 1 ||
    !Number.isInteger(event.sourceSequence) ||
    event.sourceSequence < 1 ||
    typeof event.kind !== "string" ||
    typeof event.runId !== "string" ||
    typeof event.occurredAt !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(event.source)
  ) {
    throw new CorruptEvidenceError(path, line);
  }

  if (event.eventId !== `${event.runId}:${event.source}:${event.sourceSequence}`) {
    throw new CorruptEvidenceError(path, line);
  }
}

function validateEventCollection(events: readonly RunEvent[], path: string): void {
  const sourceSequences = new Map<RunEvent["source"], number>();

  for (const [index, event] of events.entries()) {
    if (event.recordedSequence !== index + 1) {
      throw new CorruptEvidenceError(path, index + 1);
    }

    const expectedSourceSequence = (sourceSequences.get(event.source) ?? 0) + 1;
    if (event.sourceSequence !== expectedSourceSequence) {
      throw new CorruptEvidenceError(path, index + 1);
    }
    sourceSequences.set(event.source, event.sourceSequence);
  }
}

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (code === undefined || (error as NodeJS.ErrnoException).code === code);
}
