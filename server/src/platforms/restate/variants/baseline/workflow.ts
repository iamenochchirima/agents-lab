import * as restate from "@restatedev/restate-sdk";

import {
  RESTATE_DEFAULT_MAX_ATTEMPTS,
  RESTATE_DEFAULT_RUN_MAX_RETRY_ATTEMPTS,
  RESTATE_DEFAULT_RUN_MAX_RETRY_INTERVAL_MS,
  RESTATE_DEFAULT_RUN_RETRY_INTERVAL_MS,
  RESTATE_DEFAULT_WORKFLOW_RETENTION_MS,
  RESTATE_SERVICE_NAME,
} from "../../config.js";
import type { RunEventIntent, RunError, RunMetrics, RunTrajectory, RunUsage } from "../../../../control-plane/domain/types.js";
import {
  RESTATE_WORKFLOW_SOURCE,
  type ModelCallResult,
  type RestateWorkflowInput,
  type RestateWorkflowResult,
} from "./contracts.js";
import { createRestateModel } from "./models/factory.js";

export const baselineWorkflow = restate.workflow({
  name: RESTATE_SERVICE_NAME,
  handlers: {
    run: async (ctx: restate.WorkflowContext, input: RestateWorkflowInput): Promise<RestateWorkflowResult> => {
      const events: RunEventIntent[] = [];
      const phases: Array<RunTrajectory["phases"][number]> = [];
      const startedAt = await ctx.date.toJSON();
      let sequence = 0;

      const record = async (kind: string, payload: Record<string, unknown> = {}): Promise<void> => {
        sequence += 1;
        events.push({
          source: RESTATE_WORKFLOW_SOURCE,
          sourceSequence: sequence,
          kind,
          runId: input.runId,
          occurredAt: await ctx.date.toJSON(),
          payload,
        });
      };

      const completePhase = async (phase: { readonly name: string; readonly startedAt: string; finishedAt: string | null }): Promise<void> => {
        phase.finishedAt = await ctx.date.toJSON();
      };

      const executionPhase = { name: "agent_execution", startedAt, finishedAt: null as string | null };
      phases.push(executionPhase);
      await record("AgentStarted", { workflowKey: ctx.key, invocationId: String(ctx.request().id) });
      ctx.set("status", { status: "running", runId: input.runId });

      let result: RestateWorkflowResult;
      try {
        const modelPhase = { name: "model_request", startedAt: await ctx.date.toJSON(), finishedAt: null as string | null };
        phases.push(modelPhase);
        await record("ModelRequested", { provider: input.model.provider, model: input.model.model, attempt: 1 });

        const modelResult = await ctx.run(
          "model.request",
          async (): Promise<ModelCallResult> => {
            const model = createRestateModel(input.model.provider, input.model.model, {
              openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || null,
              openRouterBaseUrl: process.env.AGENTLAB_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
            });
            return model.complete(
              {
                runId: input.runId,
                prompt: input.prompt,
                systemInstruction: input.systemInstruction,
                provider: input.model.provider,
                model: input.model.model,
              },
              ctx.request().attemptCompletedSignal,
            );
          },
          {
            maxRetryAttempts: RESTATE_DEFAULT_RUN_MAX_RETRY_ATTEMPTS,
            initialRetryInterval: RESTATE_DEFAULT_RUN_RETRY_INTERVAL_MS,
            maxRetryInterval: RESTATE_DEFAULT_RUN_MAX_RETRY_INTERVAL_MS,
            retryIntervalFactor: 2,
          },
        );
        await completePhase(modelPhase);

        if (modelResult.kind === "success") {
          await record("ModelCompleted", {
            provider: input.model.provider,
            model: input.model.model,
            providerRequestId: modelResult.providerRequestId,
          });
          await record("AgentCompleted", { attempt: 1 });
          await completePhase(executionPhase);
          await record("RunCompleted", { attempt: 1 });
          result = terminalResult(input.runId, "completed", startedAt, modelResult.output, null, 1, modelResult.usage, events, phases);
        } else if (modelResult.retryable && !modelResult.requestSent) {
          // Only pre-dispatch failures are retried here. Retrying after a
          // provider request was sent could duplicate an external model call
          // when the acknowledgement was lost.
          throw new restate.RetryableError(modelResult.message);
        } else {
          const cancelled = modelResult.failureKind === "cancelled";
          await record(cancelled ? "ModelCancelled" : "ModelFailed", {
            code: modelResult.code,
            failureKind: modelResult.failureKind,
            requestSent: modelResult.requestSent,
          });
          await record(cancelled ? "AgentCancelled" : "AgentFailed", { code: modelResult.code, failureKind: modelResult.failureKind });
          await completePhase(executionPhase);
          await record(cancelled ? "RunCancelled" : "RunFailed", { code: modelResult.code, failureKind: modelResult.failureKind });
          result = terminalResult(
            input.runId,
            modelResult.failureKind === "cancelled" ? "cancelled" : "failed",
            startedAt,
            null,
            toRunError(modelResult),
            1,
            emptyUsage(),
            events,
            phases,
          );
        }
      } catch (error) {
        await completePhase(executionPhase);
        const failure = classifyWorkflowError(error);
        const eventKind = failure.failureKind === "cancelled" ? "AgentCancelled" : "AgentFailed";
        await record(eventKind, { code: failure.code, failureKind: failure.failureKind });
        await record(failure.failureKind === "cancelled" ? "RunCancelled" : "RunFailed", {
          code: failure.code,
          failureKind: failure.failureKind,
        });
        result = terminalResult(
          input.runId,
          failure.failureKind === "cancelled" ? "cancelled" : "failed",
          startedAt,
          null,
          failure,
          1,
          emptyUsage(),
          events,
          phases,
        );
      }

      ctx.set("status", { status: result.status, runId: input.runId, finishedAt: result.finishedAt });
      return result;
    },
  },
  options: {
    workflowRetention: RESTATE_DEFAULT_WORKFLOW_RETENTION_MS,
    retryPolicy: {
      maxAttempts: RESTATE_DEFAULT_MAX_ATTEMPTS,
      onMaxAttempts: "kill",
      initialInterval: RESTATE_DEFAULT_RUN_RETRY_INTERVAL_MS,
      maxInterval: RESTATE_DEFAULT_RUN_MAX_RETRY_INTERVAL_MS,
      exponentiationFactor: 2,
    },
  },
});

