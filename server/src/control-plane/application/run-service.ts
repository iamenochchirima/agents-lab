import { randomUUID } from "node:crypto";

import { buildRunManifest, DEFAULT_SYSTEM_INSTRUCTION, InvalidRunRequestError, validateRunRequest } from "../domain/manifest.js";
import type {
  PlatformExecutionReference,
  RunEvent,
  RunEventIntent,
  RunManifest,
  RunMetrics,
  RunRequest,
  RunProjection,
  RunResult,
  RunStatus,
  RunTrajectory,
} from "../domain/types.js";
import { EvidenceNotFoundError, isEvidenceProjectionUnavailable, RunEvidenceStore } from "./evidence-store.js";
import { PlatformRegistry } from "./platform-registry.js";
import type { PlatformRunner, RunnerInspection } from "../ports/runner.js";
import type { ModelMetadataResolver } from "../ports/model-metadata.js";
import type { ServerConfig } from "../bootstrap/config.js";
import type { ContextProjection } from "../../capabilities/context/contracts.js";
import { calculateContextBudget } from "../../capabilities/context/budget.js";
import { ContextService } from "../../capabilities/context/context-service.js";

const CONTEXT_CAPABLE_BASELINE_PLATFORMS: ReadonlySet<string> = new Set(["temporal", "restate", "langgraph", "mastra"]);

export class RunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`Run was not found: ${runId}`);
    this.name = "RunNotFoundError";
  }
}

export class RunnerUnavailableError extends Error {
  constructor(readonly platform: string, readonly variant: string, readonly reason: "unknown" | "planned") {
    super(`Runner is not available: ${platform}/${variant} (${reason}).`);
    this.name = "RunnerUnavailableError";
  }
}

class RunnerInspectionError extends Error {
  constructor(readonly cause: unknown) {
    super("Platform inspection is unavailable.");
    this.name = "RunnerInspectionError";
  }
}

export interface RunView {
  readonly runId: string;
  readonly status: RunStatus;
  readonly manifest: RunManifest;
  readonly events: readonly RunEvent[];
  readonly executionReference: PlatformExecutionReference | null;
  readonly trajectory: RunTrajectory | null;
  readonly metrics: RunMetrics | null;
  readonly result: RunResult | null;
  readonly context: ContextProjection | null;
  readonly projection: RunProjection;
}

export interface RunServiceDependencies {
  readonly config: ServerConfig;
  readonly evidence: RunEvidenceStore;
  readonly registry: PlatformRegistry;
  readonly context?: ContextService;
  readonly modelMetadata?: ModelMetadataResolver;
}

/**
 * Coordinates a Lab run without owning platform execution. The runner is the
 * only component allowed to know how to start or inspect a platform; this service
 * owns the durable Lab projection and its recovery rules.
 */
export class RunService {
  constructor(private readonly dependencies: RunServiceDependencies) {}

