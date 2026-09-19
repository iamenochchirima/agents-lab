import { CharacterTokenEstimator } from "../../capabilities/context/token-counter.js";
import {
  buildStudioManifest,
  InvalidStudioRequestError,
  sha256,
  stableStringify,
  validateStudioComparisonRequest,
} from "../domain/manifest.js";
import type {
  StudioComparisonManifest,
  StudioComparisonProjection,
  StudioComparisonRequest,
  StudioComparisonResult,
  StudioComparisonSnapshot,
  StudioEventIntent,
  StudioMetrics,
  StudioRunError,
  StudioScenarioCase,
  StudioStrategyVariant,
  StudioTrajectory,
  StudioTrialManifest,
  StudioTrialResult,
} from "../domain/types.js";
import { resolveStudioCatalog, contextStrategies } from "../catalog.js";
import { ContextStrategyRegistry } from "../strategies/context-strategy.js";
import type { StudioModelAdapter } from "../adapters/replay-model.js";
import { ReplayModelAdapter } from "../adapters/replay-model.js";
import { ReplayEnvironmentAssembler, type StudioEnvironmentAssembler } from "../runtime/environment.js";
import { StudioHarnessRuntime } from "../runtime/harness-runtime.js";
import type { StudioMemoryStore } from "../runtime/contracts.js";
import { memoryPolicies } from "../memory/policies.js";
import {
  StudioEvidenceConflictError,
  StudioEvidenceNotFoundError,
  StudioEvidenceStore,
} from "../adapters/evidence-store.js";

export class StudioComparisonNotFoundError extends Error {
  constructor(readonly comparisonId: string) {
    super(`Studio comparison was not found: ${comparisonId}`);
    this.name = "StudioComparisonNotFoundError";
  }
}

export class StudioIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key is already associated with a different Studio request.");
    this.name = "StudioIdempotencyConflictError";
  }
}

export type StudioFailurePoint = "before-comparison-write" | "before-turn" | "before-model" | "between-trials" | "during-evidence-publication";

export interface StudioFailureInjector {
  inject(point: StudioFailurePoint, comparisonId: string): void | Promise<void>;
}

/** Test/runtime-fixture failure used to model a process interruption. */
export class StudioInjectedCrashError extends Error {
  constructor(readonly point: StudioFailurePoint) {
    super(`Injected Studio interruption at ${point}.`);
    this.name = "StudioInjectedCrashError";
  }
}

export interface StudioComparisonServiceDependencies {
  readonly evidence: StudioEvidenceStore;
  readonly strategies?: ContextStrategyRegistry;
  readonly model?: StudioModelAdapter;
  readonly environment?: StudioEnvironmentAssembler;
  readonly runtime?: StudioHarnessRuntime;
  readonly failureInjector?: StudioFailureInjector;
  readonly now?: () => string;
  readonly tokenCounter?: CharacterTokenEstimator;
  readonly memoryFactory?: (input: {
    readonly comparisonId: string;
    readonly trialId: string;
    readonly scenario: StudioScenarioCase;
    readonly strategy: StudioStrategyVariant;
  }) => StudioMemoryStore;
}

export interface StudioComparisonRunner {
  run(request: StudioComparisonRequest): Promise<StudioComparisonProjection>;
  inspect(comparisonId: string): Promise<StudioComparisonProjection>;
  cancel(comparisonId: string, reason: string): Promise<StudioComparisonProjection>;
}

interface ActiveComparison {
  readonly controller: AbortController;
  readonly promise: Promise<StudioComparisonProjection>;
}

/**
 * Owns Studio's neutral comparison lifecycle. It is deliberately separate from
 * the Platform Lab RunService: a comparison contains multiple local trials and
 * has no platform execution reference to reconcile.
 */
