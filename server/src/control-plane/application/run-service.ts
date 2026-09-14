import { buildRunManifest } from "../domain/manifest.js";
import type {
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
  constructor(readonly platform: string, readonly variant: string) {
    super(`Runner is not available: ${platform}/${variant}`);
    this.name = "RunnerUnavailableError";
  }
}

export interface RunView {
  readonly runId: string;
  readonly status: RunStatus;
  readonly manifest: RunManifest;
  readonly events: readonly RunEvent[];
  readonly temporalReference: RunEvidenceSnapshotReference | null;
  readonly trajectory: RunTrajectory | null;
  readonly metrics: RunMetrics | null;
  readonly result: RunResult | null;
}

export interface RunEvidenceSnapshotReference {
  readonly platform: "temporal";
  readonly namespace: string;
  readonly taskQueue: string;
  readonly workflowId: string;
  readonly workflowRunId: string;
  readonly workflowType: string;
}

export interface RunServiceDependencies {
  readonly config: ServerConfig;
  readonly evidence: RunEvidenceStore;
  readonly registry: PlatformRegistry;
}

/**
 * Coordinates a Lab run without owning platform execution. The runner is the
 * only component allowed to know how to start or inspect Temporal; this service
 * owns the durable Lab projection and its recovery rules.
 */
export class RunService {
  constructor(private readonly dependencies: RunServiceDependencies) {}

  async createRun(request: RunRequest): Promise<RunView> {
    const manifest = buildRunManifest(request, {
      serverVersion: this.dependencies.config.serverVersion,
      temporalEndpoint: this.dependencies.config.temporal.endpoint,
      temporalNamespace: this.dependencies.config.temporal.namespace,
      temporalTaskQueue: this.dependencies.config.temporal.taskQueue,
      activityTimeoutMs: this.dependencies.config.temporal.activityTimeoutMs,
      preDispatchRetryLimit: this.dependencies.config.temporal.preDispatchRetryLimit,
      preDispatchRetryBackoffMs: this.dependencies.config.temporal.preDispatchRetryBackoffMs,
    });
    if (!this.dependencies.config.allowedModelProviders.includes(manifest.model.provider)) {
      throw new Error(`Model provider is not enabled in the local server profile: ${manifest.model.provider}.`);
    }

    const runner = this.dependencies.registry.runnable(manifest);
    if (!runner) {
      throw new RunnerUnavailableError(manifest.platform, manifest.variant);
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
      await this.dependencies.evidence.writeTemporalReference(manifest.runId, reference);
      await this.appendControlEvent(manifest.runId, "RunDispatched", {
        workflowId: reference.workflowId,
        workflowRunId: reference.workflowRunId,
        workflowType: reference.workflowType,
        namespace: reference.namespace,
        taskQueue: reference.taskQueue,
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
    if (!snapshot.temporalReference) {
      if (!snapshot.result) {
        await this.recordReconciliationRequired(snapshot.manifest, "No Temporal execution reference was retained.");
        snapshot = await this.dependencies.evidence.readSnapshot(runId);
      }
      return toRunView(snapshot, deriveStatus(snapshot.events, snapshot.result));
    }

    try {
      return await this.reconcile(runId, runner, snapshot.temporalReference);
    } catch (error) {
      if (isWorkflowNotFoundError(error)) {
        await this.recordReconciliationRequired(snapshot.manifest, "The retained Temporal execution could not be found.");
        const reconciled = await this.dependencies.evidence.readSnapshot(runId);
        return toRunView(reconciled, "reconciliation_required");
      }

      // A control-plane read must not turn a temporary Temporal outage into a
      // fabricated terminal result. Return the last durable Lab projection.
      return toRunView(snapshot, deriveStatus(snapshot.events, snapshot.result));
    }
  }

  async cancelRun(runId: string, reason = "Cancellation requested by the user."): Promise<RunView> {
    const snapshot = await this.readSnapshotOrThrow(runId);
    if (snapshot.result) {
      return toRunView(snapshot, snapshot.result.status);
    }
    if (!snapshot.temporalReference) {
      await this.recordReconciliationRequired(snapshot.manifest, "Cannot cancel without a retained Temporal execution reference.");
      return this.getRun(runId);
    }

    const runner = this.dependencies.registry.runnable(snapshot.manifest);
    if (!runner) {
      throw new RunnerUnavailableError(snapshot.manifest.platform, snapshot.manifest.variant);
    }
    const cancellation = await runner.cancel(snapshot.temporalReference, reason);
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
    reference: RunEvidenceSnapshotReference,
  ): Promise<RunView> {
    const inspection = await runner.inspect(reference);
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
        message: "The Temporal workflow could not be started.",
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
    await this.appendControlEvent(manifest.runId, "RunReconciliationRequired", { code: "TEMPORAL_REFERENCE_MISSING" });
    const result: RunResult = {
      schemaVersion: 1,
      runId: manifest.runId,
      status: "reconciliation_required",
      startedAt: null,
      finishedAt: new Date().toISOString(),
      output: null,
      error: { code: "TEMPORAL_REFERENCE_MISSING", message, failureKind: "reconciliation", retryable: false },
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
    temporalReference: snapshot.temporalReference,
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

function isWorkflowNotFoundError(error: unknown): boolean {
  return error instanceof Error && (error.name === "WorkflowNotFoundError" || error.message.includes("not found"));
}
