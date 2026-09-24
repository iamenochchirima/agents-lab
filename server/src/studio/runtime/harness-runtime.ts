import type { CharacterTokenEstimator } from "../../capabilities/context/token-counter.js";
import type { StudioScenarioCase } from "../domain/types.js";
import type { StudioModelAdapter } from "../adapters/replay-model.js";
import { StudioContextOverflowError } from "../adapters/replay-model.js";
import { recoverContextAfterProviderOverflow } from "../strategies/context-strategy.js";
import { ReplayEnvironmentAssembler, type StudioEnvironmentAssembler } from "./environment.js";
import {
  createBaselineStudioComponents,
  memoryRecordsAsMessages,
} from "./baseline-components.js";
import type {
  HarnessTurnInput,
  HarnessTurnResult,
  StudioHarnessComponentFactory,
  StudioHarnessComponents,
  StudioHarnessRuntimeDependencies,
  StudioMemoryStore,
} from "./contracts.js";
import { StudioMemoryCancellationError } from "../memory/contracts.js";

/**
 * Coordinates one complete Studio trial. Comparison lifecycle and evidence file
 * publication stay outside this module. The runtime only returns typed results
 * and sends ordered observations to the comparison-owned event sink.
 */
export class StudioHarnessRuntime {
  private readonly environment: StudioEnvironmentAssembler;
  private readonly model: StudioModelAdapter;
  private readonly memory?: StudioMemoryStore;
  private readonly componentsFactory: StudioHarnessComponentFactory;
  private readonly now: () => string;

  constructor(dependencies: StudioHarnessRuntimeDependencies) {
    this.environment = dependencies.environment ?? new ReplayEnvironmentAssembler();
    this.model = dependencies.model;
    this.memory = dependencies.memory;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.componentsFactory = dependencies.components ?? ((input) => createBaselineStudioComponents({
      context: input.context,
      model: this.model,
      memory: input.memory ?? this.memory,
      now: input.now,
    }));
  }

