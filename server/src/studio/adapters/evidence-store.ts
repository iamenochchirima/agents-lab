import { appendFile, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import type {
  StudioComparisonManifest,
  StudioComparisonResult,
  StudioComparisonSnapshot,
  StudioContextEvidence,
  StudioEvent,
  StudioEventIntent,
  StudioMetrics,
  StudioTrajectory,
  StudioTrialManifest,
  StudioTrialResult,
  StudioTrialSnapshot,
} from "../domain/types.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_EVENT_BYTES = 256 * 1024;

export class StudioEvidenceNotFoundError extends Error {
  constructor(readonly evidencePath: string) {
    super(`Studio evidence was not found: ${evidencePath}`);
    this.name = "StudioEvidenceNotFoundError";
  }
}

export class StudioEvidenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioEvidenceConflictError";
  }
}

export class StudioEvidenceOrderingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioEvidenceOrderingError";
  }
}

export class StudioCorruptEvidenceError extends Error {
  constructor(readonly evidencePath: string, readonly line?: number) {
    super(`Corrupt Studio evidence at ${evidencePath}${line === undefined ? "" : ` (line ${line})`}.`);
    this.name = "StudioCorruptEvidenceError";
  }
}

interface IdempotencyRecord {
  readonly schemaVersion: 1;
  readonly keyHash: string;
  readonly requestFingerprint: string;
  readonly comparisonId: string;
}

