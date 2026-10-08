import { getFreeEvalSettings, isFreeEval } from "../../../models/openrouter/free-model-policy.js";
import { readFile } from "node:fs/promises";
import { capabilityHostKeyPath } from "../../../capabilities/extensions/runtime.js";
import type { InvocationResumeInput } from "../../../capabilities/reviews/contracts.js";
import { createHash } from "node:crypto";

import type {
  PlatformExecutionReference,
  RunEventIntent,
  RunManifest,
  RunResult,
} from "../../../control-plane/domain/types.js";
import type {
  PlatformRunner,
  RunnerResumeResult,
  RunnerCancellationResult,
  RunnerConnectivity,
  RunnerInspection,
  RunnerValidationResult,
} from "../../../control-plane/ports/runner.js";
import {
  CharacterTokenEstimator,
  ContextService,
  ContextSessionStore,
} from "../../../capabilities/context/index.js";
import { createLangGraphContextSummaryGenerator } from "./context-summary.js";
import {
  LANGGRAPH_PROTOCOL_VERSION,
  parseCancelResponse,
  parseHealthResponse,
  parseInspection,
  parseStartResponse,
  langGraphThreadId,
  type LangGraphInspection,
  type LangGraphResult,
} from "../protocol/protocol.js";

export interface LangGraphRunnerOptions {
  readonly serviceUrl: string;
  readonly requestTimeoutMs?: number;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly contextRoot?: string;
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
      contextRoot: options.contextRoot ?? process.env.AGENTLAB_CONTEXT_ROOT ?? "lab/sessions",
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
      contextRoot: this.options.contextRoot,
      tools: { enabledNames: ["calculator"], maxRounds: 6, maxCalls: 8 },
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
    const context = await this.prepareContext(manifest, configuration.contextRoot);
    const threadId = manifest.context.sessionId ? langGraphThreadId(manifest.context.sessionId) : manifest.runId;
    return this.dispatch(manifest, configuration, {
      runId: manifest.runId,
      clientTurnId: manifest.context.clientTurnId,
      threadId,
      context,
      eventSource: "langgraph-service",
    });
  }

  async recoverContextOverflow(
    manifest: RunManifest,
    reference: PlatformExecutionReference,
  ): Promise<PlatformExecutionReference> {
    if (isFreeEval(manifest.selection?.experimentId)) throw new Error("LIVE_EVAL_RECOVERY_DISABLED: live trials do not retry context overflow.");
    const configuration = this.configurationFromManifest(manifest);
    if (!manifest.context.sessionId || !manifest.context.turnId) {
      throw new Error("LangGraph context recovery requires a session-backed turn.");
    }
    const native = langGraphExecutionFromReference(reference);
    const context = await this.prepareContext(manifest, configuration.contextRoot, {
      forceCompaction: true,
      trigger: "provider_overflow",
    });
    if (!context) throw new Error("LangGraph context recovery did not produce a context snapshot.");
    const recoveryId = contextRecoveryId(manifest.runId);
    return this.dispatch(manifest, configuration, {
      runId: recoveryId,
      clientTurnId: contextRecoveryClientTurnId(manifest.runId),
      threadId: native.threadId,
      context,
      eventSource: "langgraph-context-recovery",
    });
  }

  private async dispatch(
    manifest: RunManifest,
    configuration: LangGraphConfiguration,
    identity: {
      readonly runId: string;
      readonly clientTurnId?: string;
      readonly threadId: string;
      readonly context?: {
        readonly sessionId: string;
        readonly turnId: string;
        readonly snapshotId: string;
        readonly compactionRevision?: number;
        readonly contextWindowTokens?: number;
      };
      readonly eventSource: string;
    },
  ): Promise<PlatformExecutionReference> {
    const requestManifest = identity.runId === manifest.runId
      ? manifest
      : { ...manifest, runId: identity.runId };
    const requestBody = JSON.stringify({
      protocolVersion: LANGGRAPH_PROTOCOL_VERSION,
      ...(getFreeEvalSettings(manifest.selection?.experimentId) ? { liveEval: true, liveEvalExperiment: getFreeEvalSettings(manifest.selection?.experimentId)!.experimentId } : {}),
      runId: identity.runId,
      ...(manifest.context.sessionId ? { sessionId: manifest.context.sessionId } : {}),
      ...(identity.clientTurnId ? { clientTurnId: identity.clientTurnId } : {}),
      prompt: manifest.task.prompt,
      systemInstruction: manifest.context.systemInstruction,
      model: {
        provider: manifest.model.provider,
        model: manifest.model.model,
      },
      graph: "baseline",
      threadId: identity.threadId,
      durability: "sqlite-sync",
      maxAttempts: configuration.maxAttempts,
      timeoutMs: configuration.timeoutMs,
      ...(identity.context ? { context: identity.context } : {}),
      tools: manifest.capabilities?.tools ?? configuration.tools,
      ...(manifest.capabilities?.toolCatalog ? { toolCatalog: manifest.capabilities.toolCatalog } : {}),
      ...(manifest.capabilities?.connections ? { connections: manifest.capabilities.connections } : {}),
    });
    try {
      const response = parseStartResponse(await this.request("/v1/runs", {
        method: "POST",
        body: requestBody,
      }));
      return referenceFromResponse(response, requestManifest, configuration.serviceUrl, manifest.runId, identity.eventSource);
    } catch (error) {
      if (!couldHaveLostAdmission(error)) throw error;

      // The service admits by the stable run ID before doing graph work. If a
      // response is lost after admission, reconcile that identity instead of
      // issuing a second POST that could duplicate the graph execution.
      try {
        const inspection = parseInspection(await this.request(
          `/v1/runs/${encodeURIComponent(`langgraph:${identity.runId}`)}`,
          { method: "GET" },
        ));
        return referenceFromInspection(inspection, requestManifest, configuration.serviceUrl, manifest.runId, identity.eventSource);
      } catch {
        throw error;
      }
    }
  }

  private async prepareContext(
    manifest: RunManifest,
    contextRoot: string,
    options: { readonly forceCompaction?: boolean; readonly trigger?: "preflight" | "provider_overflow" } = {},
  ): Promise<{ readonly sessionId: string; readonly turnId: string; readonly snapshotId: string } | undefined> {
    const { sessionId, turnId, snapshotId } = manifest.context;
    if (!sessionId || !turnId) return undefined;
    const context = new ContextService(
      new ContextSessionStore(contextRoot),
      new CharacterTokenEstimator(),
    );
    const summarizer = createLangGraphContextSummaryGenerator({
      liveEval: isFreeEval(manifest.selection?.experimentId),
      provider: manifest.model.provider,
      model: manifest.model.model,
      apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: process.env.AGENTLAB_OPENROUTER_BASE_URL,
      timeoutMs: this.options.requestTimeoutMs,
    });
    const snapshot = snapshotId && !options.forceCompaction
      ? await context.readSnapshot(sessionId, snapshotId)
      : (await context.prepareTurn(sessionId, turnId, summarizer, options)).snapshot;
    return contextIdentity(snapshot, sessionId, turnId);
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

  async resume(reference: PlatformExecutionReference, input: unknown): Promise<RunnerResumeResult> {
    const decision = input as InvocationResumeInput;
    if (!decision || decision.kind !== "invocation_review" || !Number.isSafeInteger(decision.revision) ||
        typeof decision.requestId !== "string" || typeof decision.decisionId !== "string" ||
        typeof decision.toolCallId !== "string" || !["approved", "denied", "renewed"].includes(decision.decision)) {
      throw new Error("LangGraph requires an identified invocation review decision.");
    }
    const native = langGraphExecutionFromReference(reference);
    const key = (await readFile(capabilityHostKeyPath(), "utf8")).trim();
    const inspection = parseInspection(await this.request(`/v1/runs/${encodeURIComponent(native.executionId)}/resume`, {
      method: "POST", headers: {authorization: `Bearer ${key}`}, body: JSON.stringify(decision),
    }));
    return {accepted: ["running", "suspended", "completed"].includes(inspection.status), alreadyTerminal: false,
      message: "Invocation review resumed the existing LangGraph checkpoint."};
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
      contextRoot: readString(configuration, "contextRoot"),
      tools: readToolConfiguration(configuration),
    };
  }
}

