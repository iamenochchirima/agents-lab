import type {
  PlatformExecutionReference,
  RunManifest,
  RunEventIntent,
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
  AWS_STEP_FUNCTIONS_PLATFORM,
  AWS_STEP_FUNCTIONS_VARIANT,
  loadAwsStepFunctionsConfig,
  safeManifestConfiguration,
  type AwsStepFunctionsConfig,
} from "../config.js";
import type {
  AwsStepFunctionsNativeReference,
  AwsStepFunctionsPublicRunRecord,
  AwsStepFunctionsRunInput,
} from "../variants/baseline/contracts.js";
import { executionNameForRun } from "../variants/baseline/execution/state-machine.js";

const DEFAULT_FETCH_TIMEOUT_MS = 5_000;

export interface AwsStepFunctionsBaselineRunnerOptions {
  readonly config?: AwsStepFunctionsConfig;
  readonly fetchImplementation?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly unavailableMessage?: string;
}

export class AwsStepFunctionsRunnerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwsStepFunctionsRunnerUnavailableError";
  }
}

/** Adapts the platform-local HTTP service to the Lab's generic runner port. */
export class AwsStepFunctionsBaselineRunner implements PlatformRunner {
  readonly platform = AWS_STEP_FUNCTIONS_PLATFORM;
  readonly variant = AWS_STEP_FUNCTIONS_VARIANT;

  private readonly config: AwsStepFunctionsConfig;
  private readonly fetchImplementation: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly unavailableMessage: string | null;

  constructor(options: AwsStepFunctionsBaselineRunnerOptions = {}) {
    this.config = options.config ?? loadAwsStepFunctionsConfig();
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.unavailableMessage = options.unavailableMessage ?? null;
    if (!Number.isInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1) {
      throw new Error("AWS Step Functions requestTimeoutMs must be a positive integer.");
    }
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return safeManifestConfiguration(this.config);
  }

