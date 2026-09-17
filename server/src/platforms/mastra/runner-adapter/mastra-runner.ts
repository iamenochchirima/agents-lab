import type {
  PlatformExecutionReference,
  RunEventIntent,
  RunManifest,
  RunMetrics,
  RunResult,
  RunTrajectory,
  RunUsage,
} from "../../../control-plane/domain/types.js";
import type {
  PlatformRunner,
  RunnerCancellationResult,
  RunnerConnectivity,
  RunnerInspection,
  RunnerValidationResult,
} from "../../../control-plane/ports/runner.js";
import {
  CharacterTokenEstimator,
  ContextService,
  ContextSessionStore,
  type ContextMessage,
  type ContextSummaryGenerator,
} from "../../../capabilities/context/index.js";
import {
  configurationFromManifest,
  DEFAULT_EXECUTION_TIMEOUT_MS,
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_MAX_TOOL_ROUNDS,
  MASTRA_AGENT_ID,
  MASTRA_CORE_VERSION,
  MASTRA_OPERATION,
  MASTRA_STORAGE_MODE,
  safeEnvironment,
  validateConfiguration,
  type MastraEnvironment,
} from "../variants/baseline/config/configuration.js";
import { createBaselineAgent } from "../variants/baseline/agent.js";
import type { MastraModelFactory } from "../variants/baseline/models/factory.js";
import { MASTRA_EVENT_SOURCE, type MastraExecutionRecord } from "../variants/baseline/contracts.js";

const EXECUTION_ID_PREFIX = "mastra:";

export interface MastraBaselineRunnerOptions {
  readonly environment?: MastraEnvironment;
  readonly executionTimeoutMs?: number;
  readonly modelFactory?: MastraModelFactory;
  readonly now?: () => Date;
  readonly contextRoot?: string;
}

interface PreparedMastraContext {
  readonly currentMessageId: string;
  readonly messages: readonly ContextMessage[];
}

/**
 * Runs one direct Mastra Agent.generate() call in the Lab server process.
 *
 * The registry is intentionally in memory. The common evidence store may
 * retain the reference and completed projection, but it cannot recover an
 * in-flight Agent.generate() after this runner instance disappears.
 */
export class MastraBaselineRunner implements PlatformRunner {
  readonly platform = "mastra" as const;
  readonly variant = "baseline" as const;

  private readonly executions = new Map<string, MastraExecutionRecord>();
  private readonly environment: MastraEnvironment;
  private readonly executionTimeoutMs: number;
  private readonly modelFactory?: MastraModelFactory;
  private readonly now: () => Date;
  private readonly contextRoot: string;

  constructor(options: MastraBaselineRunnerOptions = {}) {
    this.environment = options.environment ?? safeEnvironment();
    this.executionTimeoutMs = options.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
    this.modelFactory = options.modelFactory;
    this.now = options.now ?? (() => new Date());
    this.contextRoot = options.contextRoot ?? process.env.AGENTLAB_CONTEXT_ROOT ?? "lab/sessions";
    if (!Number.isInteger(this.executionTimeoutMs) || this.executionTimeoutMs < 1) {
      throw new Error("Mastra executionTimeoutMs must be a positive integer.");
    }
  }

  manifestConfiguration(): Readonly<Record<string, unknown>> {
    return {
      agentId: MASTRA_AGENT_ID,
      executionTimeoutMs: this.executionTimeoutMs,
      maxRetries: 0,
      maxToolRounds: DEFAULT_MAX_TOOL_ROUNDS,
      maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
      contextRoot: this.contextRoot,
      mastraVersion: MASTRA_CORE_VERSION,
      operation: MASTRA_OPERATION,
      storage: MASTRA_STORAGE_MODE,
      processScoped: true,
    };
  }

  validate(manifest: RunManifest): RunnerValidationResult {
    try {
      const reason = validateConfiguration(manifest, this.environment);
      return reason === null ? { valid: true, reason: null } : { valid: false, reason };
    } catch (error) {
      return { valid: false, reason: safeErrorMessage(error, "The Mastra configuration is invalid.") };
    }
  }

