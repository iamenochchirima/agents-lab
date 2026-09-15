import { TriggerClient } from "@trigger.dev/sdk";

import type {
  PlatformExecutionReference,
  RunEventIntent,
  RunManifest,
  RunMetrics,
  RunResult,
  RunTrajectory,
} from "../../../control-plane/domain/types.js";
import type {
  PlatformRunner,
  RunnerCancellationResult,
  RunnerConnectivity,
  RunnerInspection,
  RunnerValidationResult,
} from "../../../control-plane/ports/runner.js";
import {
  TRIGGER_DEV_PLATFORM,
  TRIGGER_DEV_VARIANT,
  TRIGGER_DEV_VERSION,
  TRIGGER_TASK_IDENTIFIER,
  loadTriggerDevConfig,
  safeManifestConfiguration,
  type TriggerDevConfig,
} from "../config.js";
import type { TriggerPromptPayload, TriggerTaskOutput } from "../variants/baseline/contracts.js";

const NATIVE_SCHEMA_VERSION = 1;
const UNKNOWN_EXECUTION_PREFIX = "trigger-dev:unknown:";

export interface TriggerRunHandle {
  readonly id: string;
  readonly isCached?: boolean;
  readonly taskIdentifier?: string;
}

export interface TriggerRunRecord {
  readonly id: string;
  readonly status: TriggerRunStatus;
  readonly taskIdentifier: string;
  readonly idempotencyKey?: string;
  readonly createdAt?: Date | string;
  readonly updatedAt?: Date | string;
  readonly startedAt?: Date | string;
  readonly finishedAt?: Date | string;
  readonly durationMs?: number;
  readonly attemptCount?: number;
  readonly output?: unknown;
  readonly error?: { readonly message: string; readonly name?: string; readonly stackTrace?: string };
}

export type TriggerRunStatus =
  | "PENDING_VERSION"
  | "QUEUED"
  | "DEQUEUED"
  | "EXECUTING"
  | "WAITING"
  | "COMPLETED"
  | "CANCELED"
  | "FAILED"
  | "CRASHED"
  | "SYSTEM_FAILURE"
  | "DELAYED"
  | "EXPIRED"
  | "TIMED_OUT";

export interface TriggerApi {
  readonly tasks: {
    trigger(taskIdentifier: string, payload: TriggerPromptPayload, options: TriggerTriggerOptions): Promise<TriggerRunHandle>;
  };
  readonly runs: {
    retrieve(runId: string): Promise<TriggerRunRecord>;
    cancel(runId: string): Promise<unknown>;
  };
}

export interface TriggerTriggerOptions {
  readonly idempotencyKey: string;
  readonly idempotencyKeyTTL: string;
  readonly maxAttempts: number;
}

export interface TriggerDevRunnerOptions {
  readonly config: TriggerDevConfig;
  readonly client?: TriggerApi;
  readonly now?: () => Date;
}

interface NativeTriggerReference {
  readonly schemaVersion: 1;
  readonly taskIdentifier: string;
  readonly triggerRunId: string | null;
  readonly idempotencyKey: string;
  readonly idempotencyKeyScope: "global";
  readonly submissionOutcome: "accepted" | "already_accepted" | "unknown";
  readonly apiUrl: string;
  readonly nativeStatus: TriggerRunStatus | null;
  readonly attemptCount: number | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly errorCode?: string;
}

/**
 * Deep adapter for the official Trigger.dev SDK. It intentionally does not
 * keep run state in memory: the Trigger run ID and idempotency key are the
 * recovery boundary after a Lab-server restart.
 */
export class TriggerDevBaselineRunner implements PlatformRunner {
  readonly platform = TRIGGER_DEV_PLATFORM;
  readonly variant = TRIGGER_DEV_VARIANT;

  private readonly client: TriggerApi;
  private readonly now: () => Date;