export class StudioComparisonService implements StudioComparisonRunner {
  private readonly strategies: ContextStrategyRegistry;
  private readonly model: StudioModelAdapter;
  private readonly environment: StudioEnvironmentAssembler;
  private readonly runtime: StudioHarnessRuntime;
  private readonly failureInjector: StudioFailureInjector | null;
  private readonly now: () => string;
  private readonly tokenCounter: CharacterTokenEstimator;
  private readonly active = new Map<string, ActiveComparison>();
  private readonly idempotencyQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly dependencies: StudioComparisonServiceDependencies) {
    this.strategies = dependencies.strategies ?? contextStrategies;
    this.model = dependencies.model ?? new ReplayModelAdapter();
    this.environment = dependencies.environment ?? new ReplayEnvironmentAssembler();
    this.failureInjector = dependencies.failureInjector ?? null;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.tokenCounter = dependencies.tokenCounter ?? new CharacterTokenEstimator();
    this.runtime = dependencies.runtime ?? StudioHarnessRuntime.createDefault({
      environment: this.environment,
      model: this.model,
      now: this.now,
    });
  }

  async create(request: StudioComparisonRequest): Promise<StudioComparisonProjection> {
    validateStudioComparisonRequest(request);
    const keyHash = sha256(request.idempotencyKey);
    const previous = this.idempotencyQueues.get(keyHash) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.createOnce(request, keyHash));
    this.idempotencyQueues.set(keyHash, operation);
    try {
      return await operation;
    } finally {
      if (this.idempotencyQueues.get(keyHash) === operation) this.idempotencyQueues.delete(keyHash);
    }
  }

  run(request: StudioComparisonRequest): Promise<StudioComparisonProjection> {
    return this.create(request);
  }

  async inspect(comparisonId: string): Promise<StudioComparisonProjection> {
    let snapshot: StudioComparisonSnapshot;
    try {
      snapshot = await this.dependencies.evidence.readSnapshot(comparisonId);
    } catch (error) {
      if (error instanceof StudioEvidenceNotFoundError) throw new StudioComparisonNotFoundError(comparisonId);
      throw error;
    }
    return {
      ...snapshot,
      status: this.statusFor(snapshot),
    };
  }

  async readEvidence(comparisonId: string, relativePath: string): Promise<string> {
    try {
      return await this.dependencies.evidence.readAllowlistedFile(comparisonId, relativePath);
    } catch (error) {
      if (error instanceof StudioEvidenceNotFoundError) throw new StudioComparisonNotFoundError(comparisonId);
      throw error;
    }
  }

  async cancel(comparisonId: string, reason = "Cancellation requested by the user."): Promise<StudioComparisonProjection> {
    const active = this.active.get(comparisonId);
    if (active) {
      active.controller.abort(reason);
      return active.promise;
    }

    const current = await this.inspect(comparisonId);
    if (current.result) return current;

    const status = current.status === "created" ? "cancelled" : "recovery_required";
    const result: StudioComparisonResult = {
      schemaVersion: 1,
      comparisonId,
      status,
      finishedAt: this.now(),
      trialIds: current.trials.map((trial) => trial.manifest.trialId),
      completedTrialCount: current.trials.filter((trial) => trial.result?.status === "completed").length,
      error: { code: status === "cancelled" ? "STUDIO_CANCELLED" : "STUDIO_RECOVERY_REQUIRED", message: reason, retryable: status !== "cancelled" },
    };
    await this.dependencies.evidence.writeResult(result);
    return this.inspect(comparisonId);
  }

  private async createOnce(request: StudioComparisonRequest, keyHash: string): Promise<StudioComparisonProjection> {
    const fingerprint = requestFingerprint(request);
    const existing = await this.dependencies.evidence.findIdempotency(keyHash);
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new StudioIdempotencyConflictError();
      return this.inspect(existing.comparisonId);
    }

    const catalog = resolveStudioCatalog(request);
    const requestedStrategies = request.experiment.subject.strategies;
    const resolvedStrategies = requestedStrategies.map((strategy) => {
      const implementation = manifestStrategyImplementation(requestedComponent(request), strategy, this.strategies);
      if (implementation.version !== strategy.version) {
        throw new InvalidStudioRequestError(`Studio strategy version is unavailable: ${strategy.id}@${strategy.version}.`);
      }
      return strategy;
    });
    if (resolvedStrategies.length > catalog.environment.maxStrategies) {
      throw new InvalidStudioRequestError(`Studio environment allows at most ${catalog.environment.maxStrategies} strategies.`);
    }

    const experiment = {
      ...catalog.experiment,
      strategies: resolvedStrategies,
    } as const;
    const manifest = buildStudioManifest(request, { ...catalog, experiment }, { now: this.now() });
    await this.failureInjector?.inject("before-comparison-write", manifest.comparisonId);
    await this.dependencies.evidence.createComparison(manifest);
    await this.dependencies.evidence.reserveIdempotency(keyHash, fingerprint, manifest.comparisonId);
    await this.emit(manifest.comparisonId, 1, "ComparisonCreated", { experimentId: manifest.experiment.id });

    const controller = new AbortController();
    const promise = this.execute(manifest, catalog.scenario, controller);
    this.active.set(manifest.comparisonId, { controller, promise });
    try {
      return await promise;
    } finally {
      this.active.delete(manifest.comparisonId);
    }
  }

  private async execute(
    manifest: StudioComparisonManifest,
    scenario: StudioScenarioCase,
    controller: AbortController,
  ): Promise<StudioComparisonProjection> {
    const startedAt = this.now();
    let sourceSequence = (await this.dependencies.evidence.readEvents(manifest.comparisonId)).length + 1;
    const trialIds: string[] = [];
    let completedTrialCount = 0;
    let modelCallCount = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let hasInputTokens = false;
    let hasOutputTokens = false;
    let currentTrial: StudioTrialManifest | null = null;
    let currentTrialStartedAt: string | null = null;

    const emit = async (kind: string, payload: Record<string, unknown>) => {
      await this.emit(manifest.comparisonId, sourceSequence, kind, payload);
      sourceSequence += 1;
    };

    try {
      await emit("ComparisonStarted", { trialCount: manifest.experiment.strategies.length, seed: manifest.seed });
      for (const [index, strategy] of manifest.experiment.strategies.entries()) {
        throwIfAborted(controller.signal);
        if (index > 0) await this.failureInjector?.inject("between-trials", manifest.comparisonId);
        const trialId = `${manifest.comparisonId}-trial-${index + 1}`;
        trialIds.push(trialId);
        currentTrialStartedAt = this.now();
        currentTrial = {
          schemaVersion: 1,
          trialId,
          comparisonId: manifest.comparisonId,
          ordinal: index + 1,
          strategy,
          fixedControlFingerprint: fixedControlFingerprint(manifest, scenario),
        };
        await this.dependencies.evidence.writeTrialManifest(currentTrial);
        await emit("TrialCreated", { trialId, ordinal: index + 1, strategyId: strategy.id });

        await this.failureInjector?.inject("before-turn", manifest.comparisonId);
        const contextStrategy = manifest.experiment.fixedContextStrategy
          ? this.strategies.get(manifest.experiment.fixedContextStrategy.id)
          : this.strategies.get(strategy.id);
        const memory = manifest.experiment.changedComponent === "memory"
          ? this.dependencies.memoryFactory?.({ comparisonId: manifest.comparisonId, trialId, scenario, strategy })
          : undefined;
        if (manifest.experiment.changedComponent === "memory" && !memory) {
          throw new InvalidStudioRequestError("Memory experiments require a configured Studio Memory factory.");
        }
        const turn = await this.runtime.execute({
          comparisonId: manifest.comparisonId,
          trialId,
          manifest,
          scenario,
          strategy,
          context: contextStrategy,
          memory,
          tokenCounter: this.tokenCounter,
          signal: controller.signal,
          events: {
            emit: async (kind, payload) => {
              if (kind === "ModelRequested") await this.failureInjector?.inject("before-model", manifest.comparisonId);
              await emit(kind, payload);
            },
          },
        });
        if (turn.context.budget.inputTokens !== null) {
          inputTokens += turn.context.budget.inputTokens;
          hasInputTokens = true;
        }
        if (turn.model.outputTokens !== null) {
          outputTokens += turn.model.outputTokens;
          hasOutputTokens = true;
        }
        modelCallCount += 1;
        await this.dependencies.evidence.writeContextEvidence({
          schemaVersion: 1,
          comparisonId: manifest.comparisonId,
          trialId,
          strategyId: contextStrategy.id,
          strategyVersion: contextStrategy.version,
          strategyParameters: manifest.experiment.fixedContextStrategy?.parameters ?? (manifest.experiment.changedComponent === "context-management" ? strategy.parameters : {}),
          task: scenario.task,
          retainedMessageIds: turn.context.retainedMessageIds,
          omittedMessageIds: turn.context.omittedMessageIds,
          summarizedMessageIds: turn.context.summarizedMessageIds,
          messages: turn.context.messages,
          budget: turn.context.budget,
          decision: turn.context.decision,
        });
        await this.dependencies.evidence.writeMemoryEvidence(turn.memory);
        await this.dependencies.evidence.writeCompositionEvidence(turn.composition);
        const finishedAt = this.now();
        const trialResult: StudioTrialResult = {
          schemaVersion: 1,
          trialId,
          comparisonId: manifest.comparisonId,
          status: "completed",
          startedAt: currentTrialStartedAt,
          finishedAt,
          output: turn.output,
          grade: turn.grade,
          error: null,
        };
        await this.dependencies.evidence.writeTrialResult(trialResult);
        await emit("TrialCompleted", { trialId, output: turn.output, grade: turn.grade });
        completedTrialCount += 1;
        currentTrial = null;
        currentTrialStartedAt = null;
      }

      const finishedAt = this.now();
      const result: StudioComparisonResult = {
        schemaVersion: 1,
        comparisonId: manifest.comparisonId,
        status: "completed",
        finishedAt,
        trialIds,
        completedTrialCount,
        error: null,
      };
      await this.failureInjector?.inject("during-evidence-publication", manifest.comparisonId);
      await this.dependencies.evidence.writeTrajectory(trajectory(manifest.comparisonId, startedAt, finishedAt));
      await this.dependencies.evidence.writeMetrics(metrics(manifest.comparisonId, "completed", startedAt, finishedAt, trialIds.length, completedTrialCount, modelCallCount, hasInputTokens ? inputTokens : null, hasOutputTokens ? outputTokens : null));
      await this.dependencies.evidence.writeResult(result);
      await emit("ComparisonCompleted", { trialIds, completedTrialCount });
      return this.inspect(manifest.comparisonId);
    } catch (error) {
      if (error instanceof StudioInjectedCrashError) throw error;
      const cancelled = controller.signal.aborted || error instanceof Error && error.name === "AbortError";
      const finishedAt = this.now();
      const failure = runError(error, cancelled);
      if (currentTrial) {
        const trialResult: StudioTrialResult = {
          schemaVersion: 1,
          trialId: currentTrial.trialId,
          comparisonId: manifest.comparisonId,
          status: cancelled ? "cancelled" : "failed",
          startedAt: currentTrialStartedAt ?? startedAt,
          finishedAt,
          output: null,
          grade: null,
          error: failure,
        };
        await this.dependencies.evidence.writeTrialResult(trialResult).catch((writeError) => {
          if (!(writeError instanceof StudioEvidenceConflictError)) throw writeError;
        });
      }
      const status = cancelled ? "cancelled" : "failed";
      const result: StudioComparisonResult = {
        schemaVersion: 1,
        comparisonId: manifest.comparisonId,
        status,
        finishedAt,
        trialIds,
        completedTrialCount,
        error: failure,
      };
      await this.dependencies.evidence.writeTrajectory(trajectory(manifest.comparisonId, startedAt, finishedAt));
      await this.dependencies.evidence.writeMetrics(metrics(manifest.comparisonId, status, startedAt, finishedAt, trialIds.length, completedTrialCount, modelCallCount, hasInputTokens ? inputTokens : null, hasOutputTokens ? outputTokens : null));
      await this.dependencies.evidence.writeResult(result);
      await emit(cancelled ? "ComparisonCancelled" : "ComparisonFailed", { error: failure, completedTrialCount });
      return this.inspect(manifest.comparisonId);
    }
  }

  private async emit(comparisonId: string, sourceSequence: number, kind: string, payload: Record<string, unknown>): Promise<void> {
    const intent: StudioEventIntent = {
      source: "studio-runtime",
      sourceSequence,
      kind,
      occurredAt: this.now(),
      payload,
    };
    await this.dependencies.evidence.appendEvent(comparisonId, intent);
  }

  private statusFor(snapshot: StudioComparisonSnapshot): StudioComparisonProjection["status"] {
    if (snapshot.result) return snapshot.result.status;
    if (this.active.has(snapshot.manifest.comparisonId)) return "running";
    if (snapshot.events.some((event) => event.kind === "ComparisonStarted")) return "recovery_required";
    return "created";
  }
}