  async createRun(request: RunRequest): Promise<RunView> {
    validateRunRequest(request);
    const effectiveRequest = await this.resolveModelMetadata(request);
    const registration = this.dependencies.registry.find(effectiveRequest.platform, effectiveRequest.variant);
    const runner = registration?.status === "runnable" ? registration.runner : null;
    if (!runner) {
      throw new RunnerUnavailableError(request.platform, request.variant, registration ? "planned" : "unknown");
    }

    const draftManifest = buildRunManifest(effectiveRequest, {
      serverVersion: this.dependencies.config.serverVersion,
      platformConfig: runner.manifestConfiguration(),
    });
    if (!this.dependencies.config.allowedModelProviders.includes(draftManifest.model.provider)) {
      throw new Error(`Model provider is not enabled in the local server profile: ${draftManifest.model.provider}.`);
    }

    const validation = runner.validate(draftManifest);
    if (!validation.valid) {
      throw new Error(validation.reason ?? "Runner rejected the run manifest.");
    }

    const contextTurn = await this.admitContextTurn(effectiveRequest, draftManifest.runId);
    if (contextTurn && contextTurn.turn.runId !== draftManifest.runId) {
      // A stable client key can replay a request after the original response was
      // lost. Reuse the durable run instead of dispatching a second platform run.
      // If the server crashed before creating the run record, the existing turn
      // supplies the original run ID and the normal creation path repairs it.
      try {
        return await this.getRun(contextTurn.turn.runId);
      } catch (error) {
        if (!(error instanceof RunNotFoundError)) throw error;
      }
    }
    const effectiveRunId = contextTurn?.turn.runId ?? draftManifest.runId;
    const manifest = buildRunManifest(effectiveRequest, {
      runId: effectiveRunId,
      serverVersion: this.dependencies.config.serverVersion,
      platformConfig: runner.manifestConfiguration(),
      context: contextTurn ? {
        sessionId: contextTurn.session.sessionId,
        turnId: contextTurn.turn.turnId,
      } : undefined,
    });

    try {
      await this.dependencies.evidence.createRun(manifest);
      await this.appendControlEvent(manifest.runId, "RunCreated", { platform: manifest.platform, variant: manifest.variant });
    } catch (error) {
      await this.settleContextTurn(manifest, dispatchFailureResult(manifest.runId)).catch(() => undefined);
      throw error;
    }

    let reference;
    try {
      reference = await runner.start(manifest);
    } catch (error) {
      await this.recordDispatchFailure(manifest, error);
      return this.getRun(manifest.runId);
    }

    // A successful platform submission is not the same as a successfully
    // projected Lab run. If retaining the native identity fails, recording a
    // dispatch failure would be false: the platform may already be executing
    // the run. Preserve the accepted-but-unprojected state instead and make
    // the loss explicit for reconciliation.
    let referenceRetained = false;
    try {
      await this.dependencies.evidence.writeExecutionReference(manifest.runId, reference);
      referenceRetained = true;
      await this.appendControlEvent(manifest.runId, "RunDispatched", {
        executionId: reference.executionId,
        platform: reference.platform,
        variant: reference.variant,
      });
    } catch (error) {
      if (isEvidenceProjectionUnavailable(error)) {
        return this.staleRunView(
          manifest.runId,
          "The platform accepted the run, but its execution reference could not be retained.",
        );
      }
      if (referenceRetained) {
        // The native identity is enough for a later reconciliation attempt;
        // do not replace a real platform execution with a synthetic failure.
        return this.getRun(manifest.runId);
      }
      await this.recordReconciliationRequired(
        manifest,
        "The platform accepted the run, but its execution reference could not be retained.",
      );
      return this.getRun(manifest.runId);
    }

    try {
      return await this.reconcile(manifest.runId, runner, reference);
    } catch (error) {
      if (!(error instanceof RunnerInspectionError)) throw error;
      if (isExecutionNotFoundError(error.cause)) {
        await this.recordReconciliationRequired(manifest, "The retained platform execution could not be found.");
      }
      // The platform may be temporarily unavailable immediately after an
      // accepted dispatch. The durable run and reference already exist, so
      // return that last known projection and let normal polling reconcile it.
      return this.getRun(manifest.runId);
    }
  }

  private async staleRunView(runId: string, reason: string): Promise<RunView> {
    const snapshot = await this.readSnapshotOrThrow(runId);
    return toRunView(
      snapshot,
      "queued",
      await this.contextProjection(snapshot.manifest),
      staleProjection(snapshot, reason),
    );
  }

  private async resolveModelMetadata(request: RunRequest): Promise<RunRequest> {
    if (!this.dependencies.modelMetadata || request.model.provider !== "openrouter") return request;
    const metadata = await this.dependencies.modelMetadata.resolve(request.model.provider, request.model.model);
    const { contextWindowTokens: _clientContextWindowTokens, ...modelWithoutClientWindow } = request.model;
    if (!metadata || metadata.contextWindowTokens === null) {
      return { ...request, model: modelWithoutClientWindow };
    }
    return {
      ...request,
      model: {
        ...modelWithoutClientWindow,
        contextWindowTokens: metadata.contextWindowTokens,
      },
    };
  }

