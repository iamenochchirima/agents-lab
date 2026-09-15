import type { RunError, RunEventIntent, RunMetrics, RunTrajectory, RunUsage } from "../../../../control-plane/domain/types.js";

import { loadDbosSdk } from "../../sdk.js";
import {
  DBOS_WORKFLOW_SOURCE,
  type DbosModelFailure,
  type DbosModelRequest,
  type DbosModelResult,
  type DbosWorkflowInput,
  type DbosWorkflowResult,
} from "./contracts.js";
import { completeFakeModel, PreDispatchRetryError } from "./models/fake.js";
import { completeOpenRouterModel } from "./models/openrouter.js";

const dbos = loadDbosSdk();

/**
 * The only non-deterministic work in this workflow is inside DBOS steps.
 * Workflow-local arrays are rebuilt during replay from the same input and
 * checkpointed step results; provider calls never happen in the workflow body.
 */
export const dbosBaselineWorkflow = dbos.DBOS.registerWorkflow(
  async (input: DbosWorkflowInput): Promise<DbosWorkflowResult> => {
    const events: RunEventIntent[] = [];
    const phases: Array<RunTrajectory["phases"][number]> = [];
    const executionPhase = { name: "dbos_workflow", startedAt: input.startedAt, finishedAt: null as string | null };
    const modelPhase = { name: "model_request_step", startedAt: input.startedAt, finishedAt: null as string | null };
    phases.push(executionPhase, modelPhase);

    let sourceSequence = 0;
    const record = (kind: string, occurredAt: string, payload: Record<string, unknown> = {}): void => {
      sourceSequence += 1;
      events.push({
        source: DBOS_WORKFLOW_SOURCE,
        sourceSequence,
        kind,
        runId: input.runId,
        occurredAt,
        payload,
      });
    };

    record("AgentStarted", input.startedAt, {
      workflowId: dbos.DBOS.workflowID ?? null,
      workflowName: "AgentLabDbosBaseline",
    });
    record("ModelRequested", input.startedAt, {
      provider: input.model.provider,
      model: input.model.model,
      step: "model.request",
    });

    let modelResult: DbosModelResult;
    try {
      modelResult = await dbos.DBOS.runStep(
        async (): Promise<DbosModelResult> => {
          const request: DbosModelRequest = {
            runId: input.runId,
            prompt: input.prompt,
            systemInstruction: input.systemInstruction,
            provider: input.model.provider,
            model: input.model.model,
            attempt: dbos.DBOS.stepStatus?.currentAttempt ?? 1,
          };
          if (request.provider === "fake") return completeFakeModel(request);

          const apiKey = process.env.OPENROUTER_API_KEY?.trim();
          if (!apiKey) {
            return {
              kind: "failure",
              code: "OPENROUTER_NOT_CONFIGURED",
              message: "OPENROUTER_API_KEY is not configured in the DBOS service process.",
              failureKind: "configuration",
              retryable: false,
              requestSent: false,
              attemptCount: request.attempt,
            };
          }
          return completeOpenRouterModel(
            request,
            apiKey,
            process.env.AGENTLAB_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
          );
        },
        {
          name: "model.request",
          timeoutMS: input.modelStepTimeoutMs,
          retriesAllowed: true,
          maxAttempts: input.modelStepMaxAttempts,
          intervalSeconds: 0.05,
          backoffRate: 2,
          shouldRetry: (error: unknown) => error instanceof PreDispatchRetryError,
        },
      );
      modelPhase.finishedAt = await durableNow();
    } catch (error) {
      // A DBOS cancellation must escape the workflow. DBOS then records the
      // native CANCELLED state instead of converting cancellation into success.
      if (isWorkflowCancellation(error)) throw error;

      const finishedAt = await durableNow();
      modelPhase.finishedAt = finishedAt;
      executionPhase.finishedAt = finishedAt;
      const failure = failureFromWorkflowError(error);
      record("ModelFailed", finishedAt, { code: failure.code, failureKind: failure.failureKind });
      record("AgentFailed", finishedAt, { code: failure.code, failureKind: failure.failureKind });
      record("RunFailed", finishedAt, { code: failure.code, failureKind: failure.failureKind });
      return terminalResult(input, "failed", finishedAt, null, failure, failureAttemptCount(error), emptyUsage(), events, phases);
    }

    const finishedAt = await durableNow();
    modelPhase.finishedAt = finishedAt;
    executionPhase.finishedAt = finishedAt;

    if (modelResult.kind === "success") {
      record("ModelCompleted", finishedAt, {
        provider: input.model.provider,
        model: input.model.model,
        providerRequestId: modelResult.providerRequestId,
        attempt: modelResult.attemptCount,
      });
      record("AgentCompleted", finishedAt, { attempt: modelResult.attemptCount });
      record("RunCompleted", finishedAt, { attempt: modelResult.attemptCount });
      return terminalResult(
        input,
        "completed",
        finishedAt,
        modelResult.output,
        null,
        modelResult.attemptCount,
        modelResult.usage,
        events,
        phases,
      );
    }

    record("ModelFailed", finishedAt, {
      code: modelResult.code,
      failureKind: modelResult.failureKind,
      requestSent: modelResult.requestSent,
    });
    record("AgentFailed", finishedAt, { code: modelResult.code, failureKind: modelResult.failureKind });
    record("RunFailed", finishedAt, { code: modelResult.code, failureKind: modelResult.failureKind });
    return terminalResult(
      input,
      "failed",
      finishedAt,
      null,
      toRunError(modelResult),
      modelResult.attemptCount,
      emptyUsage(),
      events,
      phases,
    );
  },
  { name: "AgentLabDbosBaseline", maxRecoveryAttempts: 3 },
);