interface LangGraphConfiguration {
  readonly serviceUrl: string;
  readonly protocolVersion: number;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly contextRoot: string;
  readonly tools: { readonly enabledNames: readonly string[]; readonly approvedNames?: readonly string[]; readonly maxRounds: number; readonly maxCalls: number };
}

function readToolConfiguration(value: Readonly<Record<string, unknown>>): LangGraphConfiguration["tools"] {
  const candidate = value.tools;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { enabledNames: ["calculator"], maxRounds: 6, maxCalls: 8 };
  }
  const tools = candidate as Record<string, unknown>;
  const enabledNames = tools.enabledNames;
  return {
    enabledNames: Array.isArray(enabledNames)
      ? enabledNames.filter((name): name is string => typeof name === "string")
      : ["calculator"],
    ...(Array.isArray(tools.approvedNames) ? { approvedNames: tools.approvedNames.filter((name): name is string => typeof name === "string") } : {}),
    maxRounds: readPositiveInteger(tools, "maxRounds"),
    maxCalls: readPositiveInteger(tools, "maxCalls"),
  };
}

interface LangGraphExecutionReference {
  readonly serviceOrigin: string;
  readonly executionId: string;
  readonly labRunId: string;
  readonly eventSource: string;
  readonly threadId: string;
  readonly graph: string;
  readonly protocolVersion: number;
  readonly serviceVersion?: string;
  readonly langgraphVersion?: string;
  readonly pythonVersion?: string;
}