  async execute(input: HarnessTurnInput): Promise<HarnessTurnResult> {
    throwIfAborted(input.signal);
    const turnId = input.turnId ?? input.trialId;
    const environment = this.environment.assemble(input.manifest, input.scenario);
    const components = this.componentsFactory({
      comparisonId: input.comparisonId,
      trialId: input.trialId,
      manifest: input.manifest,
      scenario: input.scenario,
      context: input.context,
      model: this.model,
      memory: input.memory ?? this.memory,
      now: this.now,
    });
    assertStudioHarnessComponents(components);
    const composition = compositionEvidence(input, components);

    const normalized = components.input.normalize({
      task: environment.task,
      messages: environment.messages,
    });
    await input.events.emit("InputNormalized", {
      trialId: input.trialId,
      adapterId: components.input.adapterId,
      adapterVersion: components.input.adapterVersion,
      messageIds: normalized.messages.map((message) => message.messageId),
      trustedMessageIds: normalized.trustedMessageIds,
      untrustedMessageIds: normalized.untrustedMessageIds,
    });

    const seededRecordIds = input.scenario.memorySeeds?.map((seed) => seed.recordId) ?? [];
    const memoryExperiment = input.manifest.experiment.changedComponent === "memory";
    const fixedMemoryDependency = input.manifest.experiment.fixedMemoryStrategy !== undefined;
    const inspectableMemory = memoryExperiment || fixedMemoryDependency;
    if (seededRecordIds.length > 0) {
      if (!components.memory.seed) throw new StudioHarnessCompositionError("The Memory scenario requires a seed-capable Memory adapter.");
      await components.memory.seed(input.scenario.memorySeeds ?? [], `seed-${input.trialId}`);
      await input.events.emit("MemorySeeded", {
        trialId: input.trialId,
        adapterId: components.memory.adapterId,
        adapterVersion: components.memory.adapterVersion,
        seededRecordIds,
      });
    }

    const memoryRead = await components.memory.read({ task: normalized.task, now: this.now(), signal: input.signal });
    if (inspectableMemory) {
      await input.events.emit("MemoryCandidatesRanked", {
        trialId: input.trialId,
        adapterId: components.memory.adapterId,
        adapterVersion: components.memory.adapterVersion,
        candidateCount: memoryRead.candidates.length,
        candidates: memoryRead.candidates.map((candidate) => ({
          recordId: candidate.record.recordId,
          score: candidate.score,
          reason: candidate.reason,
          selected: candidate.selected,
        })),
      });
      await input.events.emit("MemoryRetrieved", {
        trialId: input.trialId,
        adapterId: components.memory.adapterId,
        adapterVersion: components.memory.adapterVersion,
        retrievedRecordIds: memoryRead.retrievedRecordIds,
        omittedRecordIds: memoryRead.omittedRecordIds,
      });
      if (memoryRead.stateRecovered) {
        await input.events.emit("MemoryStateRecovered", {
          trialId: input.trialId,
          adapterId: components.memory.adapterId,
          adapterVersion: components.memory.adapterVersion,
          stateRevision: memoryRead.stateRevision,
        });
      }
    } else {
      await input.events.emit("MemoryRead", {
        trialId: input.trialId,
        adapterId: components.memory.adapterId,
        adapterVersion: components.memory.adapterVersion,
        retrievedRecordIds: memoryRead.retrievedRecordIds,
      });
    }

    const memoryMessages = memoryRecordsAsMessages(memoryRead.records, `studio-${input.scenario.id}`, this.now());
    const contextInput = {
      trialId: input.trialId,
      task: normalized.task,
      messages: [...normalized.messages, ...memoryMessages],
      contextWindowTokens: environment.contextWindowTokens,
      budgetPolicy: environment.budgetPolicy,
      tokenCounter: input.tokenCounter,
      strategy: input.strategy,
    } as const;
    let context = components.context.assemble(contextInput);
    await input.events.emit("ContextAssembled", {
      trialId: input.trialId,
      strategyId: components.context.id,
      retainedMessageIds: context.retainedMessageIds,
      omittedMessageIds: context.omittedMessageIds,
      summarizedMessageIds: context.summarizedMessageIds,
      inputTokens: context.budget.inputTokens,
      remainingTokens: context.budget.remainingTokens,
      pressure: context.budget.pressure,
      decision: context.decision,
      research: context.research ?? null,
    });
    if (context.decision !== "within-budget") {
      throw new Error(`Context strategy ${components.context.id} did not produce a within-budget context.`);
    }

    const plan = components.planner.plan({ task: normalized.task, context: context.messages });
    await input.events.emit("PlanProduced", {
      trialId: input.trialId,
      adapterId: components.planner.adapterId,
      adapterVersion: components.planner.adapterVersion,
      intent: plan.intent,
      reason: plan.reason,
    });
    await input.events.emit("ControlLoopStarted", {
      trialId: input.trialId,
      adapterId: components.control.adapterId,
      adapterVersion: components.control.adapterVersion,
      maxTurns: components.control.maxTurns,
    });

    let modelCalls = 0;
    let overflowRecoveryUsed = false;
    const response = await components.control.run({
      signal: input.signal,
      act: async () => {
        throwIfAborted(input.signal);
        while (true) {
          await input.events.emit("ModelRequested", {
            trialId: input.trialId,
            provider: components.model.provider,
            model: components.model.model,
            messageIds: context.messages.map((message) => message.messageId),
          });
          modelCalls += 1;
          try {
            const result = await components.model.complete({
              model: input.manifest.environment.model.model,
              task: normalized.task,
              messages: context.messages,
              seed: input.manifest.seed,
              expectedAnswer: input.scenario.expectedAnswer,
            }, input.signal);
            await input.events.emit("ModelCompleted", {
              trialId: input.trialId,
              provider: components.model.provider,
              model: components.model.model,
              providerRequestId: result.providerRequestId ?? null,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              costUsd: result.costUsd ?? null,
            });
            return result;
          } catch (error) {
            if (overflowRecoveryUsed || !isContextOverflowError(error)) throw error;
            overflowRecoveryUsed = true;
            const previousContext = context;
            const recoveredContext = recoverContextAfterProviderOverflow(contextInput, previousContext);
            await input.events.emit("ContextOverflowRecovery", {
              trialId: input.trialId,
              recovered: recoveredContext !== null,
              originalStrategyId: components.context.id,
              recoveryStrategyId: recoveredContext?.research?.strategyId ?? null,
              originalMessageIds: previousContext.retainedMessageIds,
              recoveredMessageIds: recoveredContext?.retainedMessageIds ?? [],
              reason: error instanceof Error ? error.message : "The model provider rejected the Context.",
            });
            if (!recoveredContext) throw error;
            context = recoveredContext;
            await input.events.emit("ContextAssembled", {
              trialId: input.trialId,
              strategyId: components.context.id,
              retainedMessageIds: context.retainedMessageIds,
              omittedMessageIds: context.omittedMessageIds,
              summarizedMessageIds: context.summarizedMessageIds,
              inputTokens: context.budget.inputTokens,
              remainingTokens: context.budget.remainingTokens,
              pressure: context.budget.pressure,
              decision: context.decision,
              research: context.research ?? null,
              recovery: "provider-overflow",
            });
          }
        }
      },
    });

    const toolObservation = components.tools.inspectModelResponse(response);
    await input.events.emit("ToolDispatchSkipped", {
      trialId: input.trialId,
      adapterId: components.tools.adapterId,
      adapterVersion: components.tools.adapterVersion,
      status: toolObservation.status,
      toolCallCount: toolObservation.toolCallCount,
    });
    const computerObservation = components.computerUse.inspectModelResponse(response);
    await input.events.emit("ComputerUseUnavailable", {
      trialId: input.trialId,
      adapterId: components.computerUse.adapterId,
      adapterVersion: components.computerUse.adapterVersion,
      status: computerObservation.status,
      reason: computerObservation.reason,
    });

    const output = components.output.collect(response);
    const safety = components.safety.check({
      output: output.output,
      trustedMessageIds: normalized.trustedMessageIds,
    });
    await input.events.emit("SafetyChecked", {
      trialId: input.trialId,
      adapterId: components.safety.adapterId,
      adapterVersion: components.safety.adapterVersion,
      allowed: safety.allowed,
      reason: safety.reason,
    });
    if (!safety.allowed) throw new Error(`Studio safety gate rejected the output: ${safety.reason}`);

    await input.events.emit("OutputCollected", {
      trialId: input.trialId,
      adapterId: components.output.adapterId,
      adapterVersion: components.output.adapterVersion,
      outputBytes: Buffer.byteLength(output.output, "utf8"),
      sideEffect: output.sideEffect,
    });
    let memoryWrite: Awaited<ReturnType<StudioMemoryStore["write"]>>;
    try {
      memoryWrite = fixedMemoryDependency
        ? emptyMemoryWrite(memoryRead)
        : await components.memory.write({
          trialId: input.trialId,
          task: normalized.task,
          turnId,
          output: output.output,
          now: this.now(),
          signal: input.signal,
        });
    } catch (error) {
      await emitMemoryCancellation(input, components, error);
      throw error;
    }
    if (inspectableMemory) {
      await input.events.emit("MemoryWriteDecided", {
        trialId: input.trialId,
        adapterId: components.memory.adapterId,
        adapterVersion: components.memory.adapterVersion,
        decisions: memoryWrite.decisions.map((decision) => ({
          operationId: decision.operationId,
          operation: decision.operation,
          recordId: decision.recordId,
          targetRecordId: decision.targetRecordId,
          logicalKey: decision.logicalKey,
          scope: decision.scope,
          reason: decision.reason,
          stateRevision: decision.stateRevision,
        })),
      });
    } else {
      await input.events.emit("MemoryWritten", {
        trialId: input.trialId,
        adapterId: components.memory.adapterId,
        adapterVersion: components.memory.adapterVersion,
        writtenRecordIds: memoryWrite.writtenRecordIds,
      });
    }
    let memoryConsolidated: Awaited<ReturnType<StudioMemoryStore["consolidate"]>>;
    try {
      memoryConsolidated = fixedMemoryDependency
        ? emptyMemoryConsolidation(memoryRead)
        : await components.memory.consolidate({ turnId, now: this.now(), signal: input.signal });
    } catch (error) {
      await emitMemoryCancellation(input, components, error);
      throw error;
    }
    await input.events.emit("MemoryConsolidated", {
      trialId: input.trialId,
      adapterId: components.memory.adapterId,
      adapterVersion: components.memory.adapterVersion,
      expiredRecordIds: memoryConsolidated.expiredRecordIds,
      stateRevision: memoryConsolidated.stateRevision,
    });
    if (inspectableMemory) {
      await input.events.emit("MemoryStatePersisted", {
        trialId: input.trialId,
        adapterId: components.memory.adapterId,
        adapterVersion: components.memory.adapterVersion,
        stateRevision: memoryConsolidated.stateRevision,
        activeRecordIds: memoryConsolidated.activeRecordIds,
      });
    }

    const grade = gradeContext(input.scenario, context.retainedMessageIds, memoryRead.retrievedRecordIds, context.research?.memoryRecordIdsModelBound ?? [], output.output);
    await input.events.emit("TrialGraded", { trialId: input.trialId, ...grade });
    await input.events.emit("TurnCompleted", {
      trialId: input.trialId,
      adapterId: components.observability.adapterId,
      adapterVersion: components.observability.adapterVersion,
    });

    return {
      context,
      contextBudget: context.budget,
      model: response,
      modelCalls,
      output: output.output,
      grade,
      memory: {
        schemaVersion: 1,
        comparisonId: input.comparisonId,
        trialId: input.trialId,
        adapterId: components.memory.adapterId,
        adapterVersion: components.memory.adapterVersion,
        seededRecordIds,
        stateRecovered: memoryRead.stateRecovered ?? false,
        stateRevision: memoryConsolidated.stateRevision,
        queryTerms: memoryRead.queryTerms,
        candidates: memoryRead.candidates,
        retrievedRecordIds: memoryRead.retrievedRecordIds,
        omittedRecordIds: memoryRead.omittedRecordIds,
        writtenRecordIds: memoryWrite.writtenRecordIds,
        updatedRecordIds: memoryWrite.updatedRecordIds,
        discardedRecordIds: memoryWrite.discardedRecordIds,
        expiredRecordIds: [...new Set([...memoryWrite.expiredRecordIds, ...memoryConsolidated.expiredRecordIds])],
        decisions: [...memoryWrite.decisions, ...memoryConsolidated.decisions],
        activeRecordIds: memoryConsolidated.activeRecordIds,
        scopes: memoryConsolidated.scopes,
      },
      composition,
    };
  }