  validate(manifest: RunManifest): RunnerValidationResult {
    if (manifest.platform !== this.platform || manifest.variant !== this.variant) {
      return { valid: false, reason: "The AWS Step Functions runner only accepts aws-step-functions/baseline manifests." };
    }
    if (manifest.platformConfig.profile !== this.config.profile) {
      return { valid: false, reason: "The run AWS Step Functions profile does not match the configured service profile." };
    }
    if (manifest.platformConfig.stateMachineName !== this.config.stateMachineName) {
      return { valid: false, reason: "The run state-machine name does not match the configured profile." };
    }
    if (manifest.platformConfig.activityName !== this.config.activityName) {
      return { valid: false, reason: "The run Activity name does not match the configured profile." };
    }
    if (manifest.model.provider === "openrouter" && !this.config.openRouterApiKey) {
      return { valid: false, reason: "OpenRouter is not configured for the Step Functions service process." };
    }
    if (!manifest.task.prompt.trim()) return { valid: false, reason: "The prompt must not be empty." };
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    if (this.unavailableMessage) return { reachable: false, message: this.unavailableMessage };
    try {
      const response = await this.request("/health", { method: "GET" });
      const body = asRecord(response.body);
      if (!response.ok || body.status !== "ready") {
        return { reachable: false, message: stringValue(body, "message") ?? `AWS Step Functions service returned HTTP ${response.status}.` };
      }
      return { reachable: true, message: stringValue(body, "message") ?? "AWS Step Functions service is reachable." };
    } catch (error) {
      return { reachable: false, message: safeMessage(error, "AWS Step Functions service is unavailable.") };
    }
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    const validation = this.validate(manifest);
    if (!validation.valid) throw new Error(validation.reason ?? "AWS Step Functions manifest validation failed.");
    const input = inputFromManifest(manifest);
    const base = baseReference(manifest.runId, this.config);
    try {
      const admission = await this.request("/runs/admit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!admission.ok) throw requestError("AWS Step Functions admission", admission.status, admission.body);

      const dispatch = await this.request(`/runs/${encodeURIComponent(manifest.runId)}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!dispatch.ok) {
        if (dispatch.status >= 500) return updateReference(base, { acknowledgement: "unknown", submissionOutcome: "unknown" });
        throw requestError("AWS Step Functions dispatch", dispatch.status, dispatch.body);
      }
      const body = asRecord(dispatch.body);
      return updateReference(base, {
        stateMachineArn: nullableString(body.stateMachineArn),
        activityArn: nullableString(body.activityArn),
        executionName: stringValue(body, "executionName") ?? executionNameForRun(manifest.runId),
        executionArn: nullableString(body.executionArn),
        startDate: nullableString(body.startDate),
        nativeStatus: body.executionArn ? "RUNNING" : "UNKNOWN",
        submissionOutcome: submissionOutcome(body.submissionOutcome),
        acknowledgement: acknowledgement(body.acknowledgement),
      });
    } catch (error) {
      if (error instanceof AwsStepFunctionsRunnerUnavailableError) {
        return updateReference(base, { acknowledgement: "unknown", submissionOutcome: "unknown" });
      }
      throw error;
    }
  }

  async cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    const native = nativeReference(reference);
    const query = native.executionArn ? `?executionArn=${encodeURIComponent(native.executionArn)}` : "";
    const response = await this.request(`/runs/${encodeURIComponent(runIdFromReference(reference))}${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (response.status === 404) throw new AwsStepFunctionsRunnerUnavailableError("AWS Step Functions execution was not found.");
    if (!response.ok) throw requestError("AWS Step Functions cancellation", response.status, response.body);
    const body = asRecord(response.body);
    return {
      accepted: body.accepted === true,
      alreadyTerminal: body.alreadyTerminal === true,
      message: stringValue(body, "message") ?? "AWS Step Functions cancellation request completed.",
    };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const native = nativeReference(reference);
    const runId = runIdFromReference(reference);
    const query = native.executionArn ? `?executionArn=${encodeURIComponent(native.executionArn)}` : "";
    let response: { readonly ok: boolean; readonly status: number; readonly body: unknown };
    try {
      response = await this.request(`/runs/${encodeURIComponent(runId)}${query}`, { method: "GET" });
    } catch (error) {
      if (error instanceof AwsStepFunctionsRunnerUnavailableError && native.submissionOutcome === "unknown") {
        return unknownSubmissionInspection(reference);
      }
      throw error;
    }
    if (response.status === 404) throw new AwsStepFunctionsRunnerUnavailableError("AWS Step Functions execution was not found.");
    if (!response.ok) throw requestError("AWS Step Functions inspection", response.status, response.body);
    const record = parsePublicRecord(response.body);
    return {
      status: record.status === "reconciliation_required" ? "failed" : record.status,
      reference: record.reference,
      eventIntents: record.eventIntents,
      result: record.result,
      trajectory: record.trajectory,
      metrics: record.metrics,
    };
  }

  private async request(path: string, init: RequestInit): Promise<{ readonly ok: boolean; readonly status: number; readonly body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImplementation(`${this.config.serviceUrl}${path}`, { ...init, signal: controller.signal });
      } catch (error) {
        throw new AwsStepFunctionsRunnerUnavailableError(safeMessage(error, "AWS Step Functions service is unavailable."));
      }
      return { ok: response.ok, status: response.status, body: await readJson(response) };
    } finally {
      clearTimeout(timer);
    }
  }
}

function inputFromManifest(manifest: RunManifest): AwsStepFunctionsRunInput {
  return {
    runId: manifest.runId,
    prompt: manifest.task.prompt,
    systemInstruction: manifest.context.systemInstruction,
    provider: manifest.model.provider,
    model: manifest.model.model,
  };
}

function baseReference(runId: string, config: AwsStepFunctionsConfig): PlatformExecutionReference {
  const native: AwsStepFunctionsNativeReference = {
    schemaVersion: 1,
    profile: config.profile,
    region: config.region,
    endpointUrl: config.endpointUrl,
    stateMachineName: config.stateMachineName,
    stateMachineArn: config.stateMachineArn,
    activityName: config.activityName,
    activityArn: config.activityArn,
    executionName: executionNameForRun(runId),
    executionArn: null,
    startDate: null,
    stopDate: null,
    nativeStatus: "UNKNOWN",
    terminalStatus: null,
    nativeError: null,
    nativeCause: null,
    historyEventCount: 0,
    lastHistoryEventType: null,
    retryCount: 0,
    providerRequestId: null,
    submissionOutcome: "unknown",
    acknowledgement: "unknown",
  };
  return {
    platform: AWS_STEP_FUNCTIONS_PLATFORM,
    variant: AWS_STEP_FUNCTIONS_VARIANT,
    executionId: `aws-step-functions:${runId}`,
    native: native as unknown as Readonly<Record<string, unknown>>,
  };
}

function updateReference(
  reference: PlatformExecutionReference,
  update: Partial<Omit<AwsStepFunctionsNativeReference, "schemaVersion">>,
): PlatformExecutionReference {
  return {
    ...reference,
    native: { ...reference.native, ...update, schemaVersion: 1 },
  };
}

function nativeReference(reference: PlatformExecutionReference): AwsStepFunctionsNativeReference {
  if (reference.platform !== AWS_STEP_FUNCTIONS_PLATFORM || reference.variant !== AWS_STEP_FUNCTIONS_VARIANT) {
    throw new Error("The execution reference does not belong to the AWS Step Functions baseline runner.");
  }
  const native = reference.native as Partial<AwsStepFunctionsNativeReference>;
  if (native.schemaVersion !== 1 || typeof native.executionName !== "string") {
    throw new Error("The retained AWS Step Functions execution reference is invalid.");
  }
  return native as AwsStepFunctionsNativeReference;
}

function runIdFromReference(reference: PlatformExecutionReference): string {
  const prefix = "aws-step-functions:";
  if (!reference.executionId.startsWith(prefix)) throw new Error("The AWS Step Functions execution identity is invalid.");
  const runId = reference.executionId.slice(prefix.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId)) throw new Error("The AWS Step Functions run identity is invalid.");
  return runId;
}

function parsePublicRecord(value: unknown): AwsStepFunctionsPublicRunRecord {
  const record = asRecord(value);
  if (
    typeof record.runId !== "string" ||
    typeof record.status !== "string" ||
    !isRecord(record.reference) ||
    !Array.isArray(record.eventIntents)
  ) throw new Error("AWS Step Functions service returned an invalid run record.");
  return record as unknown as AwsStepFunctionsPublicRunRecord;
}

function submissionOutcome(value: unknown): AwsStepFunctionsNativeReference["submissionOutcome"] {
  return value === "accepted" || value === "already_accepted" ? value : "unknown";
}

function acknowledgement(value: unknown): AwsStepFunctionsNativeReference["acknowledgement"] {
  return value === "confirmed" ? "confirmed" : "unknown";
}

function requestError(operation: string, status: number, body: unknown): Error {
  const message = stringValue(asRecord(body), "message") ?? `HTTP ${status}`;
  if (status >= 500) return new AwsStepFunctionsRunnerUnavailableError(`${operation} failed: ${message}`);
  return new Error(`${operation} failed: ${message}`);
}

function unknownSubmissionInspection(reference: PlatformExecutionReference): RunnerInspection {
  const runId = runIdFromReference(reference);
  const occurredAt = new Date().toISOString();
  const result: RunResult = {
    schemaVersion: 1,
    runId,
    status: "reconciliation_required",
    startedAt: null,
    finishedAt: occurredAt,
    output: null,
    error: {
      code: "AWS_STEP_FUNCTIONS_SUBMISSION_OUTCOME_UNKNOWN",
      message: "Step Functions did not confirm whether the execution was accepted; reconcile it before retrying.",
      failureKind: "outcome_unknown",
      retryable: true,
    },
    attemptCount: 0,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
  const event: RunEventIntent = {
    source: "aws-step-functions-reconciliation",
    sourceSequence: 1,
    kind: "RunSubmissionOutcomeUnknown",
    runId,
    occurredAt,
    payload: { submissionOutcome: "unknown", acknowledgement: "unknown" },
  };
  const trajectory: RunTrajectory = { schemaVersion: 1, runId, phases: [] };
  const metrics: RunMetrics = {
    schemaVersion: 1,
    runId,
    status: "reconciliation_required",
    durationMs: null,
    modelCallCount: 0,
    modelAttemptCount: 0,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
  };
  return { status: "failed", reference, eventIntents: [event], result, trajectory, metrics };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === "string" ? value[key] as string : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