  async getRun(runId: string): Promise<RunView> {
    let snapshot;
    try {
      snapshot = await this.dependencies.evidence.readSnapshot(runId);
    } catch (error) {
      if (error instanceof EvidenceNotFoundError) {
        throw new RunNotFoundError(runId);
      }
      throw error;
    }

    // A confirmed terminal result is the durable Lab record. Do not re-inspect
    // a platform execution that may have been retained only temporarily (or
    // purged after its result was projected). An outcome-unknown submission is
    // provisional, so it remains eligible for reconciliation by the runner.
    const provisionalOutcomeUnknown = snapshot.result?.status === "reconciliation_required"
      && snapshot.result.error?.failureKind === "outcome_unknown";
    if (snapshot.result && !provisionalOutcomeUnknown) {
      return toRunView(snapshot, snapshot.result.status, await this.contextProjection(snapshot.manifest));
    }

    const runner = this.dependencies.registry.runnable(snapshot.manifest);
    if (!runner) {
      return toRunView(snapshot, deriveStatus(snapshot.events, snapshot.result), await this.contextProjection(snapshot.manifest));
    }
    if (!snapshot.executionReference) {
      if (!snapshot.result) {
        await this.recordReconciliationRequired(snapshot.manifest, "No platform execution reference was retained.");
        snapshot = await this.dependencies.evidence.readSnapshot(runId);
      }
      return toRunView(snapshot, deriveStatus(snapshot.events, snapshot.result), await this.contextProjection(snapshot.manifest));
    }

    try {
      return await this.reconcile(runId, runner, snapshot.executionReference);
    } catch (error) {
      if (isEvidenceProjectionUnavailable(error)) {
        return toRunView(
          snapshot,
          deriveStatus(snapshot.events, snapshot.result),
          await this.contextProjection(snapshot.manifest),
          staleProjection(snapshot, "Run evidence is temporarily unavailable; showing the last recorded state."),
        );
      }
      const inspectionError = error instanceof RunnerInspectionError ? error.cause : error;
      if (isExecutionNotFoundError(inspectionError)) {
        await this.recordReconciliationRequired(snapshot.manifest, "The retained platform execution could not be found.");
        const reconciled = await this.dependencies.evidence.readSnapshot(runId);
        return toRunView(reconciled, "reconciliation_required", await this.contextProjection(reconciled.manifest));
      }

      // A server read must not turn a temporary platform outage into a
      // fabricated terminal result. Return the last durable Lab projection.
      return toRunView(
        snapshot,
        deriveStatus(snapshot.events, snapshot.result),
        await this.contextProjection(snapshot.manifest),
        staleProjection(snapshot, "The platform is temporarily unavailable; showing the last recorded state."),
      );
    }
  }

  async cancelRun(runId: string, reason = "Cancellation requested by the user."): Promise<RunView> {
    const snapshot = await this.readSnapshotOrThrow(runId);
    if (snapshot.result) {
      return toRunView(snapshot, snapshot.result.status, await this.contextProjection(snapshot.manifest));
    }
    if (!snapshot.executionReference) {
      await this.recordReconciliationRequired(snapshot.manifest, "Cannot cancel without a retained platform execution reference.");
      return this.getRun(runId);
    }

    const runner = this.dependencies.registry.runnable(snapshot.manifest);
    if (!runner) {
      const registration = this.dependencies.registry.find(snapshot.manifest.platform, snapshot.manifest.variant);
      throw new RunnerUnavailableError(
        snapshot.manifest.platform,
        snapshot.manifest.variant,
        registration ? "planned" : "unknown",
      );
    }
    const cancellation = await runner.cancel(snapshot.executionReference, reason);
    if (cancellation.alreadyTerminal) {
      return this.getRun(runId);
    }
    if (cancellation.accepted) {
      await this.appendControlEvent(runId, "RunCancellationRequested", { reason });
    }
    return this.getRun(runId);
  }

  private async reconcile(
    runId: string,
    runner: PlatformRunner,
    reference: PlatformExecutionReference,
  ): Promise<RunView> {
    let inspection: RunnerInspection;
    try {
      inspection = await runner.inspect(reference);
    } catch (error) {
      throw new RunnerInspectionError(error);
    }
    // Platform inspection may enrich the opaque reference with native status,
    // invocation IDs, retry counts, or reconciliation metadata. Persist that
    // refreshed reference so a later server restart can resume from the latest
    // known native identity.
    await this.dependencies.evidence.writeExecutionReference(runId, inspection.reference);
    for (const intent of inspection.eventIntents) {
      await this.dependencies.evidence.appendEvent(intent);
    }
    await this.projectContextSnapshot(runId, await this.dependencies.evidence.readManifest(runId), inspection.eventIntents);

    if (inspection.result) {
      await this.dependencies.evidence.writeResult(inspection.result);
      // An ambiguous submission produces a provisional result only. Do not
      // persist its empty trajectory or zero metrics: the retained platform
      // execution may later resolve to a different terminal projection.
      if (inspection.result.status !== "reconciliation_required") {
        if (inspection.trajectory) {
          await this.dependencies.evidence.writeTrajectory(inspection.trajectory);
        }
        await this.dependencies.evidence.writeMetrics(inspection.metrics ?? calculateMetrics(inspection.result, inspection.eventIntents));
        await this.settleContextTurn(await this.dependencies.evidence.readManifest(runId), inspection.result);
      }
    }

    const snapshot = await this.dependencies.evidence.readSnapshot(runId);
    return toRunView(snapshot, inspection.result?.status ?? deriveStatus(snapshot.events, snapshot.result), await this.contextProjection(snapshot.manifest));
  }