  static createDefault(dependencies: {
    readonly environment?: StudioEnvironmentAssembler;
    readonly model: StudioModelAdapter;
    readonly memory?: StudioMemoryStore;
    readonly components?: StudioHarnessComponentFactory;
    readonly now?: () => string;
  }): StudioHarnessRuntime {
    return new StudioHarnessRuntime(dependencies);
  }
}

export class StudioHarnessCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioHarnessCompositionError";
  }
}

export function assertStudioHarnessComponents(value: unknown): asserts value is StudioHarnessComponents {
  if (value === null || typeof value !== "object") {
    throw new StudioHarnessCompositionError("Studio harness composition must be an object.");
  }
  const record = value as Record<string, unknown>;
  const required = [
    "input",
    "memory",
    "context",
    "planner",
    "tools",
    "computerUse",
    "control",
    "environment",
    "output",
    "safety",
    "model",
    "observability",
  ];
  for (const key of required) {
    const adapter = record[key];
    if (adapter === null || typeof adapter !== "object") {
      throw new StudioHarnessCompositionError(`Studio harness slot is missing: ${key}.`);
    }
  }
  const adapters = required
    .filter((key) => key !== "model" && key !== "context")
    .map((key) => (record[key] as { readonly adapterId?: unknown }).adapterId);
  if (adapters.some((adapterId) => typeof adapterId !== "string" || adapterId.length === 0)) {
    throw new StudioHarnessCompositionError("Every Studio harness slot must declare an adapter ID.");
  }
  const model = record.model as { readonly provider?: unknown; readonly model?: unknown };
  if (typeof model.provider !== "string" || typeof model.model !== "string" || model.model.length === 0) {
    throw new StudioHarnessCompositionError("The Studio model slot must declare a provider and model.");
  }
  const context = record.context as { readonly id?: unknown; readonly version?: unknown };
  if (typeof context.id !== "string" || typeof context.version !== "string") {
    throw new StudioHarnessCompositionError("The Studio context slot must declare a strategy ID and version.");
  }
}

