import type {
  PlatformExecutionReference,
  RunEventIntent,
  RunManifest,
  RunResult,
} from "../../../control-plane/domain/types.js";
import type {
  PlatformRunner,
  RunnerCancellationResult,
  RunnerConnectivity,
  RunnerInspection,
  RunnerValidationResult,
} from "../../../control-plane/ports/runner.js";
import {
  LANGGRAPH_PROTOCOL_VERSION,
  parseCancelResponse,
  parseHealthResponse,
  parseInspection,
  parseStartResponse,
  type LangGraphInspection,
  type LangGraphResult,
} from "../protocol/protocol.js";

export interface LangGraphRunnerOptions {
  readonly serviceUrl: string;
  readonly requestTimeoutMs?: number;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
}

export class LangGraphRunnerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LangGraphRunnerUnavailableError";
  }
}

class LangGraphServiceHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "LangGraphServiceHttpError";
  }
}

/**
 * Deep adapter at the platform seam. It owns the HTTP protocol and translates
 * native thread/checkpoint state into the small TypeScript runner interface.
 */
export class LangGraphBaselineRunner implements PlatformRunner {
  readonly platform = "langgraph" as const;
  readonly variant = "baseline" as const;

  constructor(private readonly options: Required<LangGraphRunnerOptions>) {}

  static fromOptions(options: LangGraphRunnerOptions): LangGraphBaselineRunner {
    return new LangGraphBaselineRunner({
      serviceUrl: options.serviceUrl.replace(/\/$/, ""),
      requestTimeoutMs: options.requestTimeoutMs ?? 2_000,
      maxAttempts: options.maxAttempts ?? 2,
      timeoutMs: options.timeoutMs ?? 30_000,
    });
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return {
      serviceUrl: this.options.serviceUrl,
      protocolVersion: LANGGRAPH_PROTOCOL_VERSION,
      graph: "baseline",
      durability: "sqlite-sync",
      maxAttempts: this.options.maxAttempts,
      timeoutMs: this.options.timeoutMs,
    };
  }

  validate(manifest: RunManifest): RunnerValidationResult {
    if (manifest.platform !== this.platform || manifest.variant !== this.variant) {
      return { valid: false, reason: "The LangGraph baseline runner only accepts langgraph/baseline manifests." };
    }
    if (manifest.model.provider !== "fake" && manifest.model.provider !== "openrouter") {
      return { valid: false, reason: "The LangGraph baseline supports only fake and openrouter models." };
    }
    try {
      const configuration = this.configurationFromManifest(manifest);
      if (configuration.serviceUrl !== this.options.serviceUrl) return { valid: false, reason: "The run service URL does not match the LangGraph profile." };
      if (configuration.protocolVersion !== LANGGRAPH_PROTOCOL_VERSION) return { valid: false, reason: "The LangGraph protocol version is unsupported." };
    } catch (error) {
      return { valid: false, reason: error instanceof Error ? error.message : "The LangGraph configuration is invalid." };
    }
    return { valid: true, reason: null };
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    try {
      const response = await this.request("/health", { method: "GET" });
      const health = parseHealthResponse(response);
      return {
        reachable: health.status === "ready" && health.checkpointPathWritable,
        message: health.message,
      };
    } catch (error) {
      return { reachable: false, message: safeMessage(error, "LangGraph service is unavailable.") };
    }
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    const validation = this.validate(manifest);
    if (!validation.valid) throw new Error(validation.reason ?? "LangGraph manifest validation failed.");
    const configuration = this.configurationFromManifest(manifest);
    const requestBody = JSON.stringify({
      protocolVersion: LANGGRAPH_PROTOCOL_VERSION,
      runId: manifest.runId,
      prompt: manifest.task.prompt,
      systemInstruction: manifest.context.systemInstruction,
      // The common manifest carries UI-only context metadata. LangGraph's
      // strict wire model intentionally accepts only provider and model here.
      model: {
        provider: manifest.model.provider,
        model: manifest.model.model,
      },
      graph: "baseline",
      threadId: manifest.runId,
      durability: "sqlite-sync",
      maxAttempts: configuration.maxAttempts,
      timeoutMs: configuration.timeoutMs,
    });
    try {
      const response = parseStartResponse(await this.request("/v1/runs", {
        method: "POST",
        body: requestBody,
      }));
      return referenceFromResponse(response, manifest, configuration.serviceUrl);
    } catch (error) {
      if (!couldHaveLostAdmission(error)) throw error;

      // The service admits by the stable run ID before doing graph work. If a
      // response is lost after admission, reconcile that identity instead of
      // issuing a second POST that could duplicate the graph execution.
      try {
        const inspection = parseInspection(await this.request(
          `/v1/runs/${encodeURIComponent(`langgraph:${manifest.runId}`)}`,
          { method: "GET" },
        ));
        return referenceFromInspection(inspection, manifest, configuration.serviceUrl);
      } catch {
        throw error;
      }
    }
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const native = langGraphExecutionFromReference(reference);
    const inspection = parseInspection(await this.request(`/v1/runs/${encodeURIComponent(native.executionId)}`, { method: "GET" }));
    return inspectionFromWire(inspection, reference);
  }