  constructor(private readonly options: TriggerDevRunnerOptions) {
    this.client = options.client ?? createTriggerClient(options.config);
    this.now = options.now ?? (() => new Date());
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): TriggerDevBaselineRunner {
    return new TriggerDevBaselineRunner({ config: loadTriggerDevConfig(environment) });
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return safeManifestConfiguration(this.options.config);
  }

  validate(manifest: RunManifest): RunnerValidationResult {
    if (manifest.platform !== this.platform || manifest.variant !== this.variant) {
      return { valid: false, reason: "The Trigger.dev baseline runner only accepts trigger-dev/baseline manifests." };
    }
    if (manifest.model.provider !== "fake") {
      return { valid: false, reason: "The Trigger.dev baseline currently supports only the deterministic fake model." };
    }
    if (manifest.platformConfig.taskIdentifier !== this.options.config.taskIdentifier) {
      return { valid: false, reason: "The run task identifier does not match the configured Trigger.dev task." };
    }
    if (manifest.platformConfig.apiUrl !== this.options.config.apiUrl) {
      return { valid: false, reason: "The run API URL does not match the configured Trigger.dev profile." };
    }
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    if (!this.options.config.secretKey) {
      return { reachable: false, message: "TRIGGER_SECRET_KEY is not configured for the Trigger.dev profile." };
    }
    try {
      await this.client.runs.retrieve("agentlab-connectivity-check");
      return { reachable: true, message: "Trigger.dev API is reachable." };
    } catch (error) {
      const status = httpStatus(error);
      if (status === 404) return { reachable: true, message: "Trigger.dev API is reachable." };
      if (status === 401 || status === 403) return { reachable: false, message: "Trigger.dev rejected the configured secret key." };
      if (status !== undefined) return { reachable: false, message: `Trigger.dev API returned HTTP ${status}.` };
      return { reachable: false, message: safeMessage(error, "Trigger.dev API is unavailable.") };
    }
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    const validation = this.validate(manifest);
    if (!validation.valid) throw new Error(validation.reason ?? "Trigger.dev manifest validation failed.");

    const payload: TriggerPromptPayload = {
      runId: manifest.runId,
      prompt: manifest.task.prompt,
      systemInstruction: manifest.context.systemInstruction,
      model: manifest.model,
    };
    const triggerOptions: TriggerTriggerOptions = {
      idempotencyKey: manifest.runId,
      idempotencyKeyTTL: this.options.config.idempotencyKeyTtl,
      maxAttempts: this.options.config.maxAttempts,
    };

    try {
      const handle = await this.client.tasks.trigger(this.options.config.taskIdentifier, payload, triggerOptions);
      return referenceFor(this.options.config, manifest.runId, handle, handle.isCached ? "already_accepted" : "accepted");
    } catch (error) {
      if (!isAmbiguousTriggerError(error)) throw new Error(`Trigger.dev rejected task admission: ${safeMessage(error, "unknown rejection")}`);
      // The first request may have reached Trigger.dev before its response was
      // lost. Repeating the exact idempotent request is safe and can return the
      // original run handle; never generate a new key after an ambiguous ack.
      try {
        const handle = await this.client.tasks.trigger(this.options.config.taskIdentifier, payload, triggerOptions);
        return referenceFor(this.options.config, manifest.runId, handle, "already_accepted");
      } catch (retryError) {
        return unknownReference(this.options.config, manifest.runId, classifyAdmissionError(retryError));
      }
    }
  }

  async cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    const native = nativeReferenceFrom(reference);
    if (!native.triggerRunId) {
      return { accepted: false, alreadyTerminal: false, message: "Trigger.dev did not confirm a run ID to cancel." };
    }
    const current = await this.client.runs.retrieve(native.triggerRunId);
    if (isTerminal(current.status)) {
      return { accepted: false, alreadyTerminal: true, message: `Trigger.dev run is already ${current.status}.` };
    }
    await this.client.runs.cancel(native.triggerRunId);
    return {
      accepted: true,
      alreadyTerminal: false,
      message: reason.trim() ? `Trigger.dev cancellation requested: ${safeHeader(reason)}` : "Trigger.dev cancellation requested.",
    };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const native = nativeReferenceFrom(reference);
    if (!native.triggerRunId) return unknownAdmissionInspection(reference, native.errorCode);
    const run = await this.client.runs.retrieve(native.triggerRunId);
    const updatedReference = updateReference(reference, run);
    return inspectionFromRun(updatedReference, run, this.now);
  }
}

