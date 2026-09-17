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
import { calculatorTool } from "../../../../capabilities/tools/calculator.js";
import { ToolRegistry } from "../../../../capabilities/tools/registry.js";
import type { ToolCall, ToolExecutionResult } from "../../../../capabilities/tools/contracts.js";
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
  type TemporalModelMessage,
} from "./contracts.js";

const { prepareContext, requestModel, executeTool } = proxyActivities<typeof baselineActivities>({
  startToCloseTimeout: "30s",
  heartbeatTimeout: "1s",
  retry: { maximumAttempts: 1 },
  cancellationType: "WAIT_CANCELLATION_COMPLETED",
});

const DEFAULT_TOOL_CONFIGURATION = Object.freeze({
  enabledNames: ["calculator"] as readonly string[],
  maxRounds: 6,
  maxCalls: 8,
});

export const baselineSnapshotQuery = defineQuery<TemporalWorkflowSnapshot>(BASELINE_QUERY_NAME);
export const baselineCancelSignal = defineSignal<[string]>(BASELINE_CANCEL_SIGNAL);

/**
 * One Temporal execution owns one model-backed turn. Event intents live in
 * workflow state so a server outage cannot erase the lifecycle; the server
 * later projects them into Lab files.
 */
export async function temporalBaselineWorkflow(input: TemporalWorkflowInput): Promise<TemporalWorkflowResult> {
  const timestamp = (): string => new Date(workflowNow()).toISOString();
  const startedAt = timestamp();
  let status: TemporalWorkflowSnapshot["status"] = "queued";
  let finishedAt: string | null = null;
  let output: string | null = null;
  let error: TemporalRunError | null = null;
  let attemptCount = 0;
  let toolAttemptCount = 0;
  let usage: TemporalUsage = emptyUsage();
  let eventSequence = 0;
  const eventIntents: TemporalEventIntent[] = [];
  const phases: { name: string; startedAt: string; finishedAt: string | null }[] = [];
  let cancellationRequested = false;
  let currentActivityScope: CancellationScope | null = null;
  let contextSnapshotId: string | null = null;
  let contextRecoveryUsed = false;
  let continuationMessages: TemporalModelMessage[] = [];
  const toolConfiguration = normalizeToolConfiguration(input.tools);
  const toolRegistry = new ToolRegistry({ enabledNames: toolConfiguration.enabledNames });
  toolRegistry.register(calculatorTool);
  const toolDefinitions = toolRegistry.definitions();

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

  const prepareContextForRun = async (
    activityId: string,
    forceCompaction = false,
    trigger: "preflight" | "provider_overflow" = "preflight",
  ) => {
    const context = input.context;
    if (!context) throw new Error("Context preparation requires a context input.");
    currentActivityScope = new CancellationScope();
    try {
      return await currentActivityScope.run(() => prepareContext.executeWithOptions(
        {
          activityId,
          startToCloseTimeout: `${input.activityTimeoutMs}ms`,
          heartbeatTimeout: "1s",
          retry: { maximumAttempts: 1 },
          cancellationType: "WAIT_CANCELLATION_COMPLETED",
        },
        [{
          rootDirectory: context.rootDirectory,
          sessionId: context.sessionId,
          turnId: context.turnId,
          provider: input.model.provider,
          model: input.model.model,
          ...(forceCompaction ? { forceCompaction: true } : {}),
          ...(trigger === "provider_overflow" ? { trigger } : {}),
        }],
      ));
    } finally {
      currentActivityScope = null;
    }
  };

  const recordContextPrepared = (kind: "ContextPrepared" | "ContextRecoveryPrepared", prepared: Awaited<ReturnType<typeof prepareContextForRun>>): void => {
    if (!input.context) return;
    contextSnapshotId = prepared.snapshotId;
    record(kind, {
      sessionId: input.context.sessionId,
      turnId: input.context.turnId,
      snapshotId: prepared.snapshotId,
      sessionRevision: prepared.sessionRevision,
      compactionRevision: prepared.compactionRevision,
      inputTokens: prepared.inputTokens,
      remainingTokens: prepared.remainingTokens,
      remainingPercent: prepared.remainingPercent,
      pressure: prepared.pressure,
      quality: prepared.quality,
      compacted: prepared.compacted,
      compaction: prepared.compaction,
    });
  };

  try {
    if (input.context) {
      const contextPhase = { name: "context_preparation", startedAt: timestamp(), finishedAt: null as string | null };
      phases.push(contextPhase);
      record("ContextPreparationStarted", { sessionId: input.context.sessionId, turnId: input.context.turnId });
      try {
        const prepared = await prepareContextForRun(`${input.runId}:context`);
        recordContextPrepared("ContextPrepared", prepared);
        finishPhase(contextPhase);
      } catch (contextError) {
        finishPhase(contextPhase);
        if (cancellationRequested || isCancellation(contextError)) return cancel(0);
        const failure: TemporalRunError = {
          code: "CONTEXT_PREPARATION_FAILED",
          message: safeErrorMessage(contextError),
          failureKind: "outcome_unknown",
          retryable: false,
        };
        record("ContextPreparationFailed", { code: failure.code, failureKind: failure.failureKind });
        return fail(failure, 0);
      }
    }

    for (let round = 1; round <= toolConfiguration.maxRounds; round += 1) {
      let roundAttempts = 0;
      let result: ModelCallResult = {
        kind: "failure",
        failureKind: "provider",
        code: "MODEL_NOT_EXECUTED",
        message: "The model round did not execute.",
        requestSent: false,
      };

      while (true) {
        if (cancellationRequested) return cancel(attemptCount);
        roundAttempts += 1;
        attemptCount += 1;
        const attempt = attemptCount;
        const attemptId = `${input.runId}:model:${attempt}`;
        const modelPhase = { name: `model_request_${round}_${attempt}`, startedAt: timestamp(), finishedAt: null as string | null };
        phases.push(modelPhase);
        record("ModelRequested", {
          attempt,
          round,
          attemptId,
          activityType: "requestModel",
          model: input.model.model,
          provider: input.model.provider,
          toolCount: toolDefinitions.length,
          ...(contextSnapshotId ? { contextSnapshotId } : {}),
        });

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
            [{
              runId: input.runId,
              prompt: input.prompt,
              systemInstruction: input.systemInstruction,
              provider: input.model.provider,
              model: input.model.model,
              attemptId,
              attemptNumber: attempt,
              tools: toolDefinitions,
              ...(input.context && contextSnapshotId ? {
                context: {
                  rootDirectory: input.context.rootDirectory,
                  sessionId: input.context.sessionId,
                  snapshotId: contextSnapshotId,
                },
              } : { messages: initialModelMessages(input) }),
              ...(continuationMessages.length > 0 ? { continuationMessages } : {}),
            }],
          ));
        } catch (activityError) {
          finishPhase(modelPhase);
          const failure = classifyActivityFailure(activityError);
          record("ModelFailed", { attempt, round, attemptId, activityType: "requestModel", ...failure });
          if (cancellationRequested || failure.failureKind === "cancelled") return cancel(attempt);
          return fail(failure, attempt);
        } finally {
          currentActivityScope = null;
        }
        finishPhase(modelPhase);

        if (result.kind === "success") break;

        record("ModelFailed", {
          attempt,
          round,
          attemptId,
          code: result.code,
          message: result.message,
          failureKind: result.failureKind,
          requestSent: result.requestSent,
        });
        if (isContextOverflow(result) && input.context && !contextRecoveryUsed) {
          contextRecoveryUsed = true;
          record("ContextOverflowDetected", { attempt, round, attemptId, contextSnapshotId });
          const recoveryPhase = { name: "context_recovery", startedAt: timestamp(), finishedAt: null as string | null };
          phases.push(recoveryPhase);
          record("ContextRecoveryStarted", { sessionId: input.context.sessionId, turnId: input.context.turnId });
          try {
            const prepared = await prepareContextForRun(`${input.runId}:context-recovery`, true, "provider_overflow");
            recordContextPrepared("ContextRecoveryPrepared", prepared);
            finishPhase(recoveryPhase);
            continue;
          } catch (contextError) {
            finishPhase(recoveryPhase);
            if (cancellationRequested || isCancellation(contextError)) return cancel(attempt);
            const failure: TemporalRunError = {
              code: "CONTEXT_RECOVERY_FAILED",
              message: safeErrorMessage(contextError),
              failureKind: "outcome_unknown",
              retryable: false,
            };
            record("ContextRecoveryFailed", { code: failure.code, failureKind: failure.failureKind });
            return fail(failure, attempt);
          }
        }
        if (result.failureKind === "pre_dispatch" && roundAttempts <= input.preDispatchRetryLimit) {
          const backoffMs = input.preDispatchRetryBackoffMs * 2 ** (roundAttempts - 1);
          record("ModelRetryScheduled", { attempt, round, nextAttempt: attempt + 1, backoffMs });
          await sleep(backoffMs);
          continue;
        }
        return fail({
          code: result.code,
          message: result.message,
          failureKind: result.failureKind,
          retryable: false,
        }, attempt);
      }

      const toolCalls = result.toolCalls ?? [];
      output = result.output;
      usage = result.usage;
      continuationMessages = [...continuationMessages, {
        role: "assistant",
        content: result.output,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      }];
      record("ModelCompleted", {
        attempt: attemptCount,
        round,
        activityType: "requestModel",
        providerRequestId: result.providerRequestId,
        toolCallCount: toolCalls.length,
      });
      if (toolCalls.length === 0) {
        if (!result.output) return fail(temporalFailure("MODEL_EMPTY_OUTPUT", "The model returned neither text nor a tool call.", "provider"), attemptCount);
        record("AgentCompleted", { attempt: attemptCount, round });
        finishPhase(executionPhase);
        record("RunCompleted", { attempt: attemptCount, round });
        return terminal("completed");
      }

      const callIds = new Set<string>();
      let toolLimitExceeded = false;
      for (const modelToolCall of toolCalls) {
        const call: ToolCall = { ...modelToolCall, round };
        const resultId = call.toolCallId || `invalid-call-${round}-${callIds.size + 1}`;
        record("ToolCallRequested", toolEventPayload(call, 1));
        if (callIds.has(call.toolCallId)) {
          const message = "Duplicate tool call ID in one model response.";
          record("ToolCallRejected", { ...toolEventPayload(call, 1), code: "DUPLICATE_CALL_ID", message });
          continuationMessages = [...continuationMessages, toolResultMessage(resultId, call.name, toolErrorContent("DUPLICATE_CALL_ID", message))];
          continue;
        }
        callIds.add(call.toolCallId);
        const validation = toolRegistry.validateCall(call);
        if (!validation.accepted) {
          record("ToolCallRejected", { ...toolEventPayload(call, 1), code: validation.code, message: validation.message });
          continuationMessages = [...continuationMessages, toolResultMessage(resultId, call.name, toolErrorContent(validation.code, validation.message))];
          continue;
        }
        record("ToolCallValidated", toolEventPayload(validation.call, 1));
        const policy = toolRegistry.authorize(validation.call);
        if (!policy.allowed) {
          record("ToolPolicyDenied", { ...toolEventPayload(validation.call, 1), code: policy.code, message: policy.message });
          continuationMessages = [...continuationMessages, toolResultMessage(resultId, call.name, toolErrorContent(policy.code, policy.message))];
          continue;
        }
        if (toolAttemptCount >= toolConfiguration.maxCalls) {
          toolLimitExceeded = true;
          const message = "The run reached its maximum tool-call limit.";
          record("ToolCallRejected", { ...toolEventPayload(validation.call, 1), code: "TOOL_CALL_LIMIT_EXCEEDED", message });
          continuationMessages = [...continuationMessages, toolResultMessage(resultId, call.name, toolErrorContent("TOOL_CALL_LIMIT_EXCEEDED", message))];
          continue;
        }

        toolAttemptCount += 1;
        const toolPhase = { name: `tool_execution_${round}_${toolAttemptCount}`, startedAt: timestamp(), finishedAt: null as string | null };
        phases.push(toolPhase);
        record("ToolExecutionStarted", toolEventPayload(validation.call, 1));
        let toolResult: ToolExecutionResult;
        const toolActivityId = `${input.runId}:tool:${round}:${stableActivityId(call.toolCallId)}`;
        currentActivityScope = new CancellationScope();
        try {
          toolResult = await currentActivityScope.run(() => executeTool.executeWithOptions(
            {
              activityId: toolActivityId,
              startToCloseTimeout: `${input.activityTimeoutMs}ms`,
              heartbeatTimeout: "1s",
              retry: { maximumAttempts: 1 },
              cancellationType: "WAIT_CANCELLATION_COMPLETED",
            },
            [{ runId: input.runId, turnId: input.context?.turnId ?? `${input.runId}:turn:1`, enabledNames: toolConfiguration.enabledNames, call: validation.call }],
          ));
        } catch (activityError) {
          finishPhase(toolPhase);
          if (cancellationRequested || isCancellation(activityError)) return cancel(attemptCount);
          const failure = temporalFailure("TOOL_ACTIVITY_FAILED", safeErrorMessage(activityError), "outcome_unknown");
          record("ToolExecutionFailed", { ...toolEventPayload(validation.call, 1), code: failure.code, message: failure.message });
          return fail(failure, attemptCount);
        } finally {
          currentActivityScope = null;
        }
        finishPhase(toolPhase);
        record(toolEventKind(toolResult), { ...toolEventPayload(validation.call, 1), status: toolResult.status, durationMs: toolResult.durationMs, resultBytes: byteLength(toolResult.content), ...(toolResult.error ? { code: toolResult.error.code, message: toolResult.error.message } : {}) });
        continuationMessages = [...continuationMessages, toolResultMessage(resultId, call.name, toolResult.content)];
        if (toolResult.status !== "completed") {
          const failure = temporalFailure(toolResult.error?.code ?? "TOOL_EXECUTION_FAILED", "A tool execution did not complete, so the run was stopped.", toolResult.status === "cancelled" ? "cancelled" : "provider");
          if (toolResult.status === "cancelled") return cancel(attemptCount);
          return fail(failure, attemptCount);
        }
      }
      if (toolLimitExceeded) return fail(temporalFailure("TOOL_CALL_LIMIT_EXCEEDED", "The run reached its maximum tool-call limit.", "provider"), attemptCount);
    }

    return fail(temporalFailure("TOOL_ROUND_LIMIT_EXCEEDED", "The model did not return final text within the tool round limit.", "provider"), attemptCount);
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