  async cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    const native = langGraphExecutionFromReference(reference);
    const response = parseCancelResponse(await this.request(`/v1/runs/${encodeURIComponent(native.executionId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: reason || "Cancellation requested." }),
    }));
    return {
      accepted: response.accepted,
      alreadyTerminal: response.alreadyTerminal,
      message: response.message,
    };
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);
    try {
      const response = await fetch(`${this.options.serviceUrl}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = body && typeof body === "object" && "detail" in body ? String((body as { detail: unknown }).detail) : response.statusText;
        throw new LangGraphServiceHttpError(response.status, `LangGraph service returned HTTP ${response.status}: ${detail}`);
      }
      return body;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new LangGraphRunnerUnavailableError("The LangGraph service request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private configurationFromManifest(manifest: RunManifest): LangGraphConfiguration {
    const configuration = manifest.platformConfig;
    return {
      serviceUrl: readString(configuration, "serviceUrl"),
      protocolVersion: readPositiveInteger(configuration, "protocolVersion"),
      maxAttempts: readPositiveInteger(configuration, "maxAttempts"),
      timeoutMs: readPositiveInteger(configuration, "timeoutMs"),
    };
  }
}

interface LangGraphConfiguration {
  readonly serviceUrl: string;
  readonly protocolVersion: number;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
}

interface LangGraphExecutionReference {
  readonly serviceOrigin: string;
  readonly executionId: string;
  readonly threadId: string;
  readonly graph: string;
  readonly protocolVersion: number;
}

function referenceFromResponse(
  response: ReturnType<typeof parseStartResponse>,
  manifest: RunManifest,
  serviceUrl: string,
): PlatformExecutionReference {
  const native: LangGraphExecutionReference = {
    serviceOrigin: serviceUrl,
    executionId: response.executionId,
    threadId: response.threadId,
    graph: response.graph,
    protocolVersion: response.protocolVersion,
  };
  return {
    platform: manifest.platform,
    variant: manifest.variant,
    executionId: response.executionId,
    native: native as unknown as Readonly<Record<string, unknown>>,
  };
}

function referenceFromInspection(
  inspection: LangGraphInspection,
  manifest: RunManifest,
  serviceUrl: string,
): PlatformExecutionReference {
  if (inspection.runId !== manifest.runId || inspection.executionId !== `langgraph:${manifest.runId}`) {
    throw new Error("LangGraph reconciliation returned a different execution identity.");
  }
  const native: LangGraphExecutionReference = {
    serviceOrigin: serviceUrl,
    executionId: inspection.executionId,
    threadId: inspection.threadId,
    graph: inspection.graph,
    protocolVersion: inspection.protocolVersion,
  };
  return {
    platform: manifest.platform,
    variant: manifest.variant,
    executionId: inspection.executionId,
    native: native as unknown as Readonly<Record<string, unknown>>,
  };
}

function langGraphExecutionFromReference(reference: PlatformExecutionReference): LangGraphExecutionReference {
  if (reference.platform !== "langgraph" || reference.variant !== "baseline") {
    throw new Error("The execution reference does not belong to the LangGraph baseline runner.");
  }
  const native = reference.native;
  return {
    serviceOrigin: readString(native, "serviceOrigin", "serviceUrl"),
    executionId: readString(native, "executionId"),
    threadId: readString(native, "threadId"),
    graph: readString(native, "graph"),
    protocolVersion: readPositiveInteger(native, "protocolVersion"),
  };
}

function inspectionFromWire(inspection: LangGraphInspection, reference: PlatformExecutionReference): RunnerInspection {
  const unknown = inspection.status === "unknown";
  return {
    status: unknown ? "running" : inspection.status,
    reference,
    eventIntents: inspection.events.map((event): RunEventIntent => ({
      source: event.source,
      sourceSequence: event.sourceSequence,
      kind: event.kind,
      runId: event.runId,
      occurredAt: event.occurredAt,
      payload: event.payload,
    })),
    result: inspection.result ? runResultFromWire(inspection.result, unknown) : null,
    trajectory: {
      schemaVersion: 1,
      runId: inspection.runId,
      phases: inspection.trajectory.phases,
    },
    metrics: {
      schemaVersion: 1,
      runId: inspection.runId,
      status: inspection.result ? runResultFromWire(inspection.result, unknown).status : "reconciliation_required",
      durationMs: inspection.metrics.durationMs,
      modelCallCount: inspection.metrics.modelCallCount,
      modelAttemptCount: inspection.metrics.modelAttemptCount,
      inputTokens: inspection.metrics.inputTokens,
      outputTokens: inspection.metrics.outputTokens,
      totalTokens: inspection.metrics.totalTokens,
      costUsd: null,
    },
  };
}

function runResultFromWire(result: LangGraphResult, unknown: boolean): RunResult {
  return {
    schemaVersion: 1,
    runId: result.runId,
    status: mapResultStatus(result.status, unknown),
    startedAt: result.startedAt,
    finishedAt: result.finishedAt ?? new Date().toISOString(),
    output: result.output,
    error: result.error ? {
      code: result.error.code,
      message: result.error.message,
      failureKind: unknown ? "reconciliation" : result.error.failureKind,
      retryable: result.error.retryable,
    } : null,
    attemptCount: result.attemptCount,
    usage: result.usage,
  };
}

function mapResultStatus(status: LangGraphResult["status"], unknown: boolean): RunResult["status"] {
  if (unknown || status === "unknown") return "reconciliation_required";
  if (status === "completed" || status === "failed" || status === "cancelled") return status;
  return "reconciliation_required";
}

function readString(value: Readonly<Record<string, unknown>>, key: string, legacyKey?: string): string {
  const candidate = value[key] ?? (legacyKey ? value[legacyKey] : undefined);
  if (typeof candidate !== "string" || candidate.trim().length === 0) throw new Error(`LangGraph configuration is missing ${key}.`);
  return candidate;
}

function couldHaveLostAdmission(error: unknown): boolean {
  if (error instanceof LangGraphServiceHttpError) return error.status >= 500;
  return error instanceof LangGraphRunnerUnavailableError || error instanceof TypeError;
}

function readPositiveInteger(value: Readonly<Record<string, unknown>>, key: string): number {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 1) throw new Error(`LangGraph configuration has an invalid ${key}.`);
  return candidate;
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