function createTriggerClient(config: TriggerDevConfig): TriggerApi {
  return new TriggerClient({
    baseURL: config.apiUrl,
    accessToken: config.secretKey ?? undefined,
  }) as unknown as TriggerApi;
}

function referenceFor(
  config: TriggerDevConfig,
  runId: string,
  handle: TriggerRunHandle,
  submissionOutcome: "accepted" | "already_accepted",
): PlatformExecutionReference {
  return {
    platform: TRIGGER_DEV_PLATFORM,
    variant: TRIGGER_DEV_VARIANT,
    executionId: handle.id,
    native: {
      schemaVersion: NATIVE_SCHEMA_VERSION,
      taskIdentifier: config.taskIdentifier,
      triggerRunId: handle.id,
      idempotencyKey: runId,
      idempotencyKeyScope: "global",
      submissionOutcome,
      apiUrl: config.apiUrl,
      nativeStatus: "QUEUED",
      attemptCount: null,
      startedAt: null,
      finishedAt: null,
    } satisfies NativeTriggerReference,
  };
}

function unknownReference(config: TriggerDevConfig, runId: string, errorCode: string): PlatformExecutionReference {
  return {
    platform: TRIGGER_DEV_PLATFORM,
    variant: TRIGGER_DEV_VARIANT,
    executionId: `${UNKNOWN_EXECUTION_PREFIX}${runId}`,
    native: {
      schemaVersion: NATIVE_SCHEMA_VERSION,
      taskIdentifier: config.taskIdentifier,
      triggerRunId: null,
      idempotencyKey: runId,
      idempotencyKeyScope: "global",
      submissionOutcome: "unknown",
      apiUrl: config.apiUrl,
      nativeStatus: null,
      attemptCount: null,
      startedAt: null,
      finishedAt: null,
      errorCode,
    } satisfies NativeTriggerReference,
  };
}

function nativeReferenceFrom(reference: PlatformExecutionReference): NativeTriggerReference {
  if (reference.platform !== TRIGGER_DEV_PLATFORM || reference.variant !== TRIGGER_DEV_VARIANT) {
    throw new Error("The execution reference does not belong to the Trigger.dev baseline runner.");
  }
  const native = reference.native;
  if (
    native.schemaVersion !== NATIVE_SCHEMA_VERSION ||
    typeof native.taskIdentifier !== "string" ||
    typeof native.idempotencyKey !== "string" ||
    native.idempotencyKeyScope !== "global" ||
    !isSubmissionOutcome(native.submissionOutcome) ||
    (native.triggerRunId !== null && typeof native.triggerRunId !== "string")
  ) {
    throw new Error("The Trigger.dev execution reference is invalid.");
  }
  return native as unknown as NativeTriggerReference;
}

function updateReference(reference: PlatformExecutionReference, run: TriggerRunRecord): PlatformExecutionReference {
  const native = nativeReferenceFrom(reference);
  return {
    ...reference,
    native: {
      ...native,
      nativeStatus: run.status,
      attemptCount: numberOrNull(run.attemptCount),
      startedAt: dateString(run.startedAt),
      finishedAt: dateString(run.finishedAt),
    },
  };
}