  async checkConnection(): Promise<RunnerConnectivity> {
    if (this.environment.OPENROUTER_API_KEY?.trim()) {
      return { reachable: true, message: "Mastra direct-agent runtime is ready; OpenRouter key is configured." };
    }

    return { reachable: true, message: "Mastra direct-agent runtime is ready for deterministic fake-model runs." };
  }

  async start(manifest: RunManifest): Promise<PlatformExecutionReference> {
    const validation = this.validate(manifest);
    if (!validation.valid) {
      throw new Error(validation.reason ?? "Mastra manifest validation failed.");
    }

    const existing = this.executions.get(manifest.runId);
    if (existing) {
      return existing.reference;
    }

    const reference = referenceFor(manifest);
    const record: MastraExecutionRecord = {
      reference,
      manifest,
      controller: new AbortController(),
      events: [],
      startedAt: this.now().toISOString(),
      status: "queued",
      result: null,
      trajectory: null,
      metrics: null,
      cancellationReason: null,
      timeoutRequested: false,
    };
    this.executions.set(manifest.runId, record);
    void this.execute(record);
    return reference;
  }

  async cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult> {
    const record = this.requireExecution(reference);
    if (isTerminal(record.status)) {
      return {
        accepted: false,
        alreadyTerminal: true,
        message: `Mastra execution is already ${record.status}.`,
      };
    }

    record.cancellationReason = reason.trim() || "Cancellation requested.";
    record.controller.abort(record.cancellationReason);
    return { accepted: true, alreadyTerminal: false, message: record.cancellationReason };
  }

  async inspect(reference: PlatformExecutionReference): Promise<RunnerInspection> {
    const record = this.requireExecution(reference);
    return {
      status: record.status,
      reference: record.reference,
      eventIntents: record.events,
      result: record.result,
      trajectory: record.trajectory,
      metrics: record.metrics,
    };
  }

  private async execute(record: MastraExecutionRecord): Promise<void> {
    const configuration = configurationFromManifest(record.manifest);
    record.status = "running";
    this.addEvent(record, "AgentStarted", { agentId: configuration.agentId });
    this.addEvent(record, "ModelRequested", {
      model: record.manifest.model.model,
      provider: record.manifest.model.provider,
    });

    const timeout = setTimeout(() => {
      record.timeoutRequested = true;
      record.controller.abort("Mastra execution timed out.");
    }, configuration.executionTimeoutMs);

    try {
      const context = await this.prepareContext(record, configuration.contextRoot);
      const agent = createBaselineAgent(record.manifest, this.modelFactory, {
        runId: record.manifest.runId,
        turnId: record.manifest.context.turnId ?? `${record.manifest.runId}:turn:1`,
        signal: record.controller.signal,
        maxToolCalls: configuration.maxToolCalls,
        onToolEvent: (kind, payload) => this.addEvent(record, kind, payload),
      });
      const output = await agent.generate(record.manifest.task.prompt, {
        runId: record.manifest.runId,
        abortSignal: record.controller.signal,
        ...(context ? {
          context: context.messages
            .filter((message) => message.role !== "system" && message.messageId !== context.currentMessageId)
            .map(toMastraMessage),
        } : {}),
        maxSteps: configuration.maxToolRounds,
        onStepFinish: (step) => {
          this.addEvent(record, "AgentStepCompleted", {
            finishReason: safeValue(step, "finishReason"),
            usage: safeUsage(safeValue(step, "usage")),
          });
        },
      });
      // Mastra's generate() may resolve with an empty output after an abort
      // rather than reject. Treat that as a known cancellation. If a real
      // response survived the cancellation race, preserve the observed result.
      if (record.controller.signal.aborted && output.text.trim().length === 0) {
        throw abortError();
      }
      const usage = normalizeUsage(output.totalUsage ?? output.usage);
      this.addEvent(record, "ModelCompleted", { finishReason: output.finishReason ?? null, usage });
      this.addEvent(record, "AgentCompleted", { finishReason: output.finishReason ?? null });
      this.addEvent(record, "RunCompleted", {});
      record.status = "completed";
      record.result = resultFor(record, "completed", output.text, null, usage);
      record.trajectory = trajectoryFor(record);
      record.metrics = metricsFor(record, usage);
    } catch (error) {
      const failure = failureFor(record, error);
      if (failure.failureKind === "cancelled") {
        this.addEvent(record, "AgentCancelled", { reason: record.cancellationReason ?? "Cancellation requested." });
        this.addEvent(record, "RunCancelled", {});
        record.status = "cancelled";
      } else {
        this.addEvent(record, "ModelFailed", { code: failure.code, failureKind: failure.failureKind });
        this.addEvent(record, "AgentFailed", { code: failure.code, failureKind: failure.failureKind });
        this.addEvent(record, "RunFailed", { code: failure.code, failureKind: failure.failureKind });
        record.status = "failed";
      }
      const terminalStatus = record.status === "cancelled" ? "cancelled" : "failed";
      record.result = resultFor(record, terminalStatus, null, failure, emptyUsage());
      record.trajectory = trajectoryFor(record);
      record.metrics = metricsFor(record, emptyUsage());
    } finally {
      clearTimeout(timeout);
    }
  }

