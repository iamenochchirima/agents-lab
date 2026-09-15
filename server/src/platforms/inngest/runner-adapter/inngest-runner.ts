import type {
  PlatformExecutionReference,
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
  INNGEST_CANCEL_EVENT_NAME,
  INNGEST_EVENT_NAME,
  INNGEST_FUNCTION_ID,
  loadInngestConfig,
  safeManifestConfiguration,
  type InngestConfig,
} from "../config.js";
import type { InngestPublicRunRecord, InngestRunInput } from "../variants/baseline/contracts.js";

const NATIVE_SCHEMA_VERSION = 1;
const DEFAULT_FETCH_TIMEOUT_MS = 2_000;

interface NativeInngestReference {
  readonly schemaVersion: 1;
  readonly serviceUrl: string;
  readonly devServerUrl: string;
  readonly eventName: string;
  readonly cancelEventName: string;
  readonly functionId: string;
  readonly runId: string;
  readonly deduplicationId: string;
  readonly eventId: string | null;
  readonly functionRunId: string | null;
  readonly submissionOutcome: "accepted" | "already_accepted" | "unknown";
  readonly acknowledgement: "confirmed" | "unknown";
  readonly nativeStatus: string;
  readonly attemptCount: number;
  readonly cancellationRequested: boolean;
  readonly dispatchErrorCode: string | null;
};

export interface InngestBaselineRunnerOptions {
  readonly config?: InngestConfig;
  readonly fetchImplementation?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly unavailableMessage?: string;
}

export class InngestRunnerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InngestRunnerUnavailableError";
  }
}

export class InngestExecutionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InngestExecutionNotFoundError";
  }
}

/** Keeps the Inngest service and Dev Server behind the generic Lab runner port. */
export class InngestBaselineRunner implements PlatformRunner {
  readonly platform = "inngest" as const;
  readonly variant = "baseline" as const;

  private readonly config: InngestConfig;
  private readonly fetchImplementation: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly unavailableMessage: string | null;

  constructor(options: InngestBaselineRunnerOptions = {}) {
    this.config = options.config ?? loadInngestConfig();
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? this.config.requestTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    this.unavailableMessage = options.unavailableMessage ?? null;
    if (!Number.isInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 1) {
      throw new Error("Inngest requestTimeoutMs must be a positive integer.");
    }
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return safeManifestConfiguration(this.config);
  }

  validate(manifest: RunManifest): RunnerValidationResult {
    if (manifest.platform !== this.platform || manifest.variant !== this.variant) {
      return { valid: false, reason: "The Inngest baseline runner only accepts inngest/baseline manifests." };
    }
    if (manifest.platformConfig.functionId !== INNGEST_FUNCTION_ID) {
      return { valid: false, reason: "The run function ID does not match the configured Inngest baseline." };
    }
    if (manifest.platformConfig.eventName !== INNGEST_EVENT_NAME) {
      return { valid: false, reason: "The run event name does not match the configured Inngest baseline." };
    }
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    if (this.unavailableMessage) return { reachable: false, message: this.unavailableMessage };
    try {
      const response = await this.request("/health", { method: "GET" });
      const body = asRecord(response.body);
      if (!response.ok) {
        return { reachable: false, message: stringValue(body, "message") ?? stringValue(body, "devServerMessage") ?? `Inngest service returned HTTP ${response.status}.` };
      }
      const devServer = asRecord(body.devServer);
      if (devServer.reachable !== true) {
        return { reachable: false, message: stringValue(devServer, "message") ?? "Inngest Dev Server is unavailable." };
      }
      return { reachable: true, message: "Inngest service and Dev Server are reachable." };
    } catch (error) {
      return { reachable: false, message: safeMessage(error, "Inngest service is unavailable.") };
    }
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    const validation = this.validate(manifest);
    if (!validation.valid) throw new Error(validation.reason ?? "Inngest manifest validation failed.");
    const base = baseReference(manifest.runId, this.config);
    const input = inputFromManifest(manifest);

    try {
      const admission = await this.request(`/runs/admit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!admission.ok) {
        if (admission.status >= 500) return base;
        throw new Error(`Inngest service rejected admission: ${messageFromBody(admission.body)}`);
      }
      const dispatch = await this.request(`/runs/${encodeURIComponent(manifest.runId)}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!dispatch.ok && dispatch.status < 500) {
        throw new Error(`Inngest service rejected dispatch: ${messageFromBody(dispatch.body)}`);
      }
      const body = asRecord(dispatch.body);
      return updateReference(base, {
        eventId: nullableString(body.eventId),
        submissionOutcome: submissionOutcome(body.submissionOutcome),
        acknowledgement: body.acknowledgement === "confirmed" ? "confirmed" : "unknown",
        dispatchErrorCode: nullableString(body.dispatchErrorCode),
      });
    } catch (error) {
      if (error instanceof InngestRunnerUnavailableError) {
        // The service may have accepted the event before a response was lost.
        // Keep a deterministic reference so a later GET can reconcile it.
        return updateReference(base, { acknowledgement: "unknown", submissionOutcome: "unknown" });
      }
      throw error;
    }
  }