function inspectionFromRun(reference: PlatformExecutionReference, run: TriggerRunRecord, now: () => Date): RunnerInspection {
  const status = mapStatus(run.status);
  const output = asTaskOutput(run.output);
  const eventIntents = output?.eventIntents ?? synthesizedEvents(reference, run, status);
  const result = terminalResult(reference, run, status, output, now);
  const trajectory = result && output?.trajectory ? output.trajectory : result ? emptyTrajectory(result.runId) : null;
  const metrics = result && output?.metrics ? output.metrics : result ? calculateMetrics(result, eventIntents) : null;
  return { status, reference, eventIntents, result, trajectory, metrics };
}

function terminalResult(
  reference: PlatformExecutionReference,
  run: TriggerRunRecord,
  status: ReturnType<typeof mapStatus>,
  output: TriggerTaskOutput | null,
  now: () => Date,
): RunResult | null {
  if (!isTerminal(run.status)) return null;
  const runId = output?.runId ?? idempotencyRunId(reference);
  const finishedAt = dateString(run.finishedAt) ?? now().toISOString();
  if (run.status === "COMPLETED" && output) {
    return {
      schemaVersion: 1,
      runId,
      status: "completed",
      startedAt: output.startedAt,
      finishedAt: output.finishedAt,
      output: output.output,
      error: null,
      attemptCount: output.attemptCount,
      usage: output.usage,
    };
  }
  const error = errorForRun(run);
  return {
    schemaVersion: 1,
    runId,
    status: status === "cancelled" ? "cancelled" : error.failureKind === "outcome_unknown" ? "reconciliation_required" : "failed",
    startedAt: dateString(run.startedAt),
    finishedAt,
    output: null,
    error,
    attemptCount: numberOrNull(run.attemptCount) ?? 0,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function synthesizedEvents(
  reference: PlatformExecutionReference,
  run: TriggerRunRecord,
  status: ReturnType<typeof mapStatus>,
): readonly RunEventIntent[] {
  const runId = idempotencyRunId(reference);
  const createdAt = dateString(run.createdAt) ?? dateString(run.startedAt) ?? new Date(0).toISOString();
  const startedAt = dateString(run.startedAt);
  const finishedAt = dateString(run.finishedAt);
  const events: RunEventIntent[] = [
    { source: "trigger-dev-runner", sourceSequence: 1, kind: "TaskAdmitted", runId, occurredAt: createdAt, payload: { taskIdentifier: run.taskIdentifier, triggerRunId: run.id } },
  ];
  if (startedAt) {
    events.push({ source: "trigger-dev-runner", sourceSequence: 2, kind: "TaskStarted", runId, occurredAt: startedAt, payload: { status: run.status, attemptCount: run.attemptCount ?? null } });
    events.push({ source: "trigger-dev-runner", sourceSequence: 3, kind: "ModelRequested", runId, occurredAt: startedAt, payload: { provider: "fake" } });
  }
  if (finishedAt && isTerminal(run.status)) {
    events.push({ source: "trigger-dev-runner", sourceSequence: 4, kind: status === "completed" ? "RunCompleted" : status === "cancelled" ? "RunCancelled" : "RunFailed", runId, occurredAt: finishedAt, payload: { nativeStatus: run.status } });
  }
  return events;
}

function errorForRun(run: TriggerRunRecord): NonNullable<RunResult["error"]> {
  const message = run.error?.message ?? `Trigger.dev run ended with ${run.status}.`;
  if (run.status === "CANCELED") return { code: "TRIGGER_RUN_CANCELLED", message, failureKind: "cancelled", retryable: false };
  if (run.status === "EXPIRED" || run.status === "TIMED_OUT") return { code: "TRIGGER_RUN_TIMED_OUT", message, failureKind: "timeout", retryable: run.status === "EXPIRED" };
  if (run.status === "CRASHED" || run.status === "SYSTEM_FAILURE") return { code: "TRIGGER_RUN_OUTCOME_UNKNOWN", message, failureKind: "outcome_unknown", retryable: true };
  if (run.error?.name === "TRIGGER_FAKE_PROVIDER_FAILURE") return { code: "TRIGGER_PROVIDER_FAILURE", message, failureKind: "provider", retryable: false };
  if (run.error?.name === "TRIGGER_FAKE_OUTCOME_UNKNOWN") return { code: "TRIGGER_OUTCOME_UNKNOWN", message, failureKind: "outcome_unknown", retryable: false };
  return { code: "TRIGGER_RUN_FAILED", message, failureKind: "internal", retryable: false };
}

function unknownAdmissionInspection(reference: PlatformExecutionReference, errorCode?: string): RunnerInspection {
  const runId = idempotencyRunId(reference);
  const finishedAt = new Date().toISOString();
  const result: RunResult = {
    schemaVersion: 1,
    runId,
    status: "reconciliation_required",
    startedAt: null,
    finishedAt,
    output: null,
    error: { code: "TRIGGER_SUBMISSION_OUTCOME_UNKNOWN", message: "Trigger.dev did not confirm whether task admission was accepted.", failureKind: "outcome_unknown", retryable: true },
    attemptCount: 0,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
  const event: RunEventIntent = { source: "trigger-dev-runner", sourceSequence: 1, kind: "TaskSubmissionOutcomeUnknown", runId, occurredAt: finishedAt, payload: { errorCode: errorCode ?? "TRIGGER_ADMISSION_UNKNOWN" } };
  return { status: "failed", reference, eventIntents: [event], result, trajectory: emptyTrajectory(runId), metrics: calculateMetrics(result, [event]) };
}

function mapStatus(status: TriggerRunStatus): "queued" | "running" | "completed" | "failed" | "cancelled" {
  if (status === "PENDING_VERSION" || status === "QUEUED" || status === "DELAYED") return "queued";
  if (status === "DEQUEUED" || status === "EXECUTING" || status === "WAITING") return "running";
  if (status === "COMPLETED") return "completed";
  if (status === "CANCELED") return "cancelled";
  return "failed";
}

function isTerminal(status: TriggerRunStatus): boolean {
  return status === "COMPLETED" || status === "CANCELED" || status === "FAILED" || status === "CRASHED" || status === "SYSTEM_FAILURE" || status === "EXPIRED" || status === "TIMED_OUT";
}

function asTaskOutput(value: unknown): TriggerTaskOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<TriggerTaskOutput>;
  if (candidate.schemaVersion !== 1 || typeof candidate.runId !== "string" || typeof candidate.output !== "string" || !Array.isArray(candidate.eventIntents) || !candidate.trajectory || !candidate.metrics || !candidate.usage) return null;
  return value as TriggerTaskOutput;
}

function calculateMetrics(result: RunResult, events: readonly RunEventIntent[]): RunMetrics {
  const durationMs = result.startedAt ? Math.max(0, Date.parse(result.finishedAt) - Date.parse(result.startedAt)) : null;
  return { schemaVersion: 1, runId: result.runId, status: result.status, durationMs: Number.isFinite(durationMs) ? durationMs : null, modelCallCount: events.filter((event) => event.kind === "ModelRequested").length, modelAttemptCount: result.attemptCount, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens, costUsd: null };
}

function emptyTrajectory(runId: string): RunTrajectory {
  return { schemaVersion: 1, runId, phases: [] };
}

function idempotencyRunId(reference: PlatformExecutionReference): string {
  const native = nativeReferenceFrom(reference);
  return native.idempotencyKey;
}

function dateString(value: Date | string | undefined): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isSubmissionOutcome(value: unknown): value is NativeTriggerReference["submissionOutcome"] {
  return value === "accepted" || value === "already_accepted" || value === "unknown";
}

function isAmbiguousTriggerError(error: unknown): boolean {
  const status = httpStatus(error);
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

function classifyAdmissionError(error: unknown): string {
  const status = httpStatus(error);
  return status === undefined ? "TRIGGER_NETWORK_ERROR" : `TRIGGER_HTTP_${status}`;
}

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { readonly status?: unknown }).status;
  return typeof value === "number" ? value : undefined;
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]/g, " ").slice(0, 200);
}
