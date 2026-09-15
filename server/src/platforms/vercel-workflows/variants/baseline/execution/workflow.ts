import { sleep } from "workflow";

import { VERCEL_WORKFLOW_NAME } from "../../../config.js";
import type {
  VercelWorkflowInput,
  VercelWorkflowResult,
  VercelWorkflowStepResult,
} from "../contracts.js";
import { VERCEL_WORKFLOW_SOURCE } from "../contracts.js";
import { executeModelStep } from "./model-step.js";

/**
 * The durable orchestration boundary. It contains only deterministic branching
 * and durable SDK operations; provider I/O remains in `executeModelStep`.
 */
export async function agentLabPromptWorkflow(input: VercelWorkflowInput): Promise<VercelWorkflowResult> {
  "use workflow";

  if (input.model.model === "fake-wait") await sleep(1_000);
  const step = await executeModelStep(input) as VercelWorkflowStepResult;
  const durationMs = Math.max(0, Date.parse(step.finishedAt) - Date.parse(step.startedAt));
  const result: VercelWorkflowResult = {
    schemaVersion: 1,
    runId: input.runId,
    status: "completed",
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    output: step.output,
    error: null,
    attemptCount: step.attempt,
    usage: step.usage,
    eventIntents: [
      {
        source: VERCEL_WORKFLOW_SOURCE,
        sourceSequence: 1,
        kind: "model_call_completed",
        runId: input.runId,
        occurredAt: step.finishedAt,
        payload: {
          provider: input.model.provider,
          model: input.model.model,
          attempt: step.attempt,
          stepId: step.stepId,
          requestId: step.providerRequestId,
        },
      },
      {
        source: VERCEL_WORKFLOW_SOURCE,
        sourceSequence: 2,
        kind: "workflow_completed",
        runId: input.runId,
        occurredAt: step.finishedAt,
        payload: { workflowName: VERCEL_WORKFLOW_NAME },
      },
    ],
    trajectory: {
      schemaVersion: 1,
      runId: input.runId,
      phases: [
        { name: "model", startedAt: step.startedAt, finishedAt: step.finishedAt },
      ],
    },
    metrics: {
      schemaVersion: 1,
      runId: input.runId,
      status: "completed",
      durationMs,
      modelCallCount: 1,
      modelAttemptCount: step.attempt,
      inputTokens: step.usage.inputTokens,
      outputTokens: step.usage.outputTokens,
      totalTokens: step.usage.totalTokens,
      costUsd: null,
    },
    native: {
      workflowName: VERCEL_WORKFLOW_NAME,
      stepNames: [step.stepName],
    },
  };
  return result;
}