  private async prepareContext(record: MastraExecutionRecord, contextRoot: string): Promise<PreparedMastraContext | null> {
    const { sessionId, turnId } = record.manifest.context;
    if (!sessionId || !turnId) return null;

    this.addEvent(record, "ContextPreparationStarted", { sessionId, turnId, trigger: "preflight" });
    const context = new ContextService(
      new ContextSessionStore(contextRoot),
      new CharacterTokenEstimator(),
    );
    const summarizer: ContextSummaryGenerator = {
      summarize: async () => {
        throw new Error("Mastra context compaction is not enabled in the direct baseline.");
      },
    };
    const prepared = await context.prepareTurn(sessionId, turnId, summarizer);
    this.addEvent(record, "ContextPrepared", {
      sessionId,
      turnId,
      snapshotId: prepared.snapshot.snapshotId,
      inputTokens: prepared.snapshot.budget.inputTokens,
      remainingTokens: prepared.snapshot.budget.remainingTokens,
      remainingPercent: prepared.snapshot.budget.remainingPercent,
      pressure: prepared.snapshot.budget.pressure,
      quality: prepared.snapshot.budget.quality,
      compacted: prepared.snapshot.compaction !== null,
    });
    return {
      currentMessageId: prepared.turn.userMessageId,
      messages: prepared.snapshot.messages,
    };
  }

  private addEvent(record: MastraExecutionRecord, kind: string, payload: Record<string, unknown>): void {
    record.events.push({
      source: MASTRA_EVENT_SOURCE,
      sourceSequence: record.events.length + 1,
      kind,
      runId: record.manifest.runId,
      occurredAt: this.now().toISOString(),
      payload,
    });
  }

  private requireExecution(reference: PlatformExecutionReference): MastraExecutionRecord {
    if (reference.platform !== this.platform || reference.variant !== this.variant) {
      throw new Error("The execution reference does not belong to the Mastra baseline runner.");
    }

    const record = this.executions.get(reference.executionId.slice(EXECUTION_ID_PREFIX.length));
    if (!record) {
      throw new Error(`Mastra execution was not found: ${reference.executionId}.`);
    }
    return record;
  }
}

function referenceFor(manifest: RunManifest): PlatformExecutionReference {
  return {
    platform: manifest.platform,
    variant: manifest.variant,
    executionId: `${EXECUTION_ID_PREFIX}${manifest.runId}`,
    native: {
      schemaVersion: 1,
      mastraVersion: MASTRA_CORE_VERSION,
      agentId: MASTRA_AGENT_ID,
      operation: MASTRA_OPERATION,
      processScoped: true,
      storage: MASTRA_STORAGE_MODE,
      modelProvider: manifest.model.provider,
      model: manifest.model.model,
    },
  };
}

