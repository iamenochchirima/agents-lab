import type { CharacterTokenEstimator } from "../../capabilities/context/token-counter.js";
import type { StudioScenarioCase } from "../domain/types.js";
import type { StudioModelAdapter } from "../adapters/replay-model.js";
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
    await input.events.emit("MemoryRead", {
      trialId: input.trialId,
      adapterId: components.memory.adapterId,
      adapterVersion: components.memory.adapterVersion,
      retrievedRecordIds: memoryRead.retrievedRecordIds,
    });

    const memoryMessages = memoryRecordsAsMessages(memoryRead.records, `studio-${input.scenario.id}`, this.now());
    const context = components.context.assemble({
      trialId: input.trialId,
      task: normalized.task,
      messages: [...normalized.messages, ...memoryMessages],
      contextWindowTokens: environment.contextWindowTokens,
      budgetPolicy: environment.budgetPolicy,
      tokenCounter: input.tokenCounter,
      strategy: input.strategy,
    });
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

    const response = await components.control.run({
      signal: input.signal,
      act: async () => {
        throwIfAborted(input.signal);
        await input.events.emit("ModelRequested", {
          trialId: input.trialId,
          provider: components.model.provider,
          model: components.model.model,
          messageIds: context.messages.map((message) => message.messageId),
        });
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
    const memoryWrite = await components.memory.write({
      trialId: input.trialId,
      task: normalized.task,
      turnId: input.trialId,
      output: output.output,
      now: this.now(),
      signal: input.signal,
    });
    await input.events.emit("MemoryWritten", {
      trialId: input.trialId,
      adapterId: components.memory.adapterId,
      adapterVersion: components.memory.adapterVersion,
      writtenRecordIds: memoryWrite.writtenRecordIds,
    });
    const memoryConsolidated = await components.memory.consolidate({ now: this.now(), signal: input.signal });
    await input.events.emit("MemoryConsolidated", {
      trialId: input.trialId,
      adapterId: components.memory.adapterId,
      adapterVersion: components.memory.adapterVersion,
      expiredRecordIds: memoryConsolidated.expiredRecordIds,
      stateRevision: memoryConsolidated.stateRevision,
    });

    const grade = gradeContext(input.scenario, context.retainedMessageIds, memoryRead.retrievedRecordIds, output.output);
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
      output: output.output,
      grade,
      memory: {
        schemaVersion: 1,
        comparisonId: input.comparisonId,
        trialId: input.trialId,
        adapterId: components.memory.adapterId,
        adapterVersion: components.memory.adapterVersion,
        seededRecordIds,
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
  output: string,
) {
  if (scenario.requiredMemoryRecordId) {
    const retrieved = retrievedMemoryRecordIds.includes(scenario.requiredMemoryRecordId);
    const outputPresent = output.trim().length > 0;
    return {
      graderId: "memory-source-presence-v1",
      status: retrieved && outputPresent ? "pass" as const : "fail" as const,
      reason: retrieved
        ? "The required Memory record was retrieved and the model returned output."
        : "The required Memory record was not retrieved.",
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

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error(typeof signal.reason === "string" ? signal.reason : "The Studio turn was cancelled.");
  error.name = "AbortError";
  throw error;
}
