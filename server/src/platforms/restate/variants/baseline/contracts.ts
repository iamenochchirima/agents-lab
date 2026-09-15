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

export const RESTATE_WORKFLOW_NAME = "AgentLabRestateBaseline";
export const RESTATE_WORKFLOW_SOURCE = "restate-workflow";

export interface RestateWorkflowInput {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly model: {
    readonly provider: ModelProvider;
    readonly model: string;
  };
}

export interface RestateWorkflowResult extends RunResult {
  readonly eventIntents: readonly RunEventIntent[];
  readonly trajectory: RunTrajectory;
  readonly metrics: RunMetrics;
}

export interface ModelRequest {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly provider: ModelProvider;
  readonly model: string;
}

export interface ModelSuccess {
  readonly kind: "success";
  readonly output: string;
  readonly providerRequestId: string | null;
  readonly usage: RunUsage;
}

export interface ModelFailure {
  readonly kind: "failure";
  readonly code: string;
  readonly message: string;
  readonly failureKind: RunError["failureKind"];
  readonly retryable: boolean;
  readonly requestSent: boolean;
}

export type ModelCallResult = ModelSuccess | ModelFailure;

export interface ModelAdapter {
  complete(input: ModelRequest, signal: AbortSignal): Promise<ModelCallResult>;
}

export function workflowInputFromManifest(manifest: RunManifest): RestateWorkflowInput {
  return {
    runId: manifest.runId,
    prompt: manifest.task.prompt,
    systemInstruction: manifest.context.systemInstruction,
    model: manifest.model,
  };
}
