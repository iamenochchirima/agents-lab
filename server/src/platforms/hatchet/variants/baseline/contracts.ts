import type {
  ModelProvider,
  RunError,
  RunEventIntent,
  RunMetrics,
  RunResult,
  RunTrajectory,
  RunUsage,
} from "../../../../control-plane/domain/types.js";

export const HATCHET_TASK_OUTPUT_SCHEMA_VERSION = 1 as const;

export interface HatchetPromptInput extends Record<string, any> {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly model: {
    readonly provider: ModelProvider;
    readonly model: string;
  };
}

export interface HatchetModelRequestInput {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly provider: ModelProvider;
  readonly model: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
}

export interface HatchetModelSuccess {
  readonly kind: "success";
  readonly output: string;
  readonly providerRequestId: string | null;
  readonly usage: RunUsage;
}

export type HatchetModelFailureKind =
  "configuration" | "pre_dispatch" | "provider" | "outcome_unknown";

export interface HatchetModelFailure {
  readonly kind: "failure";
  readonly failureKind: HatchetModelFailureKind;
  readonly code: string;
  readonly message: string;
  readonly requestSent: boolean;
}

export type HatchetModelCallResult = HatchetModelSuccess | HatchetModelFailure;

export interface HatchetModelAdapter {
  complete(
    input: HatchetModelRequestInput,
    signal: AbortSignal,
  ): Promise<HatchetModelCallResult>;
}

export interface HatchetTaskOutput extends Record<string, any> {
  readonly schemaVersion: typeof HATCHET_TASK_OUTPUT_SCHEMA_VERSION;
  readonly runId: string;
  readonly result: RunResult;
  readonly trajectory: RunTrajectory;
  readonly metrics: RunMetrics;
  readonly eventIntents: readonly RunEventIntent[];
}

export interface HatchetNativeEvent {
  readonly id: number;
  readonly timestamp: string;
  readonly eventType: string;
  readonly workerId: string | null;
  readonly retryCount: number | null;
  readonly attempt: number | null;
}

export interface HatchetNativeTaskSummary {
  readonly taskExternalId: string;
  readonly status: string;
  readonly workerId: string | null;
  readonly retryCount: number | null;
  readonly attempt: number | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface HatchetRunDetails {
  readonly run: {
    readonly status: string;
    readonly startedAt?: string;
    readonly finishedAt?: string;
    readonly output?: unknown;
    readonly errorMessage?: string;
    readonly additionalMetadata?: unknown;
    readonly workflowId?: string;
    readonly workflowVersionId?: string;
    readonly displayName?: string;
  };
  readonly taskEvents: readonly {
    readonly id: number;
    readonly timestamp: string;
    readonly eventType: string;
    readonly workerId?: string;
    readonly retryCount?: number;
    readonly attempt?: number;
  }[];
  readonly tasks: readonly {
    readonly taskExternalId: string;
    readonly status: string;
    readonly retryCount?: number;
    readonly attempt?: number;
    readonly startedAt?: string;
    readonly finishedAt?: string;
    readonly output?: unknown;
    readonly errorMessage?: string;
    readonly additionalMetadata?: unknown;
  }[];
}

export function isHatchetTaskOutput(
  value: unknown,
): value is HatchetTaskOutput {
  if (
    !isRecord(value) ||
    value.schemaVersion !== HATCHET_TASK_OUTPUT_SCHEMA_VERSION ||
    typeof value.runId !== "string"
  )
    return false;
  return (
    isRunResult(value.result) &&
    isTrajectory(value.trajectory) &&
    isMetrics(value.metrics) &&
    Array.isArray(value.eventIntents)
  );
}

function isRunResult(value: unknown): value is RunResult {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.runId === "string" &&
    typeof value.status === "string" &&
    typeof value.finishedAt === "string"
  );
}

function isTrajectory(value: unknown): value is RunTrajectory {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.runId === "string" &&
    Array.isArray(value.phases)
  );
}

function isMetrics(value: unknown): value is RunMetrics {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.runId === "string" &&
    typeof value.status === "string"
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object";
}

export type { RunError };