  private async admitContextTurn(request: RunRequest, runId: string) {
    if (!this.dependencies.context || request.variant !== "baseline" || !CONTEXT_CAPABLE_BASELINE_PLATFORMS.has(request.platform)) {
      if (request.sessionId) {
        throw new Error("Session context is not available for the selected platform variant.");
      }
      return null;
    }

    if (request.clientTurnId !== undefined && request.sessionId === undefined) {
      throw new InvalidRunRequestError("clientTurnId requires an explicit sessionId so a retry can address the same context session.");
    }
    const sessionId = request.sessionId ?? `session-${randomUUID()}`;
    const session = await this.dependencies.context.sessions.create({
      sessionId,
      platform: request.platform,
      variant: request.variant,
      model: `${request.model.provider}/${request.model.model}`,
      systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
      contextWindowTokens: request.model.contextWindowTokens ?? null,
      reservedOutputTokens: 4_096,
      safetyMarginTokens: 1_024,
      compactionThresholdPercent: 20,
      recentMessageGroups: 2,
    });
    return this.dependencies.context.sessions.admitTurn(session.sessionId, runId, request.task.prompt, undefined, request.clientTurnId);
  }

  private async settleContextTurn(manifest: RunManifest, result: RunResult): Promise<void> {
    if (!this.dependencies.context) return;
    const sessionId = manifest.context.sessionId;
    const turnId = manifest.context.turnId;
    if (!sessionId || !turnId || (result.status !== "completed" && result.status !== "failed" && result.status !== "cancelled")) return;
    await this.dependencies.context.sessions.settleTurn(sessionId, turnId, {
      status: result.status,
      output: result.output,
      error: result.error?.message ?? null,
    });
  }

  private async projectContextSnapshot(
    runId: string,
    manifest: RunManifest,
    intents: readonly RunEventIntent[],
  ): Promise<void> {
    if (!this.dependencies.context || !manifest.context.sessionId) return;
    const snapshotIds = intents
      .filter((intent) => intent.kind === "ContextPrepared" || intent.kind === "ContextRecoveryPrepared")
      .map((intent) => intent.payload.snapshotId)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    const snapshotId = snapshotIds.at(-1);
    if (!snapshotId) return;
    const snapshot = await this.dependencies.context.readSnapshot(manifest.context.sessionId, snapshotId);
    await this.dependencies.evidence.writeContextSnapshot(runId, snapshot);
  }

  private async contextProjection(manifest: RunManifest): Promise<ContextProjection | null> {
    if (!this.dependencies.context || !manifest.context.sessionId) return null;
    return this.dependencies.context.projection(manifest.context.sessionId);
  }

  private async appendControlEvent(runId: string, kind: string, payload: Record<string, unknown>): Promise<void> {
    const events = await this.dependencies.evidence.readEvents(runId);
    if (events.some((event) => event.source === "control-plane" && event.kind === kind)) {
      return;
    }
    const sourceSequence =
      events.reduce((maximum, event) => (event.source === "control-plane" ? Math.max(maximum, event.sourceSequence) : maximum), 0) + 1;
    await this.dependencies.evidence.appendEvent({
      source: "control-plane",
      sourceSequence,
      kind,
      runId,
      occurredAt: new Date().toISOString(),
      payload,
    });
  }

  private async recordDispatchFailure(manifest: RunManifest, error: unknown): Promise<void> {
    void error;
    await this.appendControlEvent(manifest.runId, "RunFailed", { failureKind: "internal", code: "DISPATCH_FAILED" });
    const result = dispatchFailureResult(manifest.runId);
    await this.dependencies.evidence.writeResult(result);
    await this.dependencies.evidence.writeTrajectory({ schemaVersion: 1, runId: manifest.runId, phases: [] });
    await this.dependencies.evidence.writeMetrics(calculateMetrics(result, []));
    await this.settleContextTurn(manifest, result);
  }

