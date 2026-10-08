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
import { ContextSessionNotFoundError } from "../../capabilities/context/session-store.js";
import { ContextService } from "../../capabilities/context/context-service.js";
import type { CapabilityCatalog } from "../../capabilities/catalog.js";

const CONTEXT_CAPABLE_VARIANTS: ReadonlySet<string> = new Set([
  "temporal/baseline",
  "restate/baseline",
  "langgraph/baseline",
  "mastra/baseline",
  "mastra/workflow",
]);

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

/** A currently unreachable native service rejected admission before any new turn/run. */
export class RunnerConnectionUnavailableError extends Error {
  constructor(readonly platform: string, readonly variant: string) {
    super(`Native runner connection is unavailable: ${platform}/${variant}.`);
    this.name = "RunnerConnectionUnavailableError";
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
  readonly capabilities?: CapabilityCatalog;
}

/**
 * Coordinates a Lab run without owning platform execution. The runner is the
 * only component allowed to know how to start or inspect a platform; this service
 * owns the durable Lab projection and its recovery rules.
 */
export class RunService {
  private readonly contextRecoveryInFlight = new Map<string, Promise<PlatformExecutionReference | null>>();

  constructor(private readonly dependencies: RunServiceDependencies) {}

  async createRun(request: RunRequest): Promise<RunView> {
    validateRunRequest(request);
    const effectiveRequest = await this.resolveCapabilities(await this.resolveModelMetadata(request));
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

    // A retained client identity can be replayed while its platform is offline.
    // Validate through the existing admission contract before returning that run.
    // A new request must pass readiness before creating any session turn or run.
    let contextTurn: Awaited<ReturnType<RunService["admitContextTurn"]>> = null;
    if (effectiveRequest.sessionId && effectiveRequest.clientTurnId && this.dependencies.context) {
      let existing = false;
      try {
        existing = (await this.dependencies.context.sessions.readTranscript(effectiveRequest.sessionId)).some(message =>
          message.role === "user" && message.metadata?.clientTurnId === effectiveRequest.clientTurnId);
      } catch (error) {
        if (!(error instanceof ContextSessionNotFoundError)) throw error;
      }
      if (existing) {
        contextTurn = await this.admitContextTurn(effectiveRequest, draftManifest.runId);
        if (contextTurn) {
          try { return await this.getRun(contextTurn.turn.runId); }
          catch (error) { if (!(error instanceof RunNotFoundError)) throw error; }
        }
      }
    }
    try {
      if (!(await runner.checkConnection()).reachable) throw new RunnerConnectionUnavailableError(request.platform, request.variant);
    } catch (error) {
      if (error instanceof RunnerConnectionUnavailableError) throw error;
      throw new RunnerConnectionUnavailableError(request.platform, request.variant);
    }
    contextTurn ??= await this.admitContextTurn(effectiveRequest, draftManifest.runId);
    if (contextTurn && contextTurn.turn.runId !== draftManifest.runId) {
      // Another caller may have admitted this client key during the readiness
      // check. Reuse its durable run, or repair an interrupted run creation.
      try { return await this.getRun(contextTurn.turn.runId); }
      catch (error) { if (!(error instanceof RunNotFoundError)) throw error; }
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
      await this.recordCapabilityResolution(manifest);
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

  private async resolveCapabilities(request: RunRequest): Promise<RunRequest> {
    const profileId = request.capabilities?.profileId;
    if (!profileId) {
      if (request.capabilities?.requestedSkillIds?.length) throw new InvalidRunRequestError("Skill selection requires a capability profile.");
      // Direct callers also cannot supply execution bindings or a tool snapshot.
      if (!request.capabilities) return request;
      const { toolCatalog: _untrusted, ...capabilities } = request.capabilities;
      const toolCatalog = this.dependencies.capabilities?.toolSnapshot(capabilities.tools.enabledNames);
      if (toolCatalog?.tools.some(tool => tool.execution.kind === "hosted")) {
        throw new InvalidRunRequestError("Package tools require a configured capability profile and its approval decisions.");
      }
      return { ...request, capabilities: { ...capabilities, ...(toolCatalog ? { toolCatalog } : {}) } };
    }
    if (!this.dependencies.capabilities) {
      throw new Error("Capability profiles are not configured for this server.");
    }
    const resolved = this.dependencies.capabilities.resolve(profileId, request.capabilities.approvals ?? []);
    if (resolved.profile.supportedVariants && !resolved.profile.supportedVariants.includes(`${request.platform}/${request.variant}`)) {
      throw new InvalidRunRequestError("The selected capability profile is not supported by this platform variant.");
    }
    await this.dependencies.capabilities.resolveRequestedSkills(profileId, request.capabilities.requestedSkillIds ?? []);
    const toolNames = resolved.resolution.grants
      .filter(({ manifest }) => manifest.kind === "tool" || manifest.source.kind === "connection")
      .map(({ manifest }) => manifest.id);
    return {
      ...request,
      capabilities: {
        ...request.capabilities,
        tools: {
          enabledNames: toolNames,
          approvedNames: resolved.resolution.grants
            .filter(({ approval }) => approval === "approved")
            .map(({ manifest }) => manifest.id),
          maxRounds: request.capabilities.tools.maxRounds,
          maxCalls: request.capabilities.tools.maxCalls,
        },
        connections: resolved.resolution.grants
          .filter(({ manifest, grant }) => manifest.source.kind === "connection" && grant.connectionRef !== undefined)
          .map(({ manifest, grant }) => ({
            toolName: manifest.id,
            connectionRef: grant.connectionRef!,
            operations: [...grant.allowedOperations],
            ...(manifest.mcp ? { mcp: manifest.mcp } : {}),
          })),
        toolCatalog: this.dependencies.capabilities.toolSnapshot(toolNames, resolved.resolution),
        resolution: resolved.resolution,
        skills: resolved.skills.map((skill) => ({
          id: skill.manifest.id,
          version: skill.manifest.version,
          name: skill.manifest.name,
          description: skill.manifest.description,
          digest: skill.manifest.provenance.digest,
        })),
      },
    };
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
    // purged after its result was projected). Reconciliation-required observations
    // remain provisional, including a missing reference that is restored later.
    // Inspect only the retained execution identity; never redispatch the task.
    const provisionalReconciliation = snapshot.result?.status === "reconciliation_required";
    if (snapshot.result && !provisionalReconciliation) {
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
        if (snapshot.result?.status !== "reconciliation_required") {
          await this.recordReconciliationRequired(snapshot.manifest, "The retained platform execution could not be found.");
        }
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

  async resumeRun(runId: string, input: unknown): Promise<RunView> {
    const snapshot = await this.readSnapshotOrThrow(runId);
    if (snapshot.result) return toRunView(snapshot, snapshot.result.status, await this.contextProjection(snapshot.manifest));
    if (!snapshot.executionReference) {
      await this.recordReconciliationRequired(snapshot.manifest, "Cannot resume without a retained platform execution reference.");
      return this.getRun(runId);
    }

    const runner = this.dependencies.registry.runnable(snapshot.manifest);
    if (!runner?.resume) {
      throw new Error(`The selected platform variant does not support resume: ${snapshot.manifest.platform}/${snapshot.manifest.variant}.`);
    }
    const resumed = await runner.resume(snapshot.executionReference, input);
    if (resumed.accepted) {
      await this.appendControlEvent(runId, "RunResumeRequested", { message: resumed.message });
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
    const persistedEvents = await this.dependencies.evidence.readEvents(runId);
    await this.projectContextSnapshot(runId, await this.dependencies.evidence.readManifest(runId), inspection.eventIntents);

    if (inspection.result?.error?.code === "LANGGRAPH_CONTEXT_OVERFLOW") {
      const recoveredReference = await this.tryRecoverContextOverflow(runId, runner, reference);
      if (recoveredReference) {
        return this.reconcile(runId, runner, recoveredReference);
      }
    }

    if (inspection.result) {
      await this.dependencies.evidence.writeResult(inspection.result);
      // An ambiguous submission produces a provisional result only. Do not
      // persist its empty trajectory or zero metrics: the retained platform
      // execution may later resolve to a different terminal projection.
      if (inspection.result.status !== "reconciliation_required") {
        if (inspection.trajectory) {
          await this.dependencies.evidence.writeTrajectory(inspection.trajectory);
        }
        await this.dependencies.evidence.writeMetrics(withCapabilityMetrics(inspection.metrics ?? calculateMetrics(inspection.result, persistedEvents), persistedEvents));
        await this.settleContextTurn(await this.dependencies.evidence.readManifest(runId), inspection.result);
      }
    }

    const snapshot = await this.dependencies.evidence.readSnapshot(runId);
    return toRunView(snapshot, inspection.result?.status ?? deriveStatus(snapshot.events, snapshot.result), await this.contextProjection(snapshot.manifest));
  }

  private async admitContextTurn(request: RunRequest, runId: string) {
    if (!this.dependencies.context || !CONTEXT_CAPABLE_VARIANTS.has(`${request.platform}/${request.variant}`)) {
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
      skillContexts: request.capabilities?.profileId && this.dependencies.capabilities
        ? this.dependencies.capabilities.resolve(request.capabilities.profileId, request.capabilities.approvals ?? []).skills.map((skill) => skill.context)
        : [],
      contextWindowTokens: request.model.contextWindowTokens ?? null,
      reservedOutputTokens: 4_096,
      safetyMarginTokens: 1_024,
      compactionThresholdPercent: 20,
      recentMessageGroups: 2,
    });
    const admitted = await this.dependencies.context.sessions.admitTurn(session.sessionId, runId, request.task.prompt, undefined, request.clientTurnId);
    if (request.capabilities?.requestedSkillIds?.length && this.dependencies.capabilities && (admitted.turn.status === "admitted" || admitted.turn.status === "running")) {
      try {
        const selected = await this.dependencies.capabilities.resolveRequestedSkills(request.capabilities.profileId!, request.capabilities.requestedSkillIds);
        for (const skill of selected) await this.dependencies.context.sessions.activateSkill(session.sessionId, admitted.turn.turnId, skill);
      } catch (error) {
        await this.dependencies.context.sessions.settleTurn(session.sessionId, admitted.turn.turnId, { status: "failed", output: null, error: "Explicit skill activation failed before dispatch." });
        throw error;
      }
    }
    return admitted;
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

  private async tryRecoverContextOverflow(
    runId: string,
    runner: PlatformRunner,
    reference: PlatformExecutionReference,
  ): Promise<PlatformExecutionReference | null> {
    if (!runner.recoverContextOverflow) return null;

    const snapshot = await this.dependencies.evidence.readSnapshot(runId);
    if (snapshot.events.some((event) => event.source === "control-plane" && event.kind === "ContextRecoveryRequested")) {
      return null;
    }

    const existing = this.contextRecoveryInFlight.get(runId);
    if (existing) return existing;

    const recovery = this.performContextOverflowRecovery(runId, runner, reference);
    this.contextRecoveryInFlight.set(runId, recovery);
    try {
      return await recovery;
    } finally {
      if (this.contextRecoveryInFlight.get(runId) === recovery) {
        this.contextRecoveryInFlight.delete(runId);
      }
    }
  }

  private async performContextOverflowRecovery(
    runId: string,
    runner: PlatformRunner,
    reference: PlatformExecutionReference,
  ): Promise<PlatformExecutionReference | null> {
    const manifest = await this.dependencies.evidence.readManifest(runId);
    await this.appendControlEvent(runId, "ContextRecoveryRequested", {
      trigger: "provider_overflow",
      previousExecutionId: reference.executionId,
    });
    try {
      const recovered = await runner.recoverContextOverflow!(manifest, reference);
      await this.dependencies.evidence.writeExecutionReference(runId, recovered, { allowIdentityChange: true });
      await this.appendControlEvent(runId, "ContextRecoveryDispatched", {
        executionId: recovered.executionId,
        trigger: "provider_overflow",
      });
      return recovered;
    } catch {
      await this.appendControlEvent(runId, "ContextRecoveryFailed", {
        code: "CONTEXT_RECOVERY_FAILED",
        trigger: "provider_overflow",
      });
      return null;
    }
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

  private async recordCapabilityResolution(manifest: RunManifest): Promise<void> {
    const resolution = manifest.capabilities?.resolution;
    if (!resolution) return;
    await this.appendControlEvent(manifest.runId, "CapabilityResolutionRecorded", {
      profileId: manifest.capabilities?.profileId ?? null,
      policyId: resolution.policy.policyId,
      decisions: resolution.decisions.map((decision) => ({
        capabilityId: decision.capabilityId,
        version: decision.version,
        status: decision.status,
        code: decision.code,
      })),
      grants: resolution.grants.map(({ manifest: capability, grant, approval }) => ({
        capabilityId: capability.id,
        version: capability.version,
        approval,
        allowedOperations: [...grant.allowedOperations],
        connectionRef: grant.connectionRef ?? null,
      })),
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
    // The execution may still complete after its reference is recovered. Empty
    // trajectory or zero metrics would become immutable and block that projection.
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
  const suspended = [...events].reverse().find((event) => event.kind === "WorkflowSuspended" || event.kind === "WorkflowResumed");
  if (suspended?.kind === "WorkflowSuspended") return "suspended";
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
    ...capabilityMetricCounts(events),
  };
}

function withCapabilityMetrics(metrics: RunMetrics, events: readonly RunEventIntent[]): RunMetrics {
  return { ...metrics, ...capabilityMetricCounts(events) };
}

function capabilityMetricCounts(events: readonly RunEventIntent[]): Pick<RunMetrics, "toolCallCount" | "toolAttemptCount" | "connectionCallCount" | "connectionUnknownCount" | "approvalDecisionCount" | "retryCount" | "toolFailureCount" | "toolCancellationCount" | "toolTimeoutCount" | "unknownOutcomeCount" | "capabilityResolutionCount" | "toolDurationMs" | "approvalGrantedCount" | "approvalDeniedCount" | "approvalRequiredCount" | "oauthRefreshCount"> {
  const resolutionDecisionCount = events.reduce((count, event) => {
    if (event.kind !== "CapabilityResolutionRecorded" || !isRecord(event.payload) || !Array.isArray(event.payload.decisions)) return count;
    return count + event.payload.decisions.length;
  }, 0);
  const toolFailureEvents = events.filter((event) => ["ToolExecutionFailed", "ToolCallRejected", "ToolPolicyDenied"].includes(event.kind));
  const unknownOutcomeEvents = events.filter((event) => event.kind === "ToolExecutionUnknown" || event.kind.endsWith("OutcomeUnknown") || (isRecord(event.payload) && isRecord(event.payload.connection) && event.payload.connection.status === "unknown"));
  const capabilityResolutionEvents = events.filter((event) => event.kind === "CapabilityResolutionRecorded");
  const approvalOutcomes = capabilityResolutionEvents.reduce((counts, event) => {
    if (!isRecord(event.payload) || !Array.isArray(event.payload.decisions)) return counts;
    for (const decision of event.payload.decisions) {
      if (!isRecord(decision) || typeof decision.status !== "string") continue;
      if (decision.status === "granted") counts.granted += 1;
      else if (decision.status === "denied") counts.denied += 1;
      else if (decision.status === "approval_required") counts.required += 1;
    }
    return counts;
  }, { granted: 0, denied: 0, required: 0 });
  const toolDurationMs = events.reduce((duration, event) => {
    if (!event.kind.startsWith("ToolExecution") || !isRecord(event.payload) || typeof event.payload.durationMs !== "number" || !Number.isFinite(event.payload.durationMs) || event.payload.durationMs < 0) return duration;
    return duration + event.payload.durationMs;
  }, 0);
  return {
    toolCallCount: events.filter((event) => event.kind === "ToolCallRequested").length,
    toolAttemptCount: events.filter((event) => event.kind === "ToolExecutionStarted").length,
    connectionCallCount: events.filter((event) => event.kind === "ToolExecutionCompleted" || event.kind === "ToolExecutionFailed" || event.kind === "ToolExecutionUnknown").filter((event) => isRecord(event.payload.connection)).length,
    connectionUnknownCount: unknownOutcomeEvents.length,
    approvalDecisionCount: resolutionDecisionCount + events.filter((event) => event.kind === "ToolPolicyDenied" || event.kind === "WorkflowSuspended" || event.kind === "WorkflowResumed").length,
    retryCount: events.filter((event) => event.kind === "ModelRetryScheduled" || event.kind === "ModelRetryRequested").length,
    toolFailureCount: toolFailureEvents.length,
    toolCancellationCount: events.filter((event) => event.kind === "ToolExecutionCancelled" || (isRecord(event.payload) && event.payload.status === "cancelled")).length,
    toolTimeoutCount: toolFailureEvents.filter((event) => isRecord(event.payload) && typeof event.payload.code === "string" && event.payload.code.includes("TIMEOUT")).length,
    unknownOutcomeCount: unknownOutcomeEvents.length,
    capabilityResolutionCount: capabilityResolutionEvents.length,
    toolDurationMs,
    approvalGrantedCount: approvalOutcomes.granted,
    approvalDeniedCount: approvalOutcomes.denied,
    approvalRequiredCount: approvalOutcomes.required,
    oauthRefreshCount: events.filter((event) => event.kind === "OAuthRefreshStarted" || event.kind === "OAuthRefreshCompleted" || event.kind === "OAuthRefreshFailed").length,
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
