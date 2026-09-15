import type {
  ModelProvider,
  RunEventIntent,
  RunError,
  RunManifest,
  RunMetrics,
  RunResult,
  RunTrajectory,
  RunUsage,
} from "../../../../control-plane/domain/types.js";

export const DBOS_WORKFLOW_SOURCE = "dbos-workflow";

export interface DbosWorkflowInput {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly model: {
    readonly provider: ModelProvider;
    readonly model: string;
  };
  readonly requestHash: string;
  readonly startedAt: string;
  readonly modelStepTimeoutMs: number;
  readonly modelStepMaxAttempts: number;
}

export interface DbosModelRequest {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly provider: ModelProvider;
  readonly model: string;
  readonly attempt: number;
}

export interface DbosModelSuccess {
  readonly kind: "success";
  readonly output: string;
  readonly providerRequestId: string | null;
  readonly usage: RunUsage;
  readonly attemptCount: number;
}

export interface DbosModelFailure {
  readonly kind: "failure";
  readonly code: string;
  readonly message: string;
  readonly failureKind: RunError["failureKind"];
  readonly retryable: boolean;
  readonly requestSent: boolean;
  readonly attemptCount: number;
}

export type DbosModelResult = DbosModelSuccess | DbosModelFailure;

export interface DbosWorkflowResult extends RunResult {
  readonly eventIntents: readonly RunEventIntent[];
  readonly trajectory: RunTrajectory;
  readonly metrics: RunMetrics;
}

export function workflowInputFromManifest(
  manifest: RunManifest,
  requestHash: string,
  startedAt: string,
  modelStepTimeoutMs: number,
  modelStepMaxAttempts: number,
): DbosWorkflowInput {
  return {
    runId: manifest.runId,
    prompt: manifest.task.prompt,
    systemInstruction: manifest.context.systemInstruction,
    model: manifest.model,
    requestHash,
    startedAt,
    modelStepTimeoutMs,
    modelStepMaxAttempts,
  };
}