function referenceFromResponse(
  response: ReturnType<typeof parseStartResponse>,
  manifest: RunManifest,
  serviceUrl: string,
  labRunId = manifest.runId,
  eventSource = "langgraph-service",
): PlatformExecutionReference {
  const native: LangGraphExecutionReference = {
    serviceOrigin: serviceUrl,
    executionId: response.executionId,
    labRunId,
    eventSource,
    threadId: response.threadId,
    graph: response.graph,
    protocolVersion: response.protocolVersion,
    ...(response.serviceVersion ? { serviceVersion: response.serviceVersion } : {}),
    ...(response.langgraphVersion ? { langgraphVersion: response.langgraphVersion } : {}),
    ...(response.pythonVersion ? { pythonVersion: response.pythonVersion } : {}),
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
  labRunId = manifest.runId,
  eventSource = "langgraph-service",
): PlatformExecutionReference {
  if (inspection.runId !== manifest.runId || inspection.executionId !== `langgraph:${manifest.runId}`) {
    throw new Error("LangGraph reconciliation returned a different execution identity.");
  }
  const native: LangGraphExecutionReference = {
    serviceOrigin: serviceUrl,
    executionId: inspection.executionId,
    labRunId,
    eventSource,
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
    labRunId: readOptionalString(native, "labRunId") ?? readString(native, "executionId").replace(/^langgraph:/, ""),
    eventSource: readOptionalString(native, "eventSource") ?? "langgraph-service",
    threadId: readString(native, "threadId"),
    graph: readString(native, "graph"),
    protocolVersion: readPositiveInteger(native, "protocolVersion"),
  };
}

function inspectionFromWire(inspection: LangGraphInspection, reference: PlatformExecutionReference): RunnerInspection {
  const unknown = inspection.status === "unknown";
  const labRunId = readOptionalString(reference.native, "labRunId")
    ?? reference.executionId.replace(/^langgraph:/, "");
  const eventSource = readOptionalString(reference.native, "eventSource") ?? "langgraph-service";
  return {
    status: unknown ? "running" : inspection.status,
    reference,
    eventIntents: inspection.events.map((event): RunEventIntent => ({
      source: eventSource,
      sourceSequence: event.sourceSequence,
      kind: event.kind,
      runId: labRunId,
      occurredAt: event.occurredAt,
      payload: event.payload,
    })),
    result: inspection.result ? runResultFromWire(inspection.result, unknown, labRunId) : null,
    trajectory: {
      schemaVersion: 1,
      runId: labRunId,
      phases: inspection.trajectory.phases,
    },
    metrics: {
      schemaVersion: 1,
      runId: labRunId,
      status: inspection.result ? runResultFromWire(inspection.result, unknown, labRunId).status : "reconciliation_required",
      durationMs: inspection.metrics.durationMs,
      modelCallCount: inspection.metrics.modelCallCount,
      modelAttemptCount: inspection.metrics.modelAttemptCount,
      inputTokens: inspection.metrics.inputTokens,
      outputTokens: inspection.metrics.outputTokens,
      totalTokens: inspection.metrics.totalTokens,
      toolCallCount: inspection.metrics.toolCallCount ?? inspection.events.filter((event) => event.kind === "ToolCallRequested").length,
      toolAttemptCount: inspection.metrics.toolAttemptCount ?? inspection.events.filter((event) => event.kind === "ToolExecutionStarted").length,
      costUsd: null,
    },
  };
}

function runResultFromWire(result: LangGraphResult, unknown: boolean, labRunId: string): RunResult {
  return {
    schemaVersion: 1,
    runId: labRunId,
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

function readOptionalString(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
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

function contextRecoveryId(runId: string): string {
  return `context-recovery-${createHash("sha256").update(runId, "utf8").digest("hex").slice(0, 32)}`;
}

function contextRecoveryClientTurnId(runId: string): string {
  return `context-recovery-${createHash("sha256").update(`client:${runId}`, "utf8").digest("hex").slice(0, 32)}`;
}

function contextIdentity(
  snapshot: { readonly snapshotId: string; readonly compactionRevision: number; readonly budget: { readonly contextWindowTokens: number | null } },
  sessionId: string,
  turnId: string,
): {
  readonly sessionId: string;
  readonly turnId: string;
  readonly snapshotId: string;
  readonly compactionRevision: number;
  readonly contextWindowTokens?: number;
} {
  return {
    sessionId,
    turnId,
    snapshotId: snapshot.snapshotId,
    compactionRevision: snapshot.compactionRevision,
    ...(typeof snapshot.budget.contextWindowTokens === "number"
      ? { contextWindowTokens: snapshot.budget.contextWindowTokens }
      : {}),
  };
}