  async cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    const native = nativeReference(reference);
    const response = await this.request(`/runs/${encodeURIComponent(native.runId)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (response.status === 404) throw new InngestExecutionNotFoundError(`Inngest run ${native.runId} was not found.`);
    if (!response.ok) throw new InngestRunnerUnavailableError(`Inngest service rejected cancellation with HTTP ${response.status}.`);
    const body = asRecord(response.body);
    return {
      accepted: body.accepted === true,
      alreadyTerminal: body.alreadyTerminal === true,
      message: stringValue(body, "message") ?? "Inngest cancellation request completed.",
    };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const native = nativeReference(reference);
    const response = await this.request(`/runs/${encodeURIComponent(native.runId)}`, { method: "GET" });
    if (response.status === 404) throw new InngestExecutionNotFoundError(`Inngest run ${native.runId} was not found.`);
    if (!response.ok) throw new InngestRunnerUnavailableError(`Inngest service returned HTTP ${response.status}.`);
    const record = parsePublicRecord(response.body);
    const updated = updateReference(reference, {
      eventId: record.eventId,
      functionRunId: record.functionRunId,
      submissionOutcome: submissionOutcome(record.submissionOutcome),
      acknowledgement: record.submissionOutcome === "unknown" ? "unknown" : "confirmed",
      nativeStatus: record.status,
      attemptCount: record.attemptCount,
      cancellationRequested: record.cancellationRequested,
      dispatchErrorCode: record.dispatchErrorCode,
    });
    return {
      status: record.status,
      reference: updated,
      eventIntents: record.events,
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
        throw new InngestRunnerUnavailableError(safeMessage(error, "Inngest service is unavailable."));
      }
      const body = await readJson(response);
      return { ok: response.ok, status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }
}

function baseReference(runId: string, config: InngestConfig): PlatformExecutionReference {
  const native: NativeInngestReference = {
    schemaVersion: NATIVE_SCHEMA_VERSION,
    serviceUrl: config.serviceUrl,
    devServerUrl: config.devServerUrl,
    eventName: INNGEST_EVENT_NAME,
    cancelEventName: INNGEST_CANCEL_EVENT_NAME,
    functionId: INNGEST_FUNCTION_ID,
    runId,
    deduplicationId: `agentlab:run:${runId}`,
    eventId: null,
    functionRunId: null,
    submissionOutcome: "unknown",
    acknowledgement: "unknown",
    nativeStatus: "queued",
    attemptCount: 0,
    cancellationRequested: false,
    dispatchErrorCode: null,
  };
  return {
    platform: "inngest",
    variant: "baseline",
    executionId: `inngest:${runId}`,
    native: native as unknown as Readonly<Record<string, unknown>>,
  };
}

function updateReference(reference: PlatformExecutionReference, update: Partial<Omit<NativeInngestReference, "schemaVersion">>): PlatformExecutionReference {
  return {
    ...reference,
    native: { ...reference.native, ...update, schemaVersion: NATIVE_SCHEMA_VERSION },
  };
}

function nativeReference(reference: PlatformExecutionReference): NativeInngestReference {
  const native = reference.native as Partial<NativeInngestReference>;
  if (native.schemaVersion !== NATIVE_SCHEMA_VERSION || typeof native.runId !== "string") {
    throw new Error("The retained Inngest execution reference is invalid.");
  }
  return native as NativeInngestReference;
}

function inputFromManifest(manifest: RunManifest): InngestRunInput {
  return {
    runId: manifest.runId,
    prompt: manifest.task.prompt,
    systemInstruction: manifest.context.systemInstruction,
    provider: manifest.model.provider,
    model: manifest.model.model,
  };
}

function parsePublicRecord(value: unknown): InngestPublicRunRecord {
  const record = asRecord(value);
  if (typeof record.runId !== "string" || typeof record.status !== "string" || !Array.isArray(record.events)) {
    throw new Error("Inngest service returned an invalid run record.");
  }
  return record as unknown as InngestPublicRunRecord;
}

function submissionOutcome(value: unknown): NativeInngestReference["submissionOutcome"] {
  return value === "accepted" || value === "already_accepted" ? value : "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === "string" ? value[key] as string : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function messageFromBody(body: unknown): string {
  const record = asRecord(body);
  return stringValue(record, "message") ?? stringValue(record, "error") ?? "unknown error";
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
