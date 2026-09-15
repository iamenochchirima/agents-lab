import { FatalError, getStepMetadata } from "workflow";

import { loadVercelWorkflowsConfig } from "../../../config.js";
import type {
  VercelWorkflowInput,
  VercelWorkflowModelRequest,
  VercelWorkflowStepResult,
} from "../contracts.js";
import { completeFakeModel } from "../models/fake.js";
import { completeOpenRouterModel } from "../models/openrouter.js";

/**
 * The only step that crosses the model/provider boundary. Keeping network I/O
 * here lets the workflow remain deterministic and makes retry duplication
 * visible in the native Workflow event history.
 */
export async function executeModelStep(input: VercelWorkflowInput): Promise<VercelWorkflowStepResult> {
  "use step";

  const metadata = getStepMetadata();
  const startedAt = metadata.stepStartedAt.toISOString();
  const request: VercelWorkflowModelRequest = { ...input, attempt: metadata.attempt };
  const result = input.model.provider === "fake"
    ? completeFakeModel(request)
    : await completeOpenRouterModel(request, (() => {
        const config = loadVercelWorkflowsConfig();
        return { apiKey: config.openRouterApiKey, baseUrl: config.openRouterBaseUrl };
      })());

  if (result.kind === "failure" && !result.error.retryable) {
    throw new FatalError(result.error.message);
  }
  if (result.kind === "failure") throw new Error(result.error.message);
  return {
    ...result,
    attempt: metadata.attempt,
    stepId: metadata.stepId,
    stepName: metadata.stepName,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