function isContextOverflow(result: ModelCallResult): boolean {
  return result.kind === "failure" && (
    result.code === "OPENROUTER_CONTEXT_OVERFLOW" ||
    result.code === "FAKE_CONTEXT_OVERFLOW"
  );
}

function normalizeToolConfiguration(input: TemporalWorkflowInput["tools"]): NonNullable<TemporalWorkflowInput["tools"]> {
  if (!input) return DEFAULT_TOOL_CONFIGURATION;
  return {
    enabledNames: input.enabledNames.filter((name) => typeof name === "string"),
    maxRounds: positiveInteger(input.maxRounds, DEFAULT_TOOL_CONFIGURATION.maxRounds),
    maxCalls: positiveInteger(input.maxCalls, DEFAULT_TOOL_CONFIGURATION.maxCalls),
  };
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function initialModelMessages(input: TemporalWorkflowInput): readonly TemporalModelMessage[] {
  return [
    { role: "system", content: input.systemInstruction },
    { role: "user", content: input.prompt },
  ];
}

function toolEventPayload(call: ToolCall, attempt: number): Record<string, unknown> {
  return {
    toolCallId: boundedText(call.toolCallId, 128),
    toolName: boundedText(call.name, 64),
    round: call.round,
    attempt,
    argumentBytes: byteLength(call.arguments),
  };
}

function toolEventKind(result: ToolExecutionResult): string {
  if (result.status === "completed") return "ToolExecutionCompleted";
  if (result.status === "cancelled" || result.status === "timed_out") return "ToolExecutionCancelled";
  return "ToolExecutionFailed";
}

function toolResultMessage(toolCallId: string, name: string, content: string): TemporalModelMessage {
  return { role: "tool", toolCallId, name, content };
}

function toolErrorContent(code: string, message: string): string {
  return JSON.stringify({ code: boundedText(code, 128), error: boundedText(message, 512) });
}

function temporalFailure(code: string, message: string, failureKind: TemporalRunError["failureKind"]): TemporalRunError {
  return { code, message, failureKind, retryable: false };
}

function byteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
  } catch {
    return 0;
  }
}

function boundedText(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}

function stableActivityId(value: string): string {
  return boundedText(value.replace(/[^A-Za-z0-9_-]/g, "_"), 80) || "anonymous";
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
