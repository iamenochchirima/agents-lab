import {
  ActivityFailure,
  CancellationScope,
  TimeoutFailure,
  defineSignal,
  defineQuery,
  isCancellation,
  proxyActivities,
  setHandler,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";

import type { baselineActivities } from "./activities.js";
import {
  BASELINE_QUERY_NAME,
  BASELINE_CANCEL_SIGNAL,
  type ModelCallResult,
  type TemporalEventIntent,
  type TemporalRunError,
  type TemporalUsage,
  type TemporalWorkflowInput,
  type TemporalWorkflowResult,
  type TemporalWorkflowSnapshot,
} from "./contracts.js";

const { requestModel } = proxyActivities<typeof baselineActivities>({
  startToCloseTimeout: "30s",
  heartbeatTimeout: "1s",
  retry: { maximumAttempts: 1 },
  cancellationType: "WAIT_CANCELLATION_COMPLETED",
});

export const baselineSnapshotQuery = defineQuery<TemporalWorkflowSnapshot>(BASELINE_QUERY_NAME);
export const baselineCancelSignal = defineSignal<[string]>(BASELINE_CANCEL_SIGNAL);

/**
 * One Temporal execution owns one model-backed turn. Event intents live in
 * workflow state so a control-plane outage cannot erase the lifecycle; the
 * control plane later projects them into Lab files.
 */
export async function temporalBaselineWorkflow(input: TemporalWorkflowInput): Promise<TemporalWorkflowResult> {
  const timestamp = (): string => new Date(workflowNow()).toISOString();
  const startedAt = timestamp();
  let status: TemporalWorkflowSnapshot["status"] = "queued";
  let finishedAt: string | null = null;
  let output: string | null = null;
  let error: TemporalRunError | null = null;
  let attemptCount = 0;
  let usage: TemporalUsage = emptyUsage();
  let eventSequence = 0;
  const eventIntents: TemporalEventIntent[] = [];
  const phases: { name: string; startedAt: string; finishedAt: string | null }[] = [];
  let cancellationRequested = false;
  let currentActivityScope: CancellationScope | null = null;

  const snapshot = (): TemporalWorkflowSnapshot => ({
    runId: input.runId,
    status,
    startedAt: status === "queued" ? null : startedAt,
    finishedAt,
    eventIntents: [...eventIntents],
    output,
    error,
    attemptCount,
    usage,
  });
  setHandler(baselineSnapshotQuery, snapshot);

  const record = (kind: string, payload: Record<string, unknown> = {}): void => {
    eventSequence += 1;
    eventIntents.push({
      source: "temporal-workflow",
      sourceSequence: eventSequence,
      kind,
      runId: input.runId,
      occurredAt: timestamp(),
      payload,
    });
  };

  const finishPhase = (phase: { name: string; startedAt: string; finishedAt: string | null }): void => {
    phase.finishedAt = timestamp();
  };

  const terminal = (terminalStatus: "completed" | "failed" | "cancelled"): TemporalWorkflowResult => {
    status = terminalStatus;
    finishedAt = timestamp();
    for (const phase of phases) {
      if (phase.finishedAt === null) {
        finishPhase(phase);
      }
    }
    return {
      ...snapshot(),
      status: terminalStatus,
      finishedAt,
      trajectory: { phases: [...phases] },
    };
  };

  const fail = (failure: TemporalRunError, attempt: number): TemporalWorkflowResult => {
    error = failure;
    record("AgentFailed", { attempt, code: failure.code, failureKind: failure.failureKind });
    record("RunFailed", { attempt, code: failure.code, failureKind: failure.failureKind });
    finishPhase(executionPhase);
    return terminal("failed");
  };

  const cancel = (attempt: number): TemporalWorkflowResult => {
    error = {
      code: "RUN_CANCELLED",
      message: "The Temporal workflow was cancelled.",
      failureKind: "cancelled",
      retryable: false,
    };
    finishPhase(executionPhase);
    record("AgentCancelled", { attempt });
    record("RunCancelled", { attempt });
    return terminal("cancelled");
  };

  status = "running";
  const executionPhase = { name: "agent_execution", startedAt, finishedAt: null as string | null };
  phases.push(executionPhase);
  record("AgentStarted", { workflowId: workflowInfo().workflowId });
  setHandler(baselineCancelSignal, () => {
    cancellationRequested = true;
    currentActivityScope?.cancel();
  });

  try {
    for (let attempt = 1; attempt <= input.preDispatchRetryLimit + 1; attempt += 1) {
      attemptCount = attempt;
      if (cancellationRequested) {
        return cancel(attempt);
      }
      const attemptId = `${input.runId}:model:${attempt}`;
      const modelPhase = { name: `model_request_${attempt}`, startedAt: timestamp(), finishedAt: null as string | null };
      phases.push(modelPhase);
      record("ModelRequested", {
        attempt,
        attemptId,
        activityType: "requestModel",
        model: input.model.model,
        provider: input.model.provider,
      });

      let result: ModelCallResult;
      currentActivityScope = new CancellationScope();
      try {
        result = await currentActivityScope.run(() => requestModel.executeWithOptions(
          {
            activityId: attemptId,
            startToCloseTimeout: `${input.activityTimeoutMs}ms`,
            heartbeatTimeout: "1s",
            retry: { maximumAttempts: 1 },
            cancellationType: "WAIT_CANCELLATION_COMPLETED",
          },
          [
            {
              runId: input.runId,
              prompt: input.prompt,
              systemInstruction: input.systemInstruction,
              provider: input.model.provider,
              model: input.model.model,
              attemptId,
              attemptNumber: attempt,
            },
          ],
        ));
      } catch (activityError) {
        finishPhase(modelPhase);
        const failure = classifyActivityFailure(activityError);
        record("ModelFailed", { attempt, attemptId, activityType: "requestModel", ...failure });
        if (cancellationRequested || failure.failureKind === "cancelled") {
          return cancel(attempt);
        }
        return fail(failure, attempt);
      } finally {
        currentActivityScope = null;
      }
      finishPhase(modelPhase);

      if (result.kind === "success") {
        output = result.output;
        usage = result.usage;
        record("ModelCompleted", {
          attempt,
          attemptId,
          activityType: "requestModel",
          providerRequestId: result.providerRequestId,
        });
        record("AgentCompleted", { attempt });
        finishPhase(executionPhase);
        record("RunCompleted", { attempt });
        return terminal("completed");
      }

      record("ModelFailed", {
        attempt,
        attemptId,
        code: result.code,
        message: result.message,
        failureKind: result.failureKind,
        requestSent: result.requestSent,
      });
      if (result.failureKind === "pre_dispatch" && attempt <= input.preDispatchRetryLimit) {
        const backoffMs = input.preDispatchRetryBackoffMs * 2 ** (attempt - 1);
        record("ModelRetryScheduled", { attempt, nextAttempt: attempt + 1, backoffMs });
        await sleep(backoffMs);
        continue;
      }

      return fail(
        {
          code: result.code,
          message: result.message,
          failureKind: result.failureKind,
          retryable: false,
        },
        attempt,
      );
    }

    return fail(
      {
        code: "PRE_DISPATCH_RETRY_EXHAUSTED",
        message: "The pre-dispatch retry limit was exhausted.",
        failureKind: "pre_dispatch",
        retryable: false,
      },
      attemptCount,
    );
  } catch (workflowError) {
    if (isCancellation(workflowError)) {
      return cancel(attemptCount);
    }

    finishPhase(executionPhase);
    error = {
      code: "WORKFLOW_INTERNAL_ERROR",
      message: safeErrorMessage(workflowError),
      failureKind: "internal",
      retryable: false,
    };
    record("AgentFailed", { attempt: attemptCount, code: error.code });
    record("RunFailed", { attempt: attemptCount, code: error.code });
    return terminal("failed");
  }
}

function classifyActivityFailure(error: unknown): TemporalRunError {
  if (isCancellation(error)) {
    return {
      code: "MODEL_CANCELLED",
      message: "The model activity was cancelled.",
      failureKind: "cancelled",
      retryable: false,
    };
  }
  if (error instanceof ActivityFailure && error.cause instanceof TimeoutFailure) {
    return {
      code: "MODEL_ACTIVITY_TIMEOUT",
      message: "The model activity exceeded its configured timeout.",
      failureKind: "timeout",
      retryable: false,
    };
  }
  return {
    code: "MODEL_ACTIVITY_FAILED",
    message: safeErrorMessage(error),
    failureKind: "outcome_unknown",
    retryable: false,
  };
}

function emptyUsage(): TemporalUsage {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

function workflowNow(): number {
  // Kept behind a named helper so every workflow timestamp is visibly derived
  // from Temporal's deterministic clock rather than the host process clock.
  return Date.now();
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The workflow failed with an unknown error.";
}