  private async recordReconciliationRequired(manifest: RunManifest, message: string): Promise<void> {
    await this.appendControlEvent(manifest.runId, "RunReconciliationRequired", { code: "PLATFORM_REFERENCE_MISSING" });
    const result: RunResult = {
      schemaVersion: 1,
      runId: manifest.runId,
      status: "reconciliation_required",
      startedAt: null,
      finishedAt: new Date().toISOString(),
      output: null,
      error: { code: "PLATFORM_REFERENCE_MISSING", message, failureKind: "reconciliation", retryable: false },
      attemptCount: 0,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
    await this.dependencies.evidence.writeResult(result);
    await this.dependencies.evidence.writeTrajectory({ schemaVersion: 1, runId: manifest.runId, phases: [] });
    await this.dependencies.evidence.writeMetrics(calculateMetrics(result, []));
  }

  private async readSnapshotOrThrow(runId: string) {
    try {
      return await this.dependencies.evidence.readSnapshot(runId);
    } catch (error) {
      if (error instanceof EvidenceNotFoundError) {
        throw new RunNotFoundError(runId);
      }
      throw error;
    }
  }
}

function toRunView(
  snapshot: Awaited<ReturnType<RunEvidenceStore["readSnapshot"]>>,
  status: RunStatus,
  context: ContextProjection | null,
  projection: RunProjection = currentProjection(snapshot),
): RunView {
  return {
    runId: snapshot.manifest.runId,
    status,
    manifest: snapshot.manifest,
    events: snapshot.events,
    executionReference: snapshot.executionReference,
    trajectory: snapshot.trajectory,
    metrics: snapshot.metrics,
    result: snapshot.result,
    context: context ?? runContextProjection(snapshot),
    projection,
  };
}

function currentProjection(snapshot: Awaited<ReturnType<RunEvidenceStore["readSnapshot"]>>): RunProjection {
  return {
    state: "current",
    observedAt: snapshot.events.at(-1)?.occurredAt ?? snapshot.manifest.createdAt,
    reason: null,
  };
}

function staleProjection(snapshot: Awaited<ReturnType<RunEvidenceStore["readSnapshot"]>>, reason: string): RunProjection {
  return {
    state: "stale",
    observedAt: snapshot.events.at(-1)?.occurredAt ?? snapshot.manifest.createdAt,
    reason,
  };
}

function runContextProjection(snapshot: Awaited<ReturnType<RunEvidenceStore["readSnapshot"]>>): ContextProjection | null {
  const latestModelEvent = [...snapshot.events].reverse().find((event) => event.kind === "ModelCompleted");
  const usage = latestModelEvent && isRecord(latestModelEvent.payload.usage) ? latestModelEvent.payload.usage : null;
  const inputTokens = usage && typeof usage.inputTokens === "number" && Number.isFinite(usage.inputTokens)
    ? usage.inputTokens
    : null;
  const contextWindowTokens = snapshot.manifest.model.contextWindowTokens ?? null;
  const budget = calculateContextBudget(
    contextWindowTokens,
    {
      tokens: inputTokens,
      quality: inputTokens === null ? "unknown" : "exact",
      basis: inputTokens === null ? "provider-usage-unavailable" : "provider-reported-prompt-tokens",
    },
    {
      reservedOutputTokens: 4_096,
      safetyMarginTokens: 1_024,
      compactionThresholdPercent: 20,
    },
  );
  const updatedAt = latestModelEvent?.occurredAt ?? snapshot.manifest.createdAt;
  return {
    scope: "run",
    sessionId: `run-${snapshot.manifest.runId}`,
    sessionRevision: 0,
    compactionRevision: 0,
    budget,
    updatedAt,
  };
}

function deriveStatus(events: readonly RunEvent[], result: RunResult | null): RunStatus {
  if (result) {
    return result.status;
  }
  if (events.some((event) => event.kind === "AgentStarted")) {
    return "running";
  }
  if (events.some((event) => event.kind === "RunDispatched")) {
    return "queued";
  }
  return "created";
}

function calculateMetrics(result: RunResult, events: readonly RunEventIntent[]): RunMetrics {
  const durationMs = result.startedAt ? Math.max(0, Date.parse(result.finishedAt) - Date.parse(result.startedAt)) : null;
  return {
    schemaVersion: 1,
    runId: result.runId,
    status: result.status,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    modelCallCount: events.filter((event) => event.kind === "ModelRequested").length,
    modelAttemptCount: result.attemptCount,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    totalTokens: result.usage.totalTokens,
    costUsd: null,
  };
}

function dispatchFailureResult(runId: string): RunResult {
  return {
    schemaVersion: 1,
    runId,
    status: "failed",
    startedAt: null,
    finishedAt: new Date().toISOString(),
    output: null,
    error: {
      code: "DISPATCH_FAILED",
      message: "The platform execution could not be started.",
      failureKind: "internal",
      retryable: true,
    },
    attemptCount: 0,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function isExecutionNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("not found");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
