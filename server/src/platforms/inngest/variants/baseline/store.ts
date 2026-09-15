import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import type { RunError, RunMetrics, RunResult, RunTrajectory, RunUsage } from "../../../../control-plane/domain/types.js";
import type {
  InngestEventIntent,
  InngestModelResult,
  InngestPublicRunRecord,
  InngestRunInput,
  InngestRunRecord,
  InngestRunStatus,
} from "./contracts.js";
import { INNGEST_SOURCE } from "./contracts.js";

const STORE_SCHEMA_VERSION = 1;
const STATE_FILE = "runs.json";

interface PersistedState {
  readonly schemaVersion: 1;
  readonly runs: Record<string, InngestRunRecord>;
}

export class InngestRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Inngest run ${runId} was not found.`);
    this.name = "InngestRunNotFoundError";
  }
}

export class InngestRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InngestRunConflictError";
  }
}

/**
 * Small crash-safe local projection owned by the Inngest service.
 *
 * This is not a replacement for Inngest's state store. It gives the Lab a
 * bounded, inspectable projection that survives service replacement and lets
 * the runner reconcile a native function run without writing common evidence
 * from inside a platform function.
 */
export class InngestRunStore {
  private readonly runs = new Map<string, InngestRunRecord>();
  private mutationQueue: Promise<void> = Promise.resolve();
  private loaded = false;

  constructor(private readonly directory: string, private readonly now: () => Date = () => new Date()) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    await mkdir(this.directory, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(join(this.directory, STATE_FILE), "utf8")) as PersistedState;
      if (parsed.schemaVersion !== STORE_SCHEMA_VERSION || !parsed.runs || typeof parsed.runs !== "object") {
        throw new Error("unsupported state schema");
      }
      for (const [runId, record] of Object.entries(parsed.runs)) {
        if (record.runId === runId) this.runs.set(runId, record);
      }
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw new Error(`Could not load Inngest state: ${safeMessage(error)}`);
    }
    this.loaded = true;
  }

  async admit(input: InngestRunInput): Promise<InngestRunRecord> {
    return this.mutate(() => {
      const existing = this.requireLoaded(input.runId);
      const requestHash = requestHashForInput(input);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new InngestRunConflictError("The run ID is already admitted with different request input.");
        }
        return existing;
      }

      const admittedAt = this.now().toISOString();
      const record: InngestRunRecord = {
        runId: input.runId,
        requestHash,
        status: "queued",
        deduplicationId: `agentlab:run:${input.runId}`,
        eventId: null,
        functionRunId: null,
        modelProvider: input.provider,
        model: input.model,
        submissionOutcome: "not_submitted",
        dispatchErrorCode: null,
        cancelEventId: null,
        cancellationRequested: false,
        attemptCount: 0,
        events: [],
        trajectory: null,
        metrics: null,
        result: null,
        admittedAt,
        startedAt: null,
        finishedAt: null,
      };
      this.runs.set(input.runId, record);
      return record;
    });
  }

  async get(runId: string): Promise<InngestRunRecord | null> {
    await this.waitForMutations();
    return this.runs.get(runId) ?? null;
  }

  async markDispatched(
    runId: string,
    update: { readonly eventId: string | null; readonly outcome: InngestRunRecord["submissionOutcome"]; readonly errorCode?: string | null },
  ): Promise<InngestRunRecord> {
    return this.mutate(() => {
      const record = this.requireRun(runId);
      return this.replace(runId, {
        ...record,
        eventId: update.eventId ?? record.eventId,
        submissionOutcome: update.outcome,
        dispatchErrorCode: update.errorCode ?? null,
      });
    });
  }

  async markStarted(runId: string, functionRunId: string, attempt: number): Promise<InngestRunRecord> {
    return this.mutate(() => {
      const record = this.requireRun(runId);
      const startedAt = record.startedAt ?? this.now().toISOString();
      const updated = this.replace(runId, {
        ...record,
        status: record.result ? record.status : "running",
        functionRunId,
        attemptCount: Math.max(record.attemptCount, attempt + 1),
        startedAt,
        trajectory: record.trajectory ?? {
          schemaVersion: 1,
          runId,
          phases: [{ name: "agent_execution", startedAt, finishedAt: null }],
        },
      });
      return this.recordEventInMemory(updated, `agent-started:${functionRunId}`, "AgentStarted", {
        functionRunId,
        attempt,
      });
    });
  }

  async markModelRequested(runId: string, attempt: number): Promise<InngestRunRecord> {
    return this.mutate(() => {
      const record = this.requireRun(runId);
      const updated = ensureModelPhase({
        ...record,
        // Inngest's attempt context is scoped to the failing step and may be
        // reset after a successful step. The projection therefore advances
        // from the observed model request, not only from function admission.
        attemptCount: Math.max(record.attemptCount, attempt + 1),
      }, this.now().toISOString());
      return this.recordEventInMemory(updated, `model-requested:${attempt}`, "ModelRequested", { attempt });
    });
  }

  async markModelCompleted(runId: string, attempt: number, providerRequestId: string | null): Promise<InngestRunRecord> {
    return this.mutate(() => {
      const record = this.requireRun(runId);
      const updated = completeModelPhase(record, this.now().toISOString());
      return this.recordEventInMemory(updated, `model-completed:${attempt}`, "ModelCompleted", {
        attempt,
        providerRequestId,
      });
    });
  }

  async markModelFailed(runId: string, attempt: number, result: Extract<InngestModelResult, { kind: "failure" }>): Promise<InngestRunRecord> {
    return this.mutate(() => {
      const record = this.requireRun(runId);
      const updated = completeModelPhase(record, this.now().toISOString());
      return this.recordEventInMemory(updated, `model-failed:${attempt}`, "ModelFailed", {
        attempt,
        code: result.code,
        failureKind: result.failureKind,
        requestSent: result.requestSent,
      });
    });
  }

  async finish(
    runId: string,
    status: Extract<InngestRunStatus, "completed" | "failed" | "cancelled">,
    details: {
      readonly output: string | null;
      readonly error: RunError | null;
      readonly attemptCount: number;
      readonly usage: RunUsage;
      readonly terminalCode?: string;
    },
  ): Promise<InngestRunRecord> {
    return this.mutate(() => {
      const record = this.requireRun(runId);
      if (record.result) {
        if (record.result.status !== status) {
          throw new InngestRunConflictError(`Run ${runId} already has terminal status ${record.result.status}.`);
        }
        return record;
      }

      const finishedAt = this.now().toISOString();
      const phases = finishPhases(record.trajectory, finishedAt);
      const eventKind = status === "completed" ? "RunCompleted" : status === "cancelled" ? "RunCancelled" : "RunFailed";
      const eventPayload = {
        attempt: details.attemptCount,
        ...(details.terminalCode ? { code: details.terminalCode } : {}),
      };
      const withTerminalEvent = this.recordEventInMemory(
        {
          ...record,
          status,
          attemptCount: Math.max(record.attemptCount, details.attemptCount),
          finishedAt,
          trajectory: phases,
        },
        `terminal:${status}`,
        eventKind,
        eventPayload,
      );
      const result: RunResult = {
        schemaVersion: 1,
        runId,
        status,
        startedAt: record.startedAt,
        finishedAt,
        output: details.output,
        error: details.error,
        attemptCount: Math.max(record.attemptCount, details.attemptCount),
        usage: details.usage,
      };
      const metrics: RunMetrics = {
        schemaVersion: 1,
        runId,
        status,
        durationMs: record.startedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(record.startedAt)) : null,
        modelCallCount: withTerminalEvent.events.filter((event) => event.kind === "ModelRequested").length,
        modelAttemptCount: Math.max(record.attemptCount, details.attemptCount),
        inputTokens: details.usage.inputTokens,
        outputTokens: details.usage.outputTokens,
        totalTokens: details.usage.totalTokens,
        costUsd: null,
      };
      return this.replace(runId, { ...withTerminalEvent, result, metrics });
    });
  }

  async requestCancellation(runId: string, cancelEventId: string): Promise<InngestRunRecord> {
    return this.mutate(() => {
      const record = this.requireRun(runId);
      if (record.result) return record;
      const updated = this.replace(runId, {
        ...record,
        cancellationRequested: true,
        cancelEventId,
      });
      return this.recordEventInMemory(updated, "cancellation-requested", "RunCancellationRequested", { cancelEventId });
    });
  }

  toPublic(record: InngestRunRecord): InngestPublicRunRecord {
    return {
      runId: record.runId,
      requestHash: record.requestHash,
      status: record.status,
      deduplicationId: record.deduplicationId,
      eventId: record.eventId,
      functionRunId: record.functionRunId,
      modelProvider: record.modelProvider,
      model: record.model,
      submissionOutcome: record.submissionOutcome,
      dispatchErrorCode: record.dispatchErrorCode,
      cancelEventId: record.cancelEventId,
      cancellationRequested: record.cancellationRequested,
      attemptCount: record.attemptCount,
      events: record.events,
      trajectory: record.trajectory,
      metrics: record.metrics,
      result: record.result,
      admittedAt: record.admittedAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
    };
  }

  private requireLoaded(runId: string): InngestRunRecord | null {
    if (!this.loaded) throw new Error("InngestRunStore.load() must complete before use.");
    return this.runs.get(runId) ?? null;
  }

  private requireRun(runId: string): InngestRunRecord {
    const record = this.requireLoaded(runId);
    if (!record) throw new InngestRunNotFoundError(runId);
    return record;
  }

  private replace(runId: string, record: InngestRunRecord): InngestRunRecord {
    this.runs.set(runId, record);
    return record;
  }

  private recordEventInMemory(record: InngestRunRecord, key: string, kind: string, payload: Record<string, unknown>): InngestRunRecord {
    const existing = record.events.find((event) => event.key === key);
    if (existing) {
      if (existing.kind !== kind || JSON.stringify(existing.payload) !== JSON.stringify(payload)) {
        throw new InngestRunConflictError(`Event key ${key} already has different content.`);
      }
      return record;
    }
    const event: InngestEventIntent = {
      key,
      source: INNGEST_SOURCE,
      sourceSequence: record.events.length + 1,
      kind,
      runId: record.runId,
      occurredAt: this.now().toISOString(),
      payload,
    };
    return this.replace(record.runId, { ...record, events: [...record.events, event] });
  }

  private async waitForMutations(): Promise<void> {
    await this.mutationQueue;
  }

  private async mutate<T>(operation: () => T): Promise<T> {
    let resolveResult!: (value: T) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const previous = this.mutationQueue;
    this.mutationQueue = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          const value = operation();
          await this.persist();
          resolveResult(value);
        } catch (error) {
          rejectResult(error);
        }
      });
    return result;
  }

  private async persist(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporaryPath = join(this.directory, `${STATE_FILE}.tmp`);
    const state: PersistedState = {
      schemaVersion: STORE_SCHEMA_VERSION,
      runs: Object.fromEntries(this.runs.entries()),
    };
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, join(this.directory, STATE_FILE));
  }
}

export function requestHashForInput(input: InngestRunInput): string {
  return createHash("sha256").update(JSON.stringify({
    model: input.model,
    prompt: input.prompt,
    provider: input.provider,
    systemInstruction: input.systemInstruction,
  })).digest("hex");
}

function ensureModelPhase(record: InngestRunRecord, startedAt: string): InngestRunRecord {
  if (record.trajectory?.phases.some((phase) => phase.name === "model_request")) return record;
  return {
    ...record,
    trajectory: {
      schemaVersion: 1,
      runId: record.runId,
      phases: [
        ...(record.trajectory?.phases ?? []),
        { name: "model_request", startedAt, finishedAt: null },
      ],
    },
  };
}

function completeModelPhase(record: InngestRunRecord, finishedAt: string): InngestRunRecord {
  if (!record.trajectory) return record;
  return {
    ...record,
    trajectory: {
      ...record.trajectory,
      phases: record.trajectory.phases.map((phase) =>
        phase.name === "model_request" && phase.finishedAt === null ? { ...phase, finishedAt } : phase,
      ),
    },
  };
}

function finishPhases(trajectory: RunTrajectory | null, finishedAt: string): RunTrajectory | null {
  if (!trajectory) return null;
  return {
    ...trajectory,
    phases: trajectory.phases.map((phase) => (phase.finishedAt === null ? { ...phase, finishedAt } : phase)),
  };
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
