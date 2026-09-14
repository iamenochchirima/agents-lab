export const BASELINE_WORKFLOW_TYPE = "temporalBaselineWorkflow";
export const BASELINE_QUERY_NAME = "baselineSnapshot";

export type TemporalModelProvider = "fake" | "openrouter";
export type TemporalFailureKind =
  | "configuration"
  | "pre_dispatch"
  | "provider"
  | "timeout"
  | "cancelled"
  | "outcome_unknown"
  | "internal";

export interface TemporalWorkflowInput {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly model: {
    readonly provider: TemporalModelProvider;
    readonly model: string;
  };
  readonly activityTimeoutMs: number;
  readonly preDispatchRetryLimit: number;
  readonly preDispatchRetryBackoffMs: number;
}

export interface TemporalEventIntent {
  readonly source: "temporal-workflow";
  readonly sourceSequence: number;
  readonly kind: string;
  readonly runId: string;
  readonly occurredAt: string;
  readonly payload: Record<string, unknown>;
}

export interface TemporalUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export interface TemporalRunError {
  readonly code: string;
  readonly message: string;
  readonly failureKind: TemporalFailureKind;
  readonly retryable: boolean;
}

export interface TemporalWorkflowSnapshot {
  readonly runId: string;
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled";
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly eventIntents: readonly TemporalEventIntent[];
  readonly output: string | null;
  readonly error: TemporalRunError | null;
  readonly attemptCount: number;
  readonly usage: TemporalUsage;
}

export interface TemporalWorkflowResult extends TemporalWorkflowSnapshot {
  readonly status: "completed" | "failed" | "cancelled";
  readonly trajectory: {
    readonly phases: readonly {
      readonly name: string;
      readonly startedAt: string;
      readonly finishedAt: string | null;
    }[];
  };
}

export interface ModelRequestInput {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly provider: TemporalModelProvider;
  readonly model: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
}

export interface ModelSuccess {
  readonly kind: "success";
  readonly output: string;
  readonly providerRequestId: string | null;
  readonly usage: TemporalUsage;
}

export interface ModelFailure {
  readonly kind: "failure";
  readonly failureKind: Exclude<TemporalFailureKind, "cancelled" | "timeout" | "internal">;
  readonly code: string;
  readonly message: string;
  readonly requestSent: boolean;
}

export type ModelCallResult = ModelSuccess | ModelFailure;

export interface ModelAdapter {
  complete(input: ModelRequestInput, signal: AbortSignal): Promise<ModelCallResult>;
}