async function durableNow(): Promise<string> {
  return dbos.DBOS.runStep(() => Promise.resolve(new Date().toISOString()), { name: "run.timestamp" });
}

function terminalResult(
  input: DbosWorkflowInput,
  status: "completed" | "failed",
  finishedAt: string,
  output: string | null,
  error: RunError | null,
  attemptCount: number,
  usage: RunUsage,
  eventIntents: readonly RunEventIntent[],
  phases: readonly RunTrajectory["phases"][number][],
): DbosWorkflowResult {
  const trajectory: RunTrajectory = { schemaVersion: 1, runId: input.runId, phases: phases.map((phase) => ({ ...phase })) };
  const metrics: RunMetrics = {
    schemaVersion: 1,
    runId: input.runId,
    status,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(input.startedAt)),
    modelCallCount: eventIntents.filter((event) => event.kind === "ModelRequested").length,
    modelAttemptCount: attemptCount,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: null,
  };
  return {
    schemaVersion: 1,
    runId: input.runId,
    status,
    startedAt: input.startedAt,
    finishedAt,
    output,
    error,
    attemptCount,
    usage,
    eventIntents: [...eventIntents],
    trajectory,
    metrics,
  };
}

function toRunError(failure: DbosModelFailure): RunError {
  return {
    code: failure.code,
    message: failure.message,
    failureKind: failure.failureKind,
    retryable: failure.retryable,
  };
}

function failureFromWorkflowError(error: unknown): RunError {
  if (error instanceof PreDispatchRetryError) {
    return {
      code: "MODEL_PRE_DISPATCH_RETRIES_EXHAUSTED",
      message: "The model step exhausted its bounded pre-dispatch retry policy.",
      failureKind: "pre_dispatch",
      retryable: true,
    };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "MODEL_STEP_TIMEOUT",
      message: "The DBOS model step exceeded its configured timeout.",
      failureKind: "timeout",
      retryable: false,
    };
  }
  if (error instanceof Error && error.name === "DBOSMaxStepRetriesError") {
    return {
      code: "MODEL_STEP_RETRIES_EXHAUSTED",
      message: "The DBOS model step exhausted its retry policy.",
      failureKind: "pre_dispatch",
      retryable: true,
    };
  }
  return {
    code: "DBOS_WORKFLOW_ERROR",
    message: "The DBOS workflow failed before producing a model result.",
    failureKind: "internal",
    retryable: false,
  };
}

function failureAttemptCount(error: unknown): number {
  if (error instanceof Error && error.name === "DBOSMaxStepRetriesError") return 2;
  return 1;
}

function emptyUsage(): RunUsage {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

function isWorkflowCancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === "DBOSWorkflowCancelledError" || error.message.includes("has been cancelled"));
}