function fixedControlFingerprint(manifest: StudioComparisonManifest, scenario: StudioScenarioCase): string {
  return sha256(stableStringify({
    system: manifest.system,
    environment: manifest.environment,
    scenario: {
      id: scenario.id,
      version: scenario.version,
      messages: scenario.messages,
      memorySeeds: scenario.memorySeeds,
      task: scenario.task,
    },
    fixedContextStrategy: manifest.experiment.fixedContextStrategy,
    seed: manifest.seed,
  }));
}

function requestedComponent(request: StudioComparisonRequest): StudioComparisonRequest["experiment"]["subject"]["component"] {
  return request.experiment.subject.component;
}

function manifestStrategyImplementation(
  component: StudioComparisonRequest["experiment"]["subject"]["component"],
  strategy: StudioStrategyVariant,
  contextRegistry: ContextStrategyRegistry,
): { readonly version: string } {
  if (component === "context-management") return contextRegistry.get(strategy.id);
  const implementation = memoryPolicies().find((policy) => policy.adapterId === strategy.id);
  if (!implementation) throw new InvalidStudioRequestError(`Memory policy is unavailable: ${strategy.id}.`);
  return { version: implementation.adapterVersion };
}

function requestFingerprint(request: StudioComparisonRequest): string {
  const { idempotencyKey: _idempotencyKey, ...withoutKey } = request;
  return sha256(stableStringify(withoutKey));
}

function trajectory(comparisonId: string, startedAt: string, finishedAt: string): StudioTrajectory {
  return {
    schemaVersion: 1,
    comparisonId,
    phases: [{ name: "comparison", startedAt, finishedAt }],
  };
}

function metrics(
  comparisonId: string,
  status: StudioMetrics["status"],
  startedAt: string,
  finishedAt: string,
  trialCount: number,
  completedTrialCount: number,
  modelCallCount: number,
  inputTokens: number | null,
  outputTokens: number | null,
): StudioMetrics {
  return {
    schemaVersion: 1,
    comparisonId,
    status,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    trialCount,
    completedTrialCount,
    modelCallCount,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
    costUsd: null,
  };
}

function runError(error: unknown, cancelled: boolean): StudioRunError {
  return {
    code: cancelled ? "STUDIO_CANCELLED" : "STUDIO_RUN_FAILED",
    message: error instanceof Error ? error.message : "Studio comparison failed.",
    retryable: false,
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error(typeof signal.reason === "string" ? signal.reason : "The Studio comparison was cancelled.");
    error.name = "AbortError";
    throw error;
  }
}
