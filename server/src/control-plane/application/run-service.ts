import { buildRunManifest, validateRunRequest } from "../domain/manifest.js";
import type {
  PlatformExecutionReference,
  RunEvent,
  RunEventIntent,
  RunManifest,
  RunMetrics,
  RunRequest,
  RunResult,
  RunStatus,
  RunTrajectory,
} from "../domain/types.js";
import { EvidenceNotFoundError, RunEvidenceStore } from "./evidence-store.js";
import { PlatformRegistry } from "./platform-registry.js";
import type { PlatformRunner, RunnerInspection } from "../ports/runner.js";
import type { ServerConfig } from "../bootstrap/config.js";

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

export interface RunView {
  readonly runId: string;
  readonly status: RunStatus;
  readonly manifest: RunManifest;
  readonly events: readonly RunEvent[];
  readonly executionReference: PlatformExecutionReference | null;
  readonly trajectory: RunTrajectory | null;
  readonly metrics: RunMetrics | null;
  readonly result: RunResult | null;
}

export interface RunServiceDependencies {
  readonly config: ServerConfig;
  readonly evidence: RunEvidenceStore;
  readonly registry: PlatformRegistry;
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
    const registration = this.dependencies.registry.find(request.platform, request.variant);
    const runner = registration?.status === "runnable" ? registration.runner : null;
    if (!runner) {
      throw new RunnerUnavailableError(request.platform, request.variant, registration ? "planned" : "unknown");
    }

    const manifest = buildRunManifest(request, {
      serverVersion: this.dependencies.config.serverVersion,
      platformConfig: runner.manifestConfiguration(),
    });
    if (!this.dependencies.config.allowedModelProviders.includes(manifest.model.provider)) {
      throw new Error(`Model provider is not enabled in the local server profile: ${manifest.model.provider}.`);
    }

    const validation = runner.validate(manifest);
    if (!validation.valid) {
      throw new Error(validation.reason ?? "Runner rejected the run manifest.");
    }

    await this.dependencies.evidence.createRun(manifest);
    await this.appendControlEvent(manifest.runId, "RunCreated", { platform: manifest.platform, variant: manifest.variant });

    let reference;
    try {
      reference = await runner.start(manifest);
      await this.dependencies.evidence.writeExecutionReference(manifest.runId, reference);
      await this.appendControlEvent(manifest.runId, "RunDispatched", {
        executionId: reference.executionId,
        platform: reference.platform,
        variant: reference.variant,
      });
    } catch (error) {
      await this.recordDispatchFailure(manifest, error);
      return this.getRun(manifest.runId);
    }

    return this.reconcile(manifest.runId, runner, reference);
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

    const runner = this.dependencies.registry.runnable(snapshot.manifest);
    if (!runner) {
      return toRunView(snapshot, deriveStatus(snapshot.events, snapshot.result));
    }
    if (!snapshot.executionReference) {
      if (!snapshot.result) {
        await this.recordReconciliationRequired(snapshot.manifest, "No platform execution reference was retained.");
        snapshot = await this.dependencies.evidence.readSnapshot(runId);
      }
      return toRunView(snapshot, deriveStatus(snapshot.events, snapshot.result));
    }

    try {
      return await this.reconcile(runId, runner, snapshot.executionReference);
    } catch (error) {
      if (isExecutionNotFoundError(error)) {
        await this.recordReconciliationRequired(snapshot.manifest, "The retained platform execution could not be found.");
        const reconciled = await this.dependencies.evidence.readSnapshot(runId);
        return toRunView(reconciled, "reconciliation_required");
      }

      // A server read must not turn a temporary platform outage into a
      // fabricated terminal result. Return the last durable Lab projection.
      return toRunView(snapshot, deriveStatus(snapshot.events, snapshot.result));
    }
  }

  async cancelRun(runId: string, reason = "Cancellation requested by the user."): Promise<RunView> {
    const snapshot = await this.readSnapshotOrThrow(runId);
    if (snapshot.result) {
      return toRunView(snapshot, snapshot.result.status);
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
    const inspection = await runner.inspect(reference);
    // Platform inspection may enrich the opaque reference with native status,
    // invocation IDs, retry counts, or reconciliation metadata. Persist that
    // refreshed reference so a later server restart can resume from the latest
    // known native identity.
    await this.dependencies.evidence.writeExecutionReference(runId, inspection.reference);
    for (const intent of inspection.eventIntents) {
      await this.dependencies.evidence.appendEvent(intent);
    }

    if (inspection.result) {
      await this.dependencies.evidence.writeResult(inspection.result);
      if (inspection.trajectory) {
        await this.dependencies.evidence.writeTrajectory(inspection.trajectory);
      }
      await this.dependencies.evidence.writeMetrics(inspection.metrics ?? calculateMetrics(inspection.result, inspection.eventIntents));
    }

    const snapshot = await this.dependencies.evidence.readSnapshot(runId);
    return toRunView(snapshot, inspection.result?.status ?? deriveStatus(snapshot.events, snapshot.result));
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
    const result: RunResult = {
      schemaVersion: 1,
      runId: manifest.runId,
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
    await this.dependencies.evidence.writeResult(result);
    await this.dependencies.evidence.writeTrajectory({ schemaVersion: 1, runId: manifest.runId, phases: [] });
    await this.dependencies.evidence.writeMetrics(calculateMetrics(result, []));
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

function toRunView(snapshot: Awaited<ReturnType<RunEvidenceStore["readSnapshot"]>>, status: RunStatus): RunView {
  return {
    runId: snapshot.manifest.runId,
    status,
    manifest: snapshot.manifest,
    events: snapshot.events,
    executionReference: snapshot.executionReference,
    trajectory: snapshot.trajectory,
    metrics: snapshot.metrics,
    result: snapshot.result,
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

function isExecutionNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("not found");
}
