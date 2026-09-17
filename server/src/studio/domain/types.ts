import type {
  ContextBudget,
  ContextMessage,
} from "../../capabilities/context/contracts.js";

export const STUDIO_SCHEMA_VERSION = 1 as const;
export const STUDIO_CONTEXT_COMPONENT = "context-management" as const;

export type StudioComponentId =
  | "input-perception"
  | "context-management"
  | "planning-reasoning"
  | "memory"
  | "tool-use"
  | "control-orchestration"
  | "execution-environment"
  | "output-actions"
  | "safety-guardrails"
  | "model-interface"
  | "observability";
export type StudioComponentArea = StudioComponentId;
export type StudioCapabilityStatus = "available" | "planned";
export type StudioComparisonStatus =
  | "created"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "recovery_required";
export type StudioTrialStatus = Exclude<StudioComparisonStatus, "created" | "recovery_required"> | "pending";

export interface StudioSystemDefinition {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly baselineComponents: Readonly<Record<StudioComponentId, string>>;
}

export interface StudioStrategyDescriptor {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly summary: string;
  readonly parameters: readonly {
    readonly id: string;
    readonly description: string;
    readonly defaultValue: string | null;
    readonly options: readonly string[];
  }[];
}

export interface StudioScenarioDescriptor {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly task: string;
  readonly intendedObservation: string;
  readonly controls: readonly string[];
}

export interface StudioExperimentDescriptor {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly hypothesis: string;
  readonly scenario: StudioScenarioDescriptor;
  readonly strategies: readonly StudioStrategyDescriptor[];
}

export interface StudioComponentDescriptor {
  readonly id: StudioComponentId;
  readonly ordinal: number;
  readonly name: string;
  readonly summary: string;
  readonly status: StudioCapabilityStatus;
  readonly strategies: readonly StudioStrategyDescriptor[];
  readonly experiments: readonly StudioExperimentDescriptor[];
}

export interface StudioCatalogProjection {
  readonly schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  readonly system: Pick<StudioSystemDefinition, "id" | "version" | "name" | "baselineComponents">;
  readonly environment: Pick<StudioEnvironmentProfile, "id" | "version" | "name" | "model" | "contextWindowTokens" | "reservedOutputTokens" | "safetyMarginTokens" | "maxStrategies">;
  readonly components: readonly StudioComponentDescriptor[];
}

export interface StudioEnvironmentProfile {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly model: {
    readonly provider: "replay";
    readonly model: string;
  };
  readonly contextWindowTokens: number;
  readonly reservedOutputTokens: number;
  readonly safetyMarginTokens: number;
  readonly maxStrategies: number;
}

export interface StudioStrategyVariant {
  readonly id: string;
  readonly version: string;
  readonly parameters: Readonly<Record<string, string>>;
}

export interface StudioScenarioCase {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly task: string;
  readonly messages: readonly ContextMessage[];
  readonly requiredMessageId: string;
  readonly expectedAnswer: string;
}

export interface StudioExperimentDefinition {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly hypothesis: string;
  readonly changedComponent: StudioComponentArea;
  readonly scenario: {
    readonly id: string;
    readonly version: string;
  };
  readonly strategies: readonly StudioStrategyVariant[];
}

export interface StudioComparisonRequest {
  readonly system: { readonly id: string; readonly version: string };
  readonly environment: { readonly id: string; readonly version: string };
  readonly experiment: {
    readonly id: string;
    readonly version: string;
    readonly scenario: { readonly id: string; readonly version: string };
    readonly subject: {
      readonly component: StudioComponentArea;
      readonly strategies: readonly StudioStrategyVariant[];
    };
  };
  readonly seed: string;
  readonly idempotencyKey: string;
}

export interface StudioComparisonManifest {
  readonly schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  readonly comparisonId: string;
  readonly createdAt: string;
  readonly seed: string;
  readonly idempotencyKeyHash: string;
  readonly system: StudioSystemDefinition;
  readonly environment: StudioEnvironmentProfile;
  readonly experiment: StudioExperimentDefinition;
  readonly fixedEnvelope: {
    readonly scenarioId: string;
    readonly scenarioVersion: string;
    readonly modelProvider: "replay";
    readonly model: string;
    readonly contextWindowTokens: number;
    readonly reservedOutputTokens: number;
    readonly safetyMarginTokens: number;
  };
}

export interface StudioTrialManifest {
  readonly schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  readonly trialId: string;
  readonly comparisonId: string;
  readonly ordinal: number;
  readonly strategy: StudioStrategyVariant;
  readonly fixedControlFingerprint: string;
}

export interface StudioContextEvidence {
  readonly schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  readonly comparisonId: string;
  readonly trialId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly strategyParameters: Readonly<Record<string, string>>;
  readonly task: string;
  readonly retainedMessageIds: readonly string[];
  readonly omittedMessageIds: readonly string[];
  readonly summarizedMessageIds: readonly string[];
  readonly messages: readonly ContextMessage[];
  readonly budget: ContextBudget;
  readonly decision: "within-budget" | "over-budget" | "unknown-budget";
}

export interface StudioTrialResult {
  readonly schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  readonly trialId: string;
  readonly comparisonId: string;
  readonly status: Exclude<StudioTrialStatus, "pending">;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly output: string | null;
  readonly error: StudioRunError | null;
}

export interface StudioRunError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface StudioEventIntent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  readonly source: string;
  readonly sourceSequence: number;
  readonly kind: string;
  readonly occurredAt: string;
  readonly payload: TPayload;
}

export interface StudioEvent<TPayload extends Record<string, unknown> = Record<string, unknown>>
  extends StudioEventIntent<TPayload> {
  readonly schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  readonly eventId: string;
  readonly recordedSequence: number;
  readonly comparisonId: string;
}

export interface StudioComparisonResult {
  readonly schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  readonly comparisonId: string;
  readonly status: Exclude<StudioComparisonStatus, "created" | "running">;
  readonly finishedAt: string;
  readonly trialIds: readonly string[];
  readonly completedTrialCount: number;
  readonly error: StudioRunError | null;
}

export interface StudioMetrics {
  readonly schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  readonly comparisonId: string;
  readonly status: StudioComparisonStatus;
  readonly durationMs: number | null;
  readonly trialCount: number;
  readonly completedTrialCount: number;
  readonly modelCallCount: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly costUsd: number | null;
}

export interface StudioTrajectory {
  readonly schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  readonly comparisonId: string;
  readonly phases: readonly {
    readonly name: string;
    readonly startedAt: string;
    readonly finishedAt: string | null;
  }[];
}

export interface StudioTrialSnapshot {
  readonly manifest: StudioTrialManifest;
  readonly context: StudioContextEvidence | null;
  readonly result: StudioTrialResult | null;
}

export interface StudioComparisonSnapshot {
  readonly manifest: StudioComparisonManifest;
  readonly events: readonly StudioEvent[];
  readonly trials: readonly StudioTrialSnapshot[];
  readonly trajectory: StudioTrajectory | null;
  readonly metrics: StudioMetrics | null;
  readonly result: StudioComparisonResult | null;
}

export interface StudioComparisonProjection extends StudioComparisonSnapshot {
  readonly status: StudioComparisonStatus;
}
