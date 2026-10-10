import { remainingExecutionMs } from "../../../../../capabilities/execution/policy.js";
import { getStepMetadata } from "workflow";

import { loadVercelWorkflowsConfig } from "../../../config.js";
import type {
  VercelWorkflowModelRequest,
  VercelWorkflowStepResult,
} from "../contracts.js";
import { completeFakeModel } from "../models/fake.js";
import { completeOpenRouterModel } from "../models/openrouter.js";

/**
 * The only step that crosses the model/provider boundary. Keeping network I/O
 * here lets the workflow remain deterministic. Classified failures are retained
 * as step results so the workflow preserves their code and dispatch uncertainty.
 */
export async function executeModelStep(input: Omit<VercelWorkflowModelRequest, "attempt">): Promise<VercelWorkflowStepResult> {
  "use step";

  const metadata = getStepMetadata();
  const startedAt = metadata.stepStartedAt.toISOString();
  const remaining = remainingExecutionMs(input.execution, Date.now());
  const request: VercelWorkflowModelRequest = { ...input, attempt: metadata.attempt, modelTimeoutMs: Math.max(1, Math.min(input.modelTimeoutMs, remaining)) };
  if (remaining === 0) return { kind: "failure", requestSent: false, error: { code: "TASK_DEADLINE_EXCEEDED", message: "The retained task deadline was reached before model dispatch.", failureKind: "timeout", retryable: false }, attempt: metadata.attempt, stepId: metadata.stepId, stepName: metadata.stepName, startedAt, finishedAt: new Date().toISOString() };
  const result = input.model.provider === "fake"
    ? completeFakeModel(request)
    : await completeOpenRouterModel(request, (() => {
        const config = loadVercelWorkflowsConfig();
        return { apiKey: config.openRouterApiKey, baseUrl: config.openRouterBaseUrl };
      })());

  return {
    ...result,
    attempt: metadata.attempt,
    stepId: metadata.stepId,
    stepName: metadata.stepName,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

// Workflow's default retries repeat model dispatch. Recovery reuses the retained
// step result; failed or uncertain provider requests require an explicit new run.
executeModelStep.maxRetries = 0;
