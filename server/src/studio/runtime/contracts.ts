import type { ContextBudget, ContextMessage, ContextTokenCounter } from "../../capabilities/context/contracts.js";
import type { StudioEnvironmentAssembler } from "./environment.js";
import type { ContextAssemblyResult, ContextStrategy } from "../strategies/context-strategy.js";
import type {
  StudioComparisonManifest,
  StudioComponentId,
  StudioCompositionEvidence,
  StudioGrade,
  StudioMemoryEvidence,
  StudioScenarioCase,
  StudioStrategyVariant,
} from "../domain/types.js";
import type { StudioModelAdapter, StudioModelResponse } from "../adapters/replay-model.js";
import type { ToolCall, ToolDefinition, ToolValidationResult } from "../../capabilities/tools/contracts.js";

export type StudioRuntimeEventKind =
  | "InputNormalized"
  | "MemoryRead"
  | "ContextAssembled"
  | "PlanProduced"
  | "ControlLoopStarted"
  | "ModelRequested"
  | "ModelCompleted"
  | "ToolDispatchSkipped"
  | "ComputerUseUnavailable"
  | "SafetyChecked"
  | "OutputCollected"
  | "MemoryWritten"
  | "TrialGraded"
  | "TurnCompleted";

export interface StudioRuntimeEventSink {
  emit(kind: StudioRuntimeEventKind, payload: Record<string, unknown>): Promise<void>;
}

export interface StudioNormalizedInput {
  readonly task: string;
  readonly messages: readonly ContextMessage[];
  readonly trustedMessageIds: readonly string[];
  readonly untrustedMessageIds: readonly string[];
}

export interface StudioInputNormalizer {
  readonly adapterId: string;
  readonly adapterVersion: string;
  normalize(input: { readonly task: string; readonly messages: readonly ContextMessage[] }): StudioNormalizedInput;
}

export type StudioMemoryScope = "working" | "episodic" | "semantic" | "procedural";

export interface StudioMemoryRecord {
  readonly recordId: string;
  readonly scope: StudioMemoryScope;
  readonly content: string;
  readonly source: string;
  readonly createdAt: string;
}

export interface StudioMemoryStore {
  readonly adapterId: string;
  readonly adapterVersion: string;
  read(input: { readonly task: string; readonly signal: AbortSignal }): Promise<{
    readonly records: readonly StudioMemoryRecord[];
    readonly retrievedRecordIds: readonly string[];
  }>;
  write(input: { readonly trialId: string; readonly output: string; readonly signal: AbortSignal }): Promise<{
    readonly writtenRecordIds: readonly string[];
  }>;
}

export interface StudioPlanner {
  readonly adapterId: string;
  readonly adapterVersion: string;
  plan(input: { readonly task: string; readonly context: readonly ContextMessage[] }): {
    readonly intent: "respond";
    readonly reason: string;
  };
}

export interface StudioToolUseAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  inspectModelResponse(response: StudioModelResponse): {
    readonly status: "not-requested" | "unsupported";
    readonly toolCallCount: number;
  };
  definitions(): readonly ToolDefinition[];
  validate(call: ToolCall): ToolValidationResult;
}

export interface StudioComputerUseAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  inspectModelResponse(response: StudioModelResponse): {
    readonly status: "unavailable" | "not-requested";
    readonly reason: string;
  };
}

export interface StudioControlLoop {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly maxTurns: number;
  run(input: { readonly signal: AbortSignal; readonly act: () => Promise<StudioModelResponse> }): Promise<StudioModelResponse>;
}

export interface StudioExecutionEnvironmentAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly network: "disabled" | "enabled";
  readonly filesystem: "fixture-only" | "workspace";
  readonly sideEffects: "disabled" | "contained" | "enabled";
}

export interface StudioOutputAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
  collect(response: StudioModelResponse): { readonly output: string; readonly sideEffect: "none" | "classified" };
}

export interface StudioSafetyGate {
  readonly adapterId: string;
  readonly adapterVersion: string;
  check(input: { readonly output: string; readonly trustedMessageIds: readonly string[] }): {
    readonly allowed: boolean;
    readonly reason: string;
  };
}

export interface StudioObservabilityAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;
}

export interface StudioHarnessComponents {
  readonly input: StudioInputNormalizer;
  readonly memory: StudioMemoryStore;
  readonly context: ContextStrategy;
  readonly planner: StudioPlanner;
  readonly tools: StudioToolUseAdapter;
  readonly computerUse: StudioComputerUseAdapter;
  readonly control: StudioControlLoop;
  readonly environment: StudioExecutionEnvironmentAdapter;
  readonly output: StudioOutputAdapter;
  readonly safety: StudioSafetyGate;
  readonly model: StudioModelAdapter;
  readonly observability: StudioObservabilityAdapter;
}

export interface StudioHarnessComponentFactoryInput {
  readonly comparisonId: string;
  readonly trialId: string;
  readonly manifest: StudioComparisonManifest;
  readonly scenario: StudioScenarioCase;
  readonly context: ContextStrategy;
  readonly model: StudioModelAdapter;
  readonly now: () => string;
}

export type StudioHarnessComponentFactory = (
  input: StudioHarnessComponentFactoryInput,
) => StudioHarnessComponents;

export interface HarnessTurnInput {
  readonly comparisonId: string;
  readonly trialId: string;
  readonly manifest: StudioComparisonManifest;
  readonly scenario: StudioScenarioCase;
  readonly strategy: StudioStrategyVariant;
  readonly context: ContextStrategy;
  readonly tokenCounter: ContextTokenCounter;
  readonly signal: AbortSignal;
  readonly events: StudioRuntimeEventSink;
}

export interface HarnessTurnResult {
  readonly context: ContextAssemblyResult;
  readonly contextBudget: ContextBudget;
  readonly model: StudioModelResponse;
  readonly output: string;
  readonly grade: StudioGrade;
  readonly memory: StudioMemoryEvidence;
  readonly composition: StudioCompositionEvidence;
}

export interface StudioHarnessRuntimeDependencies {
  readonly environment?: StudioEnvironmentAssembler;
  readonly model: StudioModelAdapter;
  readonly components?: StudioHarnessComponentFactory;
  readonly now?: () => string;
}

export type StudioRuntimeSlot = Exclude<StudioComponentId, never>;