function compositionEvidence(input: HarnessTurnInput, components: StudioHarnessComponents) {
  return {
    schemaVersion: 1 as const,
    comparisonId: input.comparisonId,
    trialId: input.trialId,
    slots: [
      { component: "input-perception" as const, adapterId: components.input.adapterId, adapterVersion: components.input.adapterVersion, status: "active" as const },
      { component: "context-management" as const, adapterId: components.context.id, adapterVersion: components.context.version, status: "active" as const },
      { component: "planning-reasoning" as const, adapterId: components.planner.adapterId, adapterVersion: components.planner.adapterVersion, status: "active" as const },
      { component: "memory" as const, adapterId: components.memory.adapterId, adapterVersion: components.memory.adapterVersion, status: "active" as const },
      { component: "tool-use" as const, adapterId: components.tools.adapterId, adapterVersion: components.tools.adapterVersion, status: "active" as const },
      { component: "computer-use" as const, adapterId: components.computerUse.adapterId, adapterVersion: components.computerUse.adapterVersion, status: "unavailable" as const },
      { component: "control-orchestration" as const, adapterId: components.control.adapterId, adapterVersion: components.control.adapterVersion, status: "active" as const },
      { component: "execution-environment" as const, adapterId: components.environment.adapterId, adapterVersion: components.environment.adapterVersion, status: "active" as const },
      { component: "output-actions" as const, adapterId: components.output.adapterId, adapterVersion: components.output.adapterVersion, status: "active" as const },
      { component: "safety-guardrails" as const, adapterId: components.safety.adapterId, adapterVersion: components.safety.adapterVersion, status: "active" as const },
      { component: "model-interface" as const, adapterId: components.model.provider, adapterVersion: components.model.adapterVersion ?? "1", status: "active" as const },
      { component: "observability" as const, adapterId: components.observability.adapterId, adapterVersion: components.observability.adapterVersion, status: "active" as const },
    ],
  };
}

