import type { ToolCall, ToolDefinition, ToolExecutionResult } from "../../../../capabilities/tools/contracts.js";

export const BASELINE_WORKFLOW_TYPE = "temporalBaselineWorkflow";
export const BASELINE_QUERY_NAME = "baselineSnapshot";
export const BASELINE_CANCEL_SIGNAL = "baselineCancel";

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
  readonly tools?: {
    readonly enabledNames: readonly string[];
    readonly maxRounds: number;
    readonly maxCalls: number;
  };
  readonly context?: {
    readonly rootDirectory: string;
    readonly sessionId: string;
    readonly turnId: string;
  };
}

export interface TemporalContextPreparationInput {
  readonly rootDirectory: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly provider: TemporalModelProvider;
  readonly model: string;
  readonly forceCompaction?: boolean;
  readonly trigger?: "preflight" | "provider_overflow";
}

export interface TemporalContextPreparationResult {
  readonly snapshotId: string;
  readonly sessionRevision: number;
  readonly compactionRevision: number;
  readonly inputTokens: number | null;
  readonly remainingTokens: number | null;
  readonly remainingPercent: number | null;
  readonly pressure: string;
  readonly quality: string;
  readonly compacted: boolean;
  readonly compaction: {
    readonly compactionId: string;
    readonly trigger: "preflight" | "provider_overflow" | "manual";
    readonly sourceMessageCount: number;
    readonly retainedMessageCount: number;
    readonly beforeInputTokens: number | null;
    readonly afterInputTokens: number | null;
  } | null;
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
  readonly messages?: readonly TemporalModelMessage[];
  readonly continuationMessages?: readonly TemporalModelMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly context?: {
    readonly rootDirectory: string;
    readonly sessionId: string;
    readonly snapshotId: string;
  };
}

export interface TemporalAssistantMessage {
  readonly role: "assistant";
  readonly content: string | null;
  readonly toolCalls?: readonly TemporalModelToolCall[];
}

export interface TemporalToolMessage {
  readonly role: "tool";
  readonly toolCallId: string;
  readonly name: string;
  readonly content: string;
}

export type TemporalModelMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | TemporalAssistantMessage
  | TemporalToolMessage;

export interface TemporalModelToolCall {
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: unknown;
}

export interface TemporalToolExecutionInput {
  readonly runId: string;
  readonly turnId: string;
  readonly enabledNames: readonly string[];
  readonly call: ToolCall;
}

export type TemporalToolExecutionResult = ToolExecutionResult;

export interface ModelSuccess {
  readonly kind: "success";
  readonly output: string | null;
  readonly toolCalls?: readonly TemporalModelToolCall[];
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
