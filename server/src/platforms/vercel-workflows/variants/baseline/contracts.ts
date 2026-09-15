import type {
  ModelProvider,
  RunError,
  RunEventIntent,
  RunMetrics,
  RunResult,
  RunTrajectory,
  RunUsage,
} from "../../../../control-plane/domain/types.js";

export const VERCEL_WORKFLOW_SOURCE = "vercel-workflow";

export type VercelWorkflowModel = {
  readonly provider: ModelProvider;
  readonly model: string;
};

export interface VercelWorkflowInput {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly model: VercelWorkflowModel;
  readonly modelTimeoutMs: number;
}

export interface VercelWorkflowModelRequest extends VercelWorkflowInput {
  readonly attempt: number;
}

export interface VercelWorkflowModelSuccess {
  readonly kind: "success";
  readonly output: string;
  readonly providerRequestId: string | null;
  readonly usage: RunUsage;
}

export interface VercelWorkflowModelFailure {
  readonly kind: "failure";
  readonly error: RunError;
  readonly requestSent: boolean;
}

export type VercelWorkflowModelResult = VercelWorkflowModelSuccess | VercelWorkflowModelFailure;

export interface VercelWorkflowResult extends RunResult {
  readonly eventIntents: readonly RunEventIntent[];
  readonly trajectory: RunTrajectory;
  readonly metrics: RunMetrics;
  readonly native: {
    readonly workflowName: string;
    readonly stepNames: readonly string[];
  };
}

export interface VercelWorkflowStepResult extends VercelWorkflowModelSuccess {
  readonly attempt: number;
  readonly stepId: string;
  readonly stepName: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export function inputFromManifest(manifest: {
  readonly runId: string;
  readonly task: { readonly prompt: string };
  readonly context: { readonly systemInstruction: string };
  readonly model: VercelWorkflowModel;
  readonly platformConfig: Readonly<Record<string, unknown>>;
}): VercelWorkflowInput {
  return {
    runId: manifest.runId,
    prompt: manifest.task.prompt,
    systemInstruction: manifest.context.systemInstruction,
    model: manifest.model,
    modelTimeoutMs: positiveInteger(manifest.platformConfig.modelTimeoutMs, 30_000),
  };
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
