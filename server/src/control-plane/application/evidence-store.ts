import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  RunEvent,
  RunEventIntent,
  RunManifest,
  RunMetrics,
  RunResult,
  RunTrajectory,
  WorkflowExecutionReference,
} from "../domain/types.js";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

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

export interface RunEvidenceSnapshot {
  readonly manifest: RunManifest;
  readonly events: readonly RunEvent[];
  readonly temporalReference: WorkflowExecutionReference | null;
  readonly trajectory: RunTrajectory | null;
  readonly metrics: RunMetrics | null;
  readonly result: RunResult | null;
}

/**
 * Owns the Lab's retained evidence files. Temporal workflow code must not use
 * this class: workflow state is durable in Temporal, while this store is a
 * restart-safe projection of that state for inspection and comparison.
 */
export class RunEvidenceStore {
  private readonly eventQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly rootDirectory: string) {}

  runDirectory(runId: string): string {
    assertSafeRunId(runId);
    return join(this.rootDirectory, runId);
  }

  async createRun(manifest: RunManifest): Promise<void> {
    const runDirectory = this.runDirectory(manifest.runId);
    await mkdir(join(runDirectory, "logs"), { recursive: true });
    await mkdir(join(runDirectory, "artifacts"), { recursive: true });
    await mkdir(join(runDirectory, "native"), { recursive: true });

    const configPath = join(runDirectory, "config.json");
    try {
      const existing = await readJson<RunManifest>(configPath);
      if (!deepEqual(existing, manifest)) {
        throw new EvidenceConflictError(`Run manifest already exists with different content: ${manifest.runId}`);
      }
    } catch (error) {
      if (!(error instanceof EvidenceNotFoundError)) {
        throw error;
      }

      await atomicWriteJson(configPath, manifest);
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
    const previous = this.eventQueues.get(intent.runId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.appendEventNow(intent));
    this.eventQueues.set(intent.runId, operation);

    try {
      return await operation;
    } finally {
      if (this.eventQueues.get(intent.runId) === operation) {
        this.eventQueues.delete(intent.runId);
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

  async writeTemporalReference(runId: string, reference: WorkflowExecutionReference): Promise<void> {
    await this.writeIdempotent(join(this.runDirectory(runId), "native", "temporal.json"), reference);
  }

  async writeResult(result: RunResult): Promise<void> {
    await this.writeIdempotent(join(this.runDirectory(result.runId), "result.json"), result);
  }

  async writeTrajectory(trajectory: RunTrajectory): Promise<void> {
    await this.writeIdempotent(join(this.runDirectory(trajectory.runId), "trajectory.json"), trajectory);
  }

  async writeMetrics(metrics: RunMetrics): Promise<void> {
    await this.writeIdempotent(join(this.runDirectory(metrics.runId), "metrics.json"), metrics);
  }

  async readSnapshot(runId: string): Promise<RunEvidenceSnapshot> {
    const runDirectory = this.runDirectory(runId);
    return {
      manifest: await this.readManifest(runId),
      events: await this.readEvents(runId),
      temporalReference: await this.readOptionalJson<WorkflowExecutionReference>(join(runDirectory, "native", "temporal.json")),
      trajectory: await this.readOptionalJson<RunTrajectory>(join(runDirectory, "trajectory.json")),
      metrics: await this.readOptionalJson<RunMetrics>(join(runDirectory, "metrics.json")),
      result: await this.readOptionalJson<RunResult>(join(runDirectory, "result.json")),
    };
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
    (event.source !== "control-plane" && event.source !== "temporal-workflow")
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

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