export class StudioEvidenceStore {
  private readonly eventQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly rootDirectory: string) {}

  comparisonDirectory(comparisonId: string): string {
    assertSafeId(comparisonId);
    return join(this.rootDirectory, comparisonId);
  }

  async createComparison(manifest: StudioComparisonManifest): Promise<void> {
    const directory = this.comparisonDirectory(manifest.comparisonId);
    await mkdir(join(directory, "trials"), { recursive: true });
    const configPath = join(directory, "config.json");
    const existing = await this.readOptionalJson<StudioComparisonManifest>(configPath);
    if (existing) {
      if (!deepEqual(existing, manifest)) {
        throw new StudioEvidenceConflictError(`Studio comparison manifest already differs: ${manifest.comparisonId}`);
      }
    } else {
      await atomicWriteJson(configPath, manifest);
    }

    const eventsPath = join(directory, "events.jsonl");
    try {
      await readFile(eventsPath, "utf8");
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
      await writeFile(eventsPath, "", { encoding: "utf8", flag: "wx" });
    }
  }

  async reserveIdempotency(keyHash: string, requestFingerprint: string, comparisonId: string): Promise<void> {
    const path = join(this.rootDirectory, "idempotency", `${keyHash}.json`);
    await mkdir(dirname(path), { recursive: true });
    const existing = await this.readOptionalJson<IdempotencyRecord>(path);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint || existing.comparisonId !== comparisonId) {
        throw new StudioEvidenceConflictError("The idempotency key is already associated with a different Studio request.");
      }
      return;
    }

    try {
      await writeFile(
        path,
        `${stableJson({ schemaVersion: 1, keyHash, requestFingerprint, comparisonId } satisfies IdempotencyRecord)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      const raced = await this.readJson<IdempotencyRecord>(path);
      if (raced.requestFingerprint !== requestFingerprint || raced.comparisonId !== comparisonId) {
        throw new StudioEvidenceConflictError("The idempotency key is already associated with a different Studio request.");
      }
    }
  }

  async findIdempotency(keyHash: string): Promise<IdempotencyRecord | null> {
    return this.readOptionalJson<IdempotencyRecord>(join(this.rootDirectory, "idempotency", `${keyHash}.json`));
  }

  async appendEvent<TPayload extends Record<string, unknown>>(
    comparisonId: string,
    intent: StudioEventIntent<TPayload>,
  ): Promise<StudioEvent<TPayload>> {
    const previous = this.eventQueues.get(comparisonId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.appendEventNow(comparisonId, intent));
    this.eventQueues.set(comparisonId, operation);
    try {
      return await operation;
    } finally {
      if (this.eventQueues.get(comparisonId) === operation) this.eventQueues.delete(comparisonId);
    }
  }

  async writeTrialManifest(manifest: StudioTrialManifest): Promise<void> {
    const path = join(this.trialDirectory(manifest.comparisonId, manifest.trialId), "config.json");
    await writeIdempotent(path, manifest);
  }

  async writeContextEvidence(evidence: StudioContextEvidence): Promise<void> {
    const path = join(this.trialDirectory(evidence.comparisonId, evidence.trialId), "context.json");
    await writeIdempotent(path, evidence);
  }

  async writeTrialResult(result: StudioTrialResult): Promise<void> {
    const path = join(this.trialDirectory(result.comparisonId, result.trialId), "result.json");
    await writeIdempotent(path, result);
  }

  async writeResult(result: StudioComparisonResult): Promise<void> {
    const path = join(this.comparisonDirectory(result.comparisonId), "result.json");
    await writeIdempotent(path, result);
  }

  async writeTrajectory(trajectory: StudioTrajectory): Promise<void> {
    const path = join(this.comparisonDirectory(trajectory.comparisonId), "trajectory.json");
    await writeIdempotent(path, trajectory);
  }

  async writeMetrics(metrics: StudioMetrics): Promise<void> {
    const path = join(this.comparisonDirectory(metrics.comparisonId), "metrics.json");
    await writeIdempotent(path, metrics);
  }

  async readManifest(comparisonId: string): Promise<StudioComparisonManifest> {
    return this.readJson(join(this.comparisonDirectory(comparisonId), "config.json"));
  }

  async readEvents(comparisonId: string): Promise<readonly StudioEvent[]> {
    const path = join(this.comparisonDirectory(comparisonId), "events.jsonl");
    let contents: string;
    try {
      contents = await readFile(path, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw new StudioEvidenceNotFoundError(path);
      throw error;
    }
    if (contents.length === 0) return [];
    return contents.split("\n").flatMap((line, index, lines) => {
      if (index === lines.length - 1 && line === "") return [];
      if (line.trim() === "") throw new StudioCorruptEvidenceError(path, index + 1);
      let event: StudioEvent;
      try {
        event = JSON.parse(line) as StudioEvent;
      } catch {
        throw new StudioCorruptEvidenceError(path, index + 1);
      }
      if (event.schemaVersion !== 1 || event.recordedSequence !== index + 1) {
        throw new StudioCorruptEvidenceError(path, index + 1);
      }
      return [event];
    });
  }

  async readSnapshot(comparisonId: string): Promise<StudioComparisonSnapshot> {
    const directory = this.comparisonDirectory(comparisonId);
    const manifest = await this.readManifest(comparisonId);
    const trialRoot = join(directory, "trials");
    let entries;
    try {
      entries = await readdir(trialRoot, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw new StudioEvidenceNotFoundError(trialRoot);
      throw error;
    }
    const trials: StudioTrialSnapshot[] = [];
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const trialId = entry.name;
      const trialManifest = await this.readJson<StudioTrialManifest>(join(trialRoot, trialId, "config.json"));
      const context = await this.readOptionalJson<StudioContextEvidence>(join(trialRoot, trialId, "context.json"));
      const result = await this.readOptionalJson<StudioTrialResult>(join(trialRoot, trialId, "result.json"));
      trials.push({ manifest: trialManifest, context, result });
    }
    trials.sort((left, right) => left.manifest.ordinal - right.manifest.ordinal);
    return {
      manifest,
      events: await this.readEvents(comparisonId),
      trials,
      trajectory: await this.readOptionalJson<StudioTrajectory>(join(directory, "trajectory.json")),
      metrics: await this.readOptionalJson<StudioMetrics>(join(directory, "metrics.json")),
      result: await this.readOptionalJson<StudioComparisonResult>(join(directory, "result.json")),
    };
  }

  async readAllowlistedFile(comparisonId: string, relativePath: string): Promise<string> {
    assertSafeRelativePath(relativePath);
    const path = join(this.comparisonDirectory(comparisonId), relativePath);
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw new StudioEvidenceNotFoundError(path);
      throw error;
    }
  }

  private async appendEventNow<TPayload extends Record<string, unknown>>(
    comparisonId: string,
    intent: StudioEventIntent<TPayload>,
  ): Promise<StudioEvent<TPayload>> {
    const path = join(this.comparisonDirectory(comparisonId), "events.jsonl");
    const events = await this.readEvents(comparisonId);
    const eventId = `${comparisonId}:${intent.source}:${intent.sourceSequence}`;
    const existing = events.find((event) => event.eventId === eventId);
    if (existing) {
      if (!deepEqual(existing, { schemaVersion: 1, eventId, recordedSequence: existing.recordedSequence, comparisonId, ...intent })) {
        throw new StudioEvidenceConflictError(`Studio event identity has different content: ${eventId}`);
      }
      return existing as StudioEvent<TPayload>;
    }
    const lastSourceSequence = events.reduce(
      (maximum, event) => event.source === intent.source ? Math.max(maximum, event.sourceSequence) : maximum,
      0,
    );
    if (intent.sourceSequence !== lastSourceSequence + 1) {
      throw new StudioEvidenceOrderingError(`Expected ${intent.source} source sequence ${lastSourceSequence + 1}, received ${intent.sourceSequence}.`);
    }
    const event: StudioEvent<TPayload> = {
      schemaVersion: 1,
      eventId,
      recordedSequence: events.length + 1,
      comparisonId,
      ...intent,
    };
    assertSize(event, path, MAX_EVENT_BYTES);
    await appendFile(path, `${stableJson(event)}\n`, "utf8");
    return event;
  }

  private trialDirectory(comparisonId: string, trialId: string): string {
    assertSafeId(comparisonId);
    assertSafeId(trialId);
    return join(this.comparisonDirectory(comparisonId), "trials", trialId);
  }

  private async readJson<T>(path: string): Promise<T> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw new StudioEvidenceNotFoundError(path);
      if (error instanceof SyntaxError) throw new StudioCorruptEvidenceError(path);
      throw error;
    }
  }

  private async readOptionalJson<T>(path: string): Promise<T | null> {
    try {
      return await this.readJson<T>(path);
    } catch (error) {
      if (error instanceof StudioEvidenceNotFoundError) return null;
      throw error;
    }
  }
}

async function writeIdempotent<T>(path: string, value: T): Promise<void> {
  const existing = await readOptionalJson<T>(path);
  if (existing) {
    if (!deepEqual(existing, value)) throw new StudioEvidenceConflictError(`Studio evidence already differs: ${path}`);
    return;
  }
  await atomicWriteJson(path, value);
}

async function readOptionalJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    if (error instanceof SyntaxError) throw new StudioCorruptEvidenceError(path);
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const serialized = `${stableJson(value)}\n`;
  assertSize(value, path, MAX_JSON_BYTES);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function assertSafeId(value: string): void {
  if (!SAFE_ID.test(value)) throw new StudioEvidenceConflictError(`Unsafe Studio identifier: ${value}`);
}

function assertSafeRelativePath(value: string): void {
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") || !/^(config\.json|events\.jsonl|trajectory\.json|metrics\.json|result\.json|trials\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/(config\.json|context\.json|result\.json))$/.test(value)) {
    throw new StudioEvidenceNotFoundError(value);
  }
}

function assertSize(value: unknown, path: string, maximum: number): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maximum) {
    throw new StudioEvidenceConflictError(`Studio evidence exceeds its size limit: ${path}`);
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
