import { createHash, randomUUID } from "node:crypto";
import { appendFile, lstat, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";

import type {
  OperationalLogEntry,
  OperationalLogIntent,
  RunEvent,
  RunEventIdentity,
  RunEventIntent,
  RunManifest,
  RunMetrics,
  PlatformExecutionReference,
  RunResult,
  RunTrajectory,
} from "../domain/types.js";
import type { ContextSnapshot } from "../../capabilities/context/contracts.js";
import { assertRunEvalReport, type RunEvalReport } from "../domain/eval-report.js";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const EVENT_PLATFORM_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EVENT_ATTEMPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LEGACY_ATTEMPT_ID = "legacy";

interface ResolvedEventIdentity extends RunEventIdentity {
  /** Whether the event uses the post-legacy explicit identity fields. */
  readonly scoped: boolean;
}
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_EVENT_BYTES = 256 * 1024;
const MAX_EXECUTION_REFERENCE_BYTES = 128 * 1024;
const MAX_RESULT_BYTES = 512 * 1024;
const MAX_TRAJECTORY_BYTES = 512 * 1024;
const MAX_METRICS_BYTES = 128 * 1024;
const MAX_CONTEXT_BYTES = 512 * 1024;
const MAX_CAPABILITIES_BYTES = 256 * 1024;
const MAX_EVAL_REPORT_BYTES = 256 * 1024;
const MAX_OPERATIONAL_LOG_LINE_BYTES = 32 * 1024;
const MAX_OPERATIONAL_LOG_BYTES = 8 * 1024 * 1024;
const OPERATIONAL_LOG_FILE = "logs/operations.jsonl" as const;

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

    const capabilities = safeManifest.capabilities?.resolution ?? {
      profileId: safeManifest.capabilities?.profileId ?? null,
      grants: [],
      decisions: [],
    };
    const capabilitiesPath = join(runDirectory, "capabilities.json");
    assertEvidenceSize(capabilities, capabilitiesPath, MAX_CAPABILITIES_BYTES);
    await this.writeIdempotent(capabilitiesPath, capabilities);
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

  /**
   * Appends bounded operator evidence without making it part of the run's
   * event ordering contract. Operational logs are diagnostic and at-least-once:
   * a failed log write must never change the platform result.
   */
  async appendOperationalLog(intent: OperationalLogIntent): Promise<OperationalLogEntry> {
    const safeIntent = sanitizeEvidenceValue(intent) as OperationalLogIntent;
    validateOperationalLogIntent(safeIntent);
    const previous = this.eventQueues.get(safeIntent.runId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.appendOperationalLogNow(safeIntent));
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
    const manifest = await this.readManifest(runId);
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
      validateStoredEvent(event, path, index + 1, runId, manifest.platform);
      return [event];
    });

    validateEventCollection(events, path, manifest.platform);
    return events;
  }

  async writeExecutionReference(
    runId: string,
    reference: PlatformExecutionReference,
    options: { readonly allowIdentityChange?: boolean } = {},
  ): Promise<void> {
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
      if (existing.executionId !== safeReference.executionId && !options.allowIdentityChange) {
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
    const safeSnapshot = redactContextSnapshot(sanitizeEvidenceValue(snapshot) as ContextSnapshot);
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

  /** Retains one bounded, immutable case verdict alongside its ordinary run evidence. */
  async writeEvalReport(runId: string, report: RunEvalReport, options: { graderRevision?: true } = {}): Promise<void> {
    assertRunEvalReport(report);
    if (options.graderRevision && !["3", "4"].includes(report.graderVersion)) throw new Error("Only bounded grader-3/4 revision artifacts are supported.");
    if (report.ownerRunId !== runId) {
      throw new EvidenceConflictError(`Eval report belongs to a different run: ${runId}`);
    }
    const owner = await this.readManifest(runId);
    for (const correlatedRunId of report.runIds) {
      const correlated = await this.readManifest(correlatedRunId);
      if (correlated.platform !== owner.platform || correlated.variant !== owner.variant ||
          (report.caseId === "B03" && correlated.context.sessionId !== owner.context.sessionId)) {
        throw new EvidenceConflictError(`Eval report correlates incompatible runs: ${correlatedRunId}`);
      }
    }
    const safeReport = sanitizeEvidenceValue(report) as RunEvalReport;
    const fileName = options.graderRevision ? (report.graderVersion === "4" ? "artifacts/eval-grader-4.json" : "artifacts/eval-grader-3.json") : "artifacts/eval.json";
    const path = join(this.runDirectory(runId), fileName);
    await mkdir(dirname(path), { recursive: true });
    await this.assertEvalDirectories(runId);
    const existing = await lstat(path).catch(error => { if (isNodeError(error, "ENOENT")) return null; throw error; });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new CorruptEvidenceError(path);
    assertEvidenceSize(safeReport, path, MAX_EVAL_REPORT_BYTES);
    await this.writeIdempotent(path, safeReport);
  }

  private async assertEvalDirectories(runId: string): Promise<void> {
    for (const path of [this.runDirectory(runId), join(this.runDirectory(runId), "artifacts")]) {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new CorruptEvidenceError(path);
    }
  }

  async readEvalReport(runId: string, fileName: "artifacts/eval.json" | "artifacts/eval-grader-3.json" | "artifacts/eval-grader-4.json" = "artifacts/eval.json"): Promise<RunEvalReport | null> {
    if (fileName !== "artifacts/eval.json" && fileName !== "artifacts/eval-grader-3.json" && fileName !== "artifacts/eval-grader-4.json") throw new Error("Unsupported eval report revision artifact.");
    await this.readManifest(runId);
    const path = join(this.runDirectory(runId), fileName);
    let report: unknown;
    try {
      await this.assertEvalDirectories(runId);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_EVAL_REPORT_BYTES) throw new CorruptEvidenceError(path);
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const buffer = Buffer.alloc(MAX_EVAL_REPORT_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_EVAL_REPORT_BYTES) throw new CorruptEvidenceError(path);
        report = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
      } finally { await handle.close(); }
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw new CorruptEvidenceError(path);
    }
    try {
      assertRunEvalReport(report);
      if (report.ownerRunId !== runId || (fileName === "artifacts/eval-grader-3.json" && report.graderVersion !== "3") || (fileName === "artifacts/eval-grader-4.json" && report.graderVersion !== "4")) throw new Error("Eval owner or grader mismatch.");
    } catch { throw new CorruptEvidenceError(path); }
    return report;
  }

  /** Inspect an already-retained hosted call. Reading never retries execution.
   * Raw action-review arguments are stored separately and are not exposed here.
   */
  async readToolReceipt(runId: string, toolCallId: string): Promise<Readonly<Record<string, unknown>>> {
    await this.readManifest(runId);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(toolCallId)) throw new Error("Invalid tool call identity.");
    const directory = join(this.runDirectory(runId), "artifacts/capability-calls");
    const path = join(directory, `${createHash("sha256").update(toolCallId).digest("hex")}.json`);
    try {
      for (const ancestor of [dirname(directory), directory]) {
        const info = await lstat(ancestor);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new CorruptEvidenceError(path);
      }
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new CorruptEvidenceError(path);
        if (info.size > 16 * 1024 * 1024) throw new EvidenceLimitError(path, 16 * 1024 * 1024);
        const receipt: unknown = JSON.parse(await handle.readFile("utf8"));
        if (!isRecord(receipt) || receipt.schemaVersion !== 1 || receipt.toolCallId !== toolCallId ||
            !["pending", "complete"].includes(String(receipt.status))) throw new CorruptEvidenceError(path);
        return sanitizeEvidenceValue(receipt) as Readonly<Record<string, unknown>>;
      } finally { await handle.close(); }
    } catch (error) {
      if (isNodeError(error, "ENOENT")) throw new EvidenceNotFoundError(path);
      throw error;
    }
  }

  async readAllowlistedFile(runId: string, fileName: EvidenceFileName): Promise<string> {
    const manifest = await this.readManifest(runId);
    if (!isAllowlistedEvidenceFile(fileName, manifest.platform)) {
      throw new Error(`Unsupported evidence file: ${fileName}`);
    }
    if (fileName === "artifacts/eval.json" || fileName === "artifacts/eval-grader-3.json" || fileName === "artifacts/eval-grader-4.json") {
      const report = await this.readEvalReport(runId, fileName);
      if (report === null) throw new EvidenceNotFoundError(join(this.runDirectory(runId), fileName));
      return `${stableJson(report)}\n`;
    }
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
    const manifest = await this.readManifest(intent.runId);
    const identity = resolveEventIdentity(intent, manifest.platform);
    const events = await this.readEvents(intent.runId);
    const existing = events.find((event) => sameEventIdentity(storedEventIdentity(event, manifest.platform), identity));
    if (existing) {
      if (!sameEventIntent(existing, intent, identity, manifest.platform)) {
        throw new EvidenceConflictError(`Event identity has different content: ${eventIdentityId(identity)}`);
      }
      return existing as RunEvent<TPayload>;
    }

    const lastSourceSequence = events.reduce(
      (maximum, event) => (
        sameEventStream(storedEventIdentity(event, manifest.platform), identity)
          ? Math.max(maximum, event.sourceSequence)
          : maximum
      ),
      0,
    );
    if (intent.sourceSequence !== lastSourceSequence + 1) {
      throw new EventOrderingError(
        `Expected ${identity.platform}/${identity.runId}/${identity.attemptId}/${identity.source} source sequence ${lastSourceSequence + 1}, received ${intent.sourceSequence}.`,
      );
    }

    const lastRecordedSequence = events.at(-1)?.recordedSequence ?? 0;
    if (events.some((event, index) => event.recordedSequence !== index + 1)) {
      throw new CorruptEvidenceError(path);
    }

    const event: RunEvent<TPayload> = {
      schemaVersion: 1,
      eventId: eventIdentityId(identity),
      recordedSequence: lastRecordedSequence + 1,
      ...(identity.attemptId === LEGACY_ATTEMPT_ID && !identity.scoped ? {} : {
        platform: identity.platform,
        attemptId: identity.attemptId,
      }),
      source: intent.source,
      sourceSequence: intent.sourceSequence,
      kind: intent.kind,
      runId: intent.runId,
      occurredAt: intent.occurredAt,
      payload: intent.payload,
    };
    assertEvidenceSize(event, path, MAX_EVENT_BYTES);
    await appendFile(path, `${stableJson(event)}\n`, "utf8");
    const operationalLog = operationalLogForEvent(event, manifest);
    if (operationalLog) {
      // The normalized event is authoritative. A diagnostic log write may be
      // lost during an outage and must never change the run result or event
      // ordering contract.
      await this.appendOperationalLogNow(operationalLog).catch(() => undefined);
    }
    return event;
  }

  private async appendOperationalLogNow(intent: OperationalLogIntent): Promise<OperationalLogEntry> {
    const path = join(this.runDirectory(intent.runId), OPERATIONAL_LOG_FILE);
    await mkdir(dirname(path), { recursive: true });

    let contents = "";
    try {
      contents = await readFile(path, "utf8");
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }

    const recordedSequence = contents.length === 0 ? 1 : contents.split("\n").filter(Boolean).length + 1;
    const entry: OperationalLogEntry = {
      schemaVersion: 1,
      logId: `${intent.runId}:log:${recordedSequence}:${randomUUID()}`,
      recordedSequence,
      ...intent,
    };
    assertEvidenceSize(entry, path, MAX_OPERATIONAL_LOG_LINE_BYTES);
    const line = `${stableJson(entry)}\n`;
    if (Buffer.byteLength(contents, "utf8") + Buffer.byteLength(line, "utf8") > MAX_OPERATIONAL_LOG_BYTES) {
      throw new EvidenceLimitError(path, MAX_OPERATIONAL_LOG_BYTES);
    }
    await appendFile(path, line, "utf8");
    return entry;
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

function redactContextSnapshot(snapshot: ContextSnapshot): ContextSnapshot {
  return {
    ...snapshot,
    messages: snapshot.messages.map((message) => message.source === "skills"
      ? {
          ...message,
          content: "[skill context redacted from run evidence]",
        }
      : message),
  };
}

function operationalLogForEvent(event: RunEvent, manifest: RunManifest): OperationalLogIntent | null {
  const payload = isRecord(event.payload) ? event.payload : {};
  const kind = event.kind;
  let operation: string;
  let level: OperationalLogIntent["level"] = "info";

  if (kind === "CapabilityResolutionRecorded") {
    operation = "capability.resolve";
    level = hasDeniedDecision(payload) ? "warn" : "info";
  } else if (kind === "ToolExecutionStarted") {
    operation = "tool.execute";
  } else if (kind === "ToolExecutionCompleted") {
    operation = "tool.execute";
  } else if (kind === "ToolExecutionFailed" || kind === "ToolCallRejected" || kind === "ToolPolicyDenied") {
    operation = kind === "ToolPolicyDenied" ? "tool.approval" : "tool.execute";
    level = "warn";
  } else if (kind === "ToolExecutionCancelled") {
    operation = "tool.execute";
    level = "warn";
  } else if (kind === "ToolExecutionUnknown" || kind.endsWith("OutcomeUnknown")) {
    operation = "connection.unknown";
    level = "warn";
  } else if (kind === "ModelRetryScheduled" || kind === "ModelRetryRequested") {
    operation = "model.retry";
    level = "warn";
  } else if (kind === "OAuthRefreshStarted" || kind === "OAuthRefreshCompleted" || kind === "OAuthRefreshFailed") {
    operation = "oauth.refresh";
    level = kind === "OAuthRefreshFailed" ? "warn" : "info";
  } else {
    return null;
  }

  const connection = isRecord(payload.connection) ? payload.connection : null;
  const requestId = firstString(payload.requestId, payload.operationId, connection?.requestId, payload.toolCallId);
  const providerRequestId = firstString(
    payload.providerRequestId,
    connection?.providerRequestId,
    Array.isArray(connection?.providerRequestIds) ? connection.providerRequestIds[0] : null,
  );
  const status = kind === "CapabilityResolutionRecorded"
    ? (hasDeniedDecision(payload) ? "denied" : "granted")
    : firstString(payload.status, connection?.status) ?? statusForEvent(kind);
  const code = firstString(payload.code, connection?.errorCode);
  const durationMs = finiteNonNegativeNumber(payload.durationMs);
  const retryCount = finiteNonNegativeNumber(payload.retryCount)
    ?? (kind === "ModelRetryScheduled" && finiteNonNegativeNumber(payload.nextAttempt) !== null
      ? Math.max(0, Number(payload.nextAttempt) - 1)
      : null);
  const outcome = kind === "CapabilityResolutionRecorded"
    ? `${arrayLength(payload.grants)} grants/${arrayLength(payload.decisions)} decisions`
    : status;

  return {
    runId: event.runId,
    occurredAt: event.occurredAt,
    level,
    operation,
    ...(requestId ? { requestId } : {}),
    ...(providerRequestId ? { providerRequestId } : {}),
    platform: manifest.platform,
    variant: manifest.variant,
    ...(status ? { status } : {}),
    ...(typeof payload.nativeStatus === "string" ? { nativeStatus: payload.nativeStatus } : {}),
    ...(outcome ? { outcome } : {}),
    ...(durationMs !== null ? { durationMs } : {}),
    ...(retryCount !== null ? { retryCount } : {}),
    ...(code ? { code } : {}),
  };
}

function hasDeniedDecision(payload: Record<string, unknown>): boolean {
  return Array.isArray(payload.decisions)
    && payload.decisions.some((decision) => isRecord(decision) && decision.status === "denied");
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value.slice(0, 256);
  }
  return null;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function statusForEvent(kind: string): string {
  if (kind === "ToolExecutionStarted") return "started";
  if (kind === "ToolExecutionCompleted") return "completed";
  if (kind === "ToolExecutionCancelled") return "cancelled";
  if (kind === "ToolCallRejected" || kind === "ToolPolicyDenied") return "denied";
  if (kind === "ModelRetryScheduled" || kind === "ModelRetryRequested") return "scheduled";
  if (kind === "OAuthRefreshStarted") return "started";
  if (kind === "OAuthRefreshCompleted") return "completed";
  if (kind === "OAuthRefreshFailed") return "failed";
  return "failed";
}

export type EvidenceFileName =
  | "config.json"
  | "capabilities.json"
  | "events.jsonl"
  | "trajectory.json"
  | "metrics.json"
  | "context.json"
  | "result.json"
  | "artifacts/eval.json"
  | "artifacts/eval-grader-3.json"
  | "artifacts/eval-grader-4.json"
  | "logs/operations.jsonl"
  | `native/${string}.json`;

export function isAllowlistedEvidenceFile(fileName: string, platform: string): fileName is EvidenceFileName {
  return fileName === "config.json" ||
    fileName === "capabilities.json" ||
    fileName === "events.jsonl" ||
    fileName === "trajectory.json" ||
    fileName === "metrics.json" ||
    fileName === "context.json" ||
    fileName === "result.json" ||
    fileName === "artifacts/eval.json" ||
    fileName === "artifacts/eval-grader-3.json" ||
    fileName === "artifacts/eval-grader-4.json" ||
    fileName === OPERATIONAL_LOG_FILE ||
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

function resolveEventIdentity(intent: RunEventIntent, manifestPlatform: string): ResolvedEventIdentity {
  const platform = intent.platform ?? manifestPlatform;
  if (!EVENT_PLATFORM_PATTERN.test(platform)) {
    throw new EvidenceConflictError("Event platform is not a valid platform identifier.");
  }
  if (platform !== manifestPlatform) {
    throw new EvidenceConflictError(`Event platform does not match the run manifest: ${platform}.`);
  }

  const scoped = intent.platform !== undefined || intent.attemptId !== undefined;
  const attemptId = intent.attemptId ?? LEGACY_ATTEMPT_ID;
  if (!EVENT_ATTEMPT_ID_PATTERN.test(attemptId)) {
    throw new EvidenceConflictError("Event attempt identity is not safe.");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(intent.source)) {
    throw new EvidenceConflictError("Event source is not a valid source identifier.");
  }
  if (!Number.isInteger(intent.sourceSequence) || intent.sourceSequence < 1) {
    throw new EventOrderingError("Event source sequence must be a positive integer.");
  }

  return {
    platform,
    runId: intent.runId,
    attemptId,
    source: intent.source,
    sourceSequence: intent.sourceSequence,
    scoped,
  };
}

function storedEventIdentity(event: RunEvent, expectedPlatform: string): ResolvedEventIdentity {
  const hasPlatform = event.platform !== undefined;
  const hasAttemptId = event.attemptId !== undefined;
  if (hasPlatform !== hasAttemptId) {
    throw new Error("Stored event has a partial scoped identity.");
  }

  const platform = event.platform ?? expectedPlatform;
  const attemptId = event.attemptId ?? LEGACY_ATTEMPT_ID;
  if (!EVENT_PLATFORM_PATTERN.test(platform) || !EVENT_ATTEMPT_ID_PATTERN.test(attemptId)) {
    throw new Error("Stored event has an unsafe scoped identity.");
  }

  return {
    platform,
    runId: event.runId,
    attemptId,
    source: event.source,
    sourceSequence: event.sourceSequence,
    scoped: hasPlatform,
  };
}

function eventIdentityId(identity: ResolvedEventIdentity): string {
  if (!identity.scoped) {
    // Keep schema-v1 IDs stable for old producers and existing evidence files.
    return `${identity.runId}:${identity.source}:${identity.sourceSequence}`;
  }
  return `${identity.platform}:${identity.runId}:${encodeURIComponent(identity.attemptId)}:${identity.source}:${identity.sourceSequence}`;
}

function eventStreamKey(identity: RunEventIdentity): string {
  return `${identity.platform}\u0000${identity.runId}\u0000${identity.attemptId}\u0000${identity.source}`;
}

function sameEventIdentity(left: RunEventIdentity, right: RunEventIdentity): boolean {
  return (
    left.platform === right.platform &&
    left.runId === right.runId &&
    left.attemptId === right.attemptId &&
    left.source === right.source &&
    left.sourceSequence === right.sourceSequence
  );
}

function sameEventStream(left: RunEventIdentity, right: RunEventIdentity): boolean {
  return (
    left.platform === right.platform &&
    left.runId === right.runId &&
    left.attemptId === right.attemptId &&
    left.source === right.source
  );
}

function sameEventIntent(
  event: RunEvent,
  intent: RunEventIntent,
  identity: ResolvedEventIdentity,
  expectedPlatform: string,
): boolean {
  return (
    sameEventIdentity(storedEventIdentity(event, expectedPlatform), identity) &&
    event.kind === intent.kind &&
    event.occurredAt === intent.occurredAt &&
    deepEqual(event.payload, intent.payload)
  );
}

function validateOperationalLogIntent(intent: OperationalLogIntent): void {
  assertSafeRunId(intent.runId);
  if (!isIsoDate(intent.occurredAt)) throw new Error("Operational log timestamps must be valid ISO dates.");
  if (!(["info", "warn", "error"] as const).includes(intent.level)) {
    throw new Error("Operational log level is invalid.");
  }
  if (!/^[a-z][a-z0-9._:-]{0,127}$/.test(intent.operation)) {
    throw new Error("Operational log operation is not safe.");
  }
  for (const value of [intent.requestId, intent.providerRequestId, intent.platform, intent.variant, intent.status, intent.nativeStatus, intent.outcome, intent.code]) {
    if (value !== undefined && (!isSafeOperationalString(value) || value.length > 256)) {
      throw new Error("Operational log contains an unsafe string.");
    }
  }
  for (const [name, value] of [["duration", intent.durationMs], ["retry count", intent.retryCount]] as const) {
    if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0 || !Number.isInteger(value))) {
      throw new Error(`Operational log ${name} must be a finite non-negative integer.`);
    }
  }
}

function isIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && isSafeOperationalString(value);
}

function isSafeOperationalString(value: string): boolean {
  return typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validateStoredEvent(event: RunEvent, path: string, line: number, expectedRunId: string, expectedPlatform: string): void {
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

  let identity: ResolvedEventIdentity;
  try {
    identity = storedEventIdentity(event, expectedPlatform);
  } catch {
    throw new CorruptEvidenceError(path, line);
  }
  if (event.runId !== expectedRunId || identity.platform !== expectedPlatform || event.eventId !== eventIdentityId(identity)) {
    throw new CorruptEvidenceError(path, line);
  }
}

function validateEventCollection(events: readonly RunEvent[], path: string, expectedPlatform: string): void {
  const sourceSequences = new Map<string, number>();

  for (const [index, event] of events.entries()) {
    if (event.recordedSequence !== index + 1) {
      throw new CorruptEvidenceError(path, index + 1);
    }

    const streamKey = eventStreamKey(storedEventIdentity(event, expectedPlatform));
    const expectedSourceSequence = (sourceSequences.get(streamKey) ?? 0) + 1;
    if (event.sourceSequence !== expectedSourceSequence) {
      throw new CorruptEvidenceError(path, index + 1);
    }
    sourceSequences.set(streamKey, event.sourceSequence);
  }
}

function isNodeError(error: unknown, code?: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (code === undefined || (error as NodeJS.ErrnoException).code === code);
}