function terminalResult(
  runId: string,
  status: "completed" | "failed" | "cancelled",
  startedAt: string,
  output: string | null,
  error: RunError | null,
  attemptCount: number,
  usage: RunUsage,
  eventIntents: readonly RunEventIntent[],
  phases: RunTrajectory["phases"],
): RestateWorkflowResult {
  const finishedAt = eventIntents.at(-1)?.occurredAt ?? startedAt;
  const trajectory: RunTrajectory = { schemaVersion: 1, runId, phases: [...phases] };
  const metrics: RunMetrics = {
    schemaVersion: 1,
    runId,
    status,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    modelCallCount: eventIntents.filter((event) => event.kind === "ModelRequested").length,
    modelAttemptCount: attemptCount,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: null,
  };
  return {
    schemaVersion: 1,
    runId,
    status,
    startedAt,
    finishedAt,
    output,
    error,
    attemptCount,
    usage,
    eventIntents,
    trajectory,
    metrics,
  };
}

function toRunError(failure: Extract<ModelCallResult, { kind: "failure" }>): RunError {
  return {
    code: failure.code,
    message: failure.message,
    failureKind: failure.failureKind,
    retryable: failure.retryable,
  };
}

function classifyWorkflowError(error: unknown): RunError {
  if (error instanceof restate.CancelledError) {
    return { code: "RUN_CANCELLED", message: "The Restate workflow was cancelled.", failureKind: "cancelled", retryable: false };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { code: "RUN_CANCELLED", message: "The Restate workflow was cancelled.", failureKind: "cancelled", retryable: false };
  }
  if (error instanceof restate.TerminalError) {
    return {
      code: "MODEL_RETRY_EXHAUSTED",
      message: "The Restate durable model step exhausted its bounded retry policy.",
      failureKind: "provider",
      retryable: false,
    };
  }
  return {
    code: "RESTATE_WORKFLOW_INTERNAL_ERROR",
    message: "The Restate workflow failed before it could produce a terminal model result.",
    failureKind: "internal",
    retryable: false,
  };
}

function emptyUsage(): RunUsage {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}