function gradeContext(
  scenario: StudioScenarioCase,
  retainedMessageIds: readonly string[],
  retrievedMemoryRecordIds: readonly string[],
  modelBoundMemoryRecordIds: readonly string[],
  output: string,
) {
  if (scenario.requiredMemoryRecordId) {
    const retrieved = retrievedMemoryRecordIds.includes(scenario.requiredMemoryRecordId);
    const modelBound = modelBoundMemoryRecordIds.length === 0 || modelBoundMemoryRecordIds.includes(scenario.requiredMemoryRecordId);
    const outputPresent = output.trim().length > 0;
    return {
      graderId: "memory-source-presence-v1",
      status: retrieved && modelBound && outputPresent ? "pass" as const : "fail" as const,
      reason: !retrieved
        ? "The required Memory record was not retrieved."
        : !modelBound
          ? "The required Memory record was retrieved but Context did not serialize it for the model."
          : "The required Memory record was retrieved, serialized, and the model returned output.",
      requiredSourceId: scenario.requiredMemoryRecordId,
    };
  }
  const retained = retainedMessageIds.includes(scenario.requiredMessageId);
  const outputPresent = output.trim().length > 0;
  return {
    graderId: "context-source-presence-v1",
    status: retained && outputPresent ? "pass" as const : "fail" as const,
    reason: retained
      ? "The required source reached the model context and the model returned output."
      : "The required source did not reach the model context.",
    requiredSourceId: scenario.requiredMessageId,
  };
}

function emptyMemoryWrite(memoryRead: Awaited<ReturnType<StudioMemoryStore["read"]>>) {
  return {
    stateRevision: memoryRead.stateRevision,
    decisions: [],
    writtenRecordIds: [],
    updatedRecordIds: [],
    discardedRecordIds: [],
    expiredRecordIds: [],
    activeRecordIds: memoryRead.records.filter((record) => record.state === "active").map((record) => record.recordId),
    scopes: [...new Set(memoryRead.records.map((record) => record.scope))],
  };
}

function emptyMemoryConsolidation(memoryRead: Awaited<ReturnType<StudioMemoryStore["read"]>>) {
  return {
    stateRevision: memoryRead.stateRevision,
    decisions: [],
    expiredRecordIds: [],
    activeRecordIds: memoryRead.records.filter((record) => record.state === "active").map((record) => record.recordId),
    scopes: [...new Set(memoryRead.records.map((record) => record.scope))],
  };
}

async function emitMemoryCancellation(
  input: HarnessTurnInput,
  components: StudioHarnessComponents,
  error: unknown,
): Promise<void> {
  if (!(error instanceof StudioMemoryCancellationError)) return;
  await input.events.emit("MemoryPersistenceCancelled", {
    trialId: input.trialId,
    adapterId: components.memory.adapterId,
    adapterVersion: components.memory.adapterVersion,
    phase: error.phase,
    persisted: error.persisted,
    persistenceOutcome: error.persistenceOutcome,
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error(typeof signal.reason === "string" ? signal.reason : "The Studio turn was cancelled.");
  error.name = "AbortError";
  throw error;
}

function isContextOverflowError(error: unknown): boolean {
  if (error instanceof StudioContextOverflowError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { readonly code?: unknown; readonly details?: { readonly code?: unknown } };
  const code = typeof candidate.code === "string"
    ? candidate.code
    : typeof candidate.details?.code === "string" ? candidate.details.code : "";
  return /CONTEXT|TOKEN_LIMIT|REQUEST_TOO_LARGE|INPUT_TOO_LARGE/i.test(code);
}