function resultFor(
  record: MastraExecutionRecord,
  status: "completed" | "failed" | "cancelled",
  output: string | null,
  error: RunResult["error"],
  usage: RunUsage,
): RunResult {
  return {
    schemaVersion: 1,
    runId: record.manifest.runId,
    status,
    startedAt: record.startedAt,
    finishedAt: record.events.at(-1)?.occurredAt ?? record.startedAt,
    output,
    error,
    attemptCount: 1,
    usage,
  };
}

function trajectoryFor(record: MastraExecutionRecord): RunTrajectory {
  const modelRequest = record.events.find((event) => event.kind === "ModelRequested");
  const terminal = record.events.at(-1)?.occurredAt ?? record.startedAt;
  return {
    schemaVersion: 1,
    runId: record.manifest.runId,
    phases: [
      { name: "agent.generate", startedAt: record.startedAt, finishedAt: terminal },
      ...(modelRequest
        ? [{ name: "model.request", startedAt: modelRequest.occurredAt, finishedAt: terminal }]
        : []),
    ],
  };
}

function metricsFor(record: MastraExecutionRecord, usage: RunUsage): RunMetrics {
  const finishedAt = record.events.at(-1)?.occurredAt ?? record.startedAt;
  return {
    schemaVersion: 1,
    runId: record.manifest.runId,
    status: record.status === "completed" || record.status === "cancelled" ? record.status : "failed",
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(record.startedAt)),
    modelCallCount: record.events.some((event) => event.kind === "ModelRequested") ? 1 : 0,
    modelAttemptCount: 1,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: null,
  };
}

function failureFor(record: MastraExecutionRecord, error: unknown): NonNullable<RunResult["error"]> {
  if (record.cancellationReason && !record.timeoutRequested) {
    return {
      code: "MASTRA_RUN_CANCELLED",
      message: "The Mastra generation was cancelled before a response was confirmed.",
      failureKind: "cancelled",
      retryable: false,
    };
  }

  if (record.timeoutRequested) {
    return {
      code: "MASTRA_OUTCOME_UNKNOWN",
      message: "The Mastra model request timed out after dispatch; its provider outcome is unknown.",
      failureKind: "outcome_unknown",
      retryable: false,
    };
  }

  if (error instanceof Error && error.name === "ProviderError") {
    return {
      code: "MASTRA_PROVIDER_FAILURE",
      message: "The Mastra model provider rejected the request.",
      failureKind: "provider",
      retryable: false,
    };
  }

  return {
    code: error instanceof Error && error.name === "AmbiguousProviderError" ? "MASTRA_OUTCOME_UNKNOWN" : "MASTRA_GENERATION_FAILED",
    message:
      error instanceof Error && error.name === "AmbiguousProviderError"
        ? "The Mastra model request was sent but its provider outcome could not be confirmed."
        : "The Mastra agent generation failed.",
    failureKind: error instanceof Error && error.name === "AmbiguousProviderError" ? "outcome_unknown" : "internal",
    retryable: false,
  };
}

function normalizeUsage(value: unknown): RunUsage {
  if (!value || typeof value !== "object") return emptyUsage();
  const usage = value as Record<string, unknown>;
  return {
    inputTokens: numberOrNull(usage.inputTokens),
    outputTokens: numberOrNull(usage.outputTokens),
    totalTokens: numberOrNull(usage.totalTokens),
  };
}

function safeUsage(value: unknown): RunUsage {
  const usage = normalizeUsage(value);
  return usage;
}

function emptyUsage(): RunUsage {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" || typeof candidate === "number" || candidate === null ? candidate : null;
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isTerminal(status: MastraExecutionRecord["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function abortError(): Error {
  const error = new Error("The Mastra generation was aborted.");
  error.name = "AbortError";
  return error;
}
