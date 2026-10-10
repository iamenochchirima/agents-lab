import type { TaskInputResume } from "../../../../capabilities/interaction/contracts.js";
import { executionDeadlineReached, remainingExecutionMs } from "../../../../capabilities/execution/policy.js";
import { projectToolResult, toolResultEvidence } from "../../../../capabilities/tools/result-projection.js";
import type { InvocationResumeInput, InvocationReviewView } from "../../../../capabilities/reviews/contracts.js";
import { createProjectedToolRegistry } from "../../../../capabilities/extensions/projection.js";
import {
  ActivityFailure,
  condition,
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
import type { ToolCall, ToolExecutionResult } from "../../../../capabilities/tools/contracts.js";
import {
  BASELINE_QUERY_NAME,
  BASELINE_CANCEL_SIGNAL,
  BASELINE_REVIEW_SIGNAL,
  type ModelCallResult,
  type TemporalEventIntent,
  type TemporalRunError,
  type TemporalUsage,
  type TemporalWorkflowInput,
  type TemporalWorkflowResult,
  type TemporalWorkflowSnapshot,
  type TemporalModelMessage,
} from "./contracts.js";

const { prepareContext, prepareRoundContext, requestModel, executeTool, prepareInvocation, taskInputBoundary, taskQuestion, taskAnswer } = proxyActivities<typeof baselineActivities>({
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
export const baselineTaskInputSignal = defineSignal<[TaskInputResume]>("baselineTaskInput");
export const baselineReviewSignal = defineSignal<[InvocationResumeInput]>(BASELINE_REVIEW_SIGNAL);

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
  let pendingReview: InvocationReviewView | null = null;
  let reviewDecision: InvocationResumeInput | null = null;
  let currentActivityScope: CancellationScope | null = null;
  let contextSnapshotId: string | null = null;
  let contextRecoveryUsed = false;
  let continuationMessages: TemporalModelMessage[] = [];
  let roundMessages: readonly TemporalModelMessage[] | null = null;
  let usageObserved = false;
  let inToolBatch = false;
  let queuedUserInputs: TemporalModelMessage[] = [];
  let taskWakeSequence = 0;
  const turnId = input.context?.turnId ?? `${input.runId}:turn:1`;
  const interactive = input.toolCatalog?.tools.some(tool => tool.definition.name === "ask_user" && tool.source.id === "agentlab/task-interaction") ?? false;
  setHandler(baselineTaskInputSignal, value => {
    if (value?.kind === "task_input" && value.runId === input.runId && value.turnId === turnId && Number.isSafeInteger(value.sequence)) taskWakeSequence = Math.max(taskWakeSequence, value.sequence);
  });
  const toolConfiguration = normalizeToolConfiguration(input.tools);
  const toolRegistry = createProjectedToolRegistry(toolConfiguration, input.toolCatalog);
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
    pendingReview,
  });
  setHandler(baselineSnapshotQuery, snapshot);
  setHandler(baselineReviewSignal, decision => {
    if (cancellationRequested || !pendingReview || decision.kind !== "invocation_review" ||
        decision.requestId !== pendingReview.requestId || (decision.decision === "renewed" ? decision.revision !== pendingReview.revision + 1 : decision.revision !== pendingReview.revision) ||
        decision.toolCallId !== pendingReview.call.toolCallId ||
        !["approved", "denied", "renewed"].includes(decision.decision)) return;
    // The control plane persists/authenticates the decision; the host rechecks it
    // before dispatch. Repeated signal delivery cannot replace the first value.
    reviewDecision ??= decision;
  });

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

  const consumeInputs = async (boundaryId: string): Promise<boolean> => {
    if (!interactive) return false;
    const inputs = await taskInputBoundary({runId: input.runId, turnId, boundaryId});
    for (const value of inputs) {
      const message: TemporalModelMessage = {role: "user", content: `[Live task instruction ${value.sequence}; input ${value.inputId}]\n${value.content}`};
      if (inToolBatch) queuedUserInputs.push(message); else continuationMessages.push(message);
      record("TaskInputConsumed", {inputId: value.inputId, sequence: value.sequence, kind: value.kind, content: value.content});
    }
    return inputs.length > 0;
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

  const taskDeadlineFailure = (): TemporalWorkflowResult => fail({ code: "RUN_DEADLINE_EXCEEDED",
    message: "The retained task deadline was reached.", failureKind: "timeout", retryable: false }, attemptCount);
  const modelTimeout = () => Math.max(1, Math.min(input.execution?.modelTimeoutMs ?? input.activityTimeoutMs,
    remainingExecutionMs(input.execution, Date.now())));

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
          startToCloseTimeout: `${modelTimeout()}ms`,
          heartbeatTimeout: "1s",
          retry: { maximumAttempts: 1 },
          cancellationType: "WAIT_CANCELLATION_COMPLETED",
        },
        [{
          rootDirectory: context.rootDirectory,
          liveEval: input.liveEval,
          liveEvalExperiment: input.liveEvalExperiment,
          sessionId: context.sessionId,
          turnId: context.turnId,
          provider: input.model.provider,
          model: input.model.model,
          ...(forceCompaction ? { forceCompaction: true } : {}),
          ...(trigger === "provider_overflow" ? { trigger } : {}),
          ...(input.inventory ? { capabilityInventory: input.inventory } : {}),
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
      await consumeInputs(`model:${round}`);
      if (executionDeadlineReached(input.execution, Date.now())) return taskDeadlineFailure();
      if (input.execution) record("TaskProgress", { round, completedToolCount: eventIntents.filter(event => event.kind === "ToolExecutionCompleted").length, phase: "model" });
      if (input.execution && input.context && contextSnapshotId) {
        const context = input.context;
        const snapshotId = contextSnapshotId;
        currentActivityScope = new CancellationScope();
        try {
          const prepared = await currentActivityScope.run(() => prepareRoundContext.executeWithOptions({
            activityId: `${input.runId}:round-context:${round}`, startToCloseTimeout: `${modelTimeout()}ms`,
            heartbeatTimeout: "1s", retry: { maximumAttempts: 1 }, cancellationType: "WAIT_CANCELLATION_COMPLETED",
          }, [{ runId: input.runId, round, prompt: input.prompt, systemInstruction: input.systemInstruction,
            provider: input.model.provider, model: input.model.model, attemptId: `${input.runId}:summary:${round}`,
            attemptNumber: 1, tools: toolDefinitions,
            context: { rootDirectory: context.rootDirectory, sessionId: context.sessionId, snapshotId },
            ...(roundMessages ? { messages: roundMessages } : {}), continuationMessages }]));
          if (prepared.summaryAttempted) {
            attemptCount += 1;
            record("ModelRequested", { purpose: "summary", round, attempt: attemptCount, attemptId: `${input.runId}:summary:${round}` });
            if (prepared.summary?.kind === "success") {
              usage = usageObserved ? addUsage(usage, prepared.summary.usage) : prepared.summary.usage; usageObserved = true;
              record("ModelCompleted", { purpose: "summary", round, usage: prepared.summary.usage, providerRequestId: prepared.summary.providerRequestId });
            } else record("ModelFailed", { purpose: "summary", round, code: prepared.summary?.kind === "failure" ? prepared.summary.code : "CONTEXT_SUMMARY_UNCONFIRMED" });
            if (prepared.summary?.evalObservation) record("EvalModelObserved", { purpose: "summary", round, observation: prepared.summary.evalObservation });
          }
          if (prepared.failure) return fail(prepared.failure, attemptCount);
          record("ContextRoundPrepared", { round, contextRecordId: prepared.contextRecordId, budget: prepared.budget,
            compaction: prepared.compaction });
          if (prepared.compaction) record("ContextCompacted", { round, compaction: prepared.compaction });
          roundMessages = prepared.messages; continuationMessages = [];
        } catch (cause) {
          if (cancellationRequested || isCancellation(cause)) return cancel(attemptCount);
          return fail(classifyActivityFailure(cause), attemptCount);
        } finally { currentActivityScope = null; }
      }
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
        if (executionDeadlineReached(input.execution, Date.now())) return taskDeadlineFailure();
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
              startToCloseTimeout: `${modelTimeout()}ms`,
              heartbeatTimeout: "1s",
              retry: { maximumAttempts: 1 },
              cancellationType: "WAIT_CANCELLATION_COMPLETED",
            },
            [{
              runId: input.runId,
              liveEval: input.liveEval,
              liveEvalExperiment: input.liveEvalExperiment,
              prompt: input.prompt,
              systemInstruction: input.systemInstruction,
              provider: input.model.provider,
              model: input.model.model,
              attemptId,
              attemptNumber: attempt,
              tools: toolDefinitions,
              ...(roundMessages ? { messages: roundMessages } : input.context && contextSnapshotId ? {
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

        if (result.evalObservation) record("EvalModelObserved", { round, attempt, observation: result.evalObservation });
        if (result.kind === "success") {
          break;
        }

        record("ModelFailed", {
          attempt,
          round,
          attemptId,
          code: result.code,
          message: result.message,
          failureKind: result.failureKind,
          requestSent: result.requestSent,
        });
        if (!input.execution && !input.liveEval && isContextOverflow(result) && input.context && !contextRecoveryUsed) {
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
      usage = usageObserved ? addUsage(usage, result.usage) : result.usage;
      usageObserved = true;
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
        if (await consumeInputs(`completion:${round}`)) { record("TaskOutputSuperseded", {round}); continue; }
        if (!result.output) return fail(temporalFailure("MODEL_EMPTY_OUTPUT", "The model returned neither text nor a tool call.", "provider"), attemptCount);
        record("AgentCompleted", { attempt: attemptCount, round });
        finishPhase(executionPhase);
        record("RunCompleted", { attempt: attemptCount, round });
        return terminal("completed");
      }

      inToolBatch = true;
      const callIds = new Set<string>();
      let toolLimitExceeded = false;
      let batchSuperseded = false;
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

        if (batchSuperseded || await consumeInputs(`tool:${round}:${callIds.size}`)) {
          batchSuperseded = true;
          continuationMessages.push(toolResultMessage(resultId, call.name, toolErrorContent("TASK_INPUT_SUPERSEDED", "New user instructions arrived. Reconsider this call with the updated constraints.")));
          record("ToolCallRejected", {...toolEventPayload(call, 1), code: "TASK_INPUT_SUPERSEDED"});
          continue;
        }
        if (interactive && call.name === "ask_user") {
          const question = await taskQuestion({runId: input.runId, turnId, call});
          status = "suspended";
          record("ToolExecutionStarted", toolEventPayload(call, 1));
          record("WorkflowSuspended", {reason: "clarification", ...question});
          if (await consumeInputs(`question-wait:${round}:${callIds.size}`)) {
            batchSuperseded = true; status = "running";
            continuationMessages.push(toolResultMessage(resultId, call.name, toolErrorContent("TASK_INPUT_SUPERSEDED", "The question was superseded by new user instructions.")));
            record("WorkflowResumed", {reason: "task_input", questionId: question.questionId, code: "TASK_INPUT_SUPERSEDED"});
            continue;
          }
          let answerWake = taskWakeSequence;
          let answer = await taskAnswer({runId: input.runId, turnId, questionId: question.questionId});
          while (!answer) {
            const wake = answerWake;
            const arrived = input.execution
              ? await condition(() => taskWakeSequence > wake || cancellationRequested, Math.max(1, remainingExecutionMs(input.execution, Date.now())))
              : (await condition(() => taskWakeSequence > wake || cancellationRequested), true);
            if (cancellationRequested) return cancel(attemptCount);
            if (!arrived || executionDeadlineReached(input.execution, Date.now())) return taskDeadlineFailure();
            if (await consumeInputs(`question-input:${round}:${callIds.size}:${taskWakeSequence}`)) {
              batchSuperseded = true; break;
            }
            answerWake = taskWakeSequence;
            answer = await taskAnswer({runId: input.runId, turnId, questionId: question.questionId});
          }
          status = "running";
          if (batchSuperseded || !answer) {
            continuationMessages.push(toolResultMessage(resultId, call.name, toolErrorContent("TASK_INPUT_SUPERSEDED", "The question was superseded by new user instructions.")));
            record("WorkflowResumed", {reason: "task_input", questionId: question.questionId, code: "TASK_INPUT_SUPERSEDED"});
            continue;
          }
          toolAttemptCount += 1;
          record("TaskInputConsumed", {inputId: answer.inputId, sequence: answer.sequence, kind: answer.kind, content: answer.content, questionId: question.questionId});
          record("WorkflowResumed", {reason: "clarification", questionId: question.questionId, toolCallId: call.toolCallId});
          continuationMessages.push(toolResultMessage(resultId, call.name, JSON.stringify({questionId: question.questionId, answer: answer.content})));
          record("ToolExecutionCompleted", {...toolEventPayload(call, 1), content: JSON.stringify({questionId: question.questionId, answer: answer.content}), durationMs: 0});
          continue;
        }

        if (validation.definition.approvalMode === "invocation") {
          currentActivityScope = new CancellationScope();
          let review: InvocationReviewView | null;
          try {
            review = await currentActivityScope.run(() => prepareInvocation({ runId: input.runId,
              turnId: input.context?.turnId ?? `${input.runId}:turn:1`,
              enabledNames: toolConfiguration.enabledNames, approvedNames: toolConfiguration.approvedNames,
              toolCatalog: input.toolCatalog, call: validation.call }));
          } catch {
            if (cancellationRequested) return cancel(attemptCount);
            const failure = classifyInvocationPreparationFailure();
            record("ToolCallRejected", { ...toolEventPayload(validation.call, 1), code: failure.code, message: failure.message });
            return fail(failure, attemptCount);
          } finally { currentActivityScope = null; }
          if (cancellationRequested) return cancel(attemptCount);
          if (review) {
            let decision: InvocationResumeInput["decision"] | undefined = review.decision?.decision;
            while (review.status === "pending" || review.status === "expired") {
              pendingReview = review;
              reviewDecision = null;
              status = "suspended";
              record("WorkflowSuspended", { reason: "invocation_review", requestId: review.requestId,
                revision: review.revision, toolCallId: call.toolCallId, toolName: call.name, argumentDigest: review.argumentDigest });
              const reviewWake = taskWakeSequence;
              if (await consumeInputs(`review-wait:${round}:${callIds.size}:${review.revision}`)) {
                batchSuperseded = true; decision = "denied"; pendingReview = null; status = "running";
                record("WorkflowResumed", {reason: "task_input", requestId: review.requestId, code: "TASK_INPUT_SUPERSEDED"});
                break;
              }
              const delivered = input.execution
                ? await condition(() => reviewDecision !== null || cancellationRequested || taskWakeSequence > reviewWake, Math.max(1, remainingExecutionMs(input.execution, Date.now())))
                : (await condition(() => reviewDecision !== null || cancellationRequested || taskWakeSequence > reviewWake), true);
              if (!delivered || executionDeadlineReached(input.execution, Date.now())) return taskDeadlineFailure();
              if (cancellationRequested) return cancel(attemptCount);
              if (taskWakeSequence > reviewWake && await consumeInputs(`review:${round}:${callIds.size}:${review.revision}`)) {
                batchSuperseded = true; decision = "denied";
                pendingReview = null; status = "running";
                record("WorkflowResumed", {reason: "task_input", requestId: review.requestId, code: "TASK_INPUT_SUPERSEDED"});
                break;
              }
              const resumed = reviewDecision as InvocationResumeInput | null;
              decision = resumed?.decision;
              if (decision === "renewed") {
                currentActivityScope = new CancellationScope();
                let renewed: InvocationReviewView | null;
                try {
                  renewed = await currentActivityScope.run(() => prepareInvocation({runId: input.runId,
                    turnId: input.context?.turnId ?? `${input.runId}:turn:1`, enabledNames: toolConfiguration.enabledNames,
                    approvedNames: toolConfiguration.approvedNames, toolCatalog: input.toolCatalog, call: validation.call}));
                } catch {
                  if (cancellationRequested) return cancel(attemptCount);
                  const failure = classifyInvocationPreparationFailure();
                  record("ToolCallRejected", { ...toolEventPayload(validation.call, 1), code: failure.code, message: failure.message });
                  return fail(failure, attemptCount);
                } finally { currentActivityScope = null; }
                if (cancellationRequested) return cancel(attemptCount);
                if (!renewed || renewed.requestId !== review.requestId || renewed.revision !== resumed!.revision || renewed.status !== "pending") throw new Error("The renewed proposal does not match this waiting action.");
                record("InvocationReviewRenewed", {requestId: review.requestId, revision: renewed.revision, toolCallId: call.toolCallId});
                review = renewed;
                continue;
              }
              pendingReview = null;
              status = "running";
              record("WorkflowResumed", { reason: "invocation_review", requestId: review.requestId,
                toolCallId: call.toolCallId, decision });
              break;
            }
            if (review.status === "cancelled") {
              if (await consumeInputs(`review-cancelled:${round}:${callIds.size}`)) { batchSuperseded = true; decision = "denied"; }
              else return cancel(attemptCount);
            }
            if (decision === "denied") {
              continuationMessages = [...continuationMessages, toolResultMessage(resultId, call.name,
                toolErrorContent("TOOL_APPROVAL_DENIED", "The proposed action was declined."))];
              record("ToolPolicyDenied", { ...toolEventPayload(validation.call, 1), code: "TOOL_APPROVAL_DENIED" });
              continue;
            }
          }
        }

        if (executionDeadlineReached(input.execution, Date.now())) return taskDeadlineFailure();
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
              startToCloseTimeout: `${Math.max(1, Math.min(input.execution ? validation.definition.limits.timeoutMs : input.activityTimeoutMs, remainingExecutionMs(input.execution, Date.now())))}ms`,
              heartbeatTimeout: "1s",
              retry: { maximumAttempts: 1 },
              cancellationType: "WAIT_CANCELLATION_COMPLETED",
            },
            [{ runId: input.runId, turnId: input.context?.turnId ?? `${input.runId}:turn:1`, enabledNames: toolConfiguration.enabledNames, approvedNames: toolConfiguration.approvedNames, connectionBindings: input.connections, toolCatalog: input.toolCatalog, call: validation.call }],
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
        record(toolEventKind(toolResult), { ...toolEventPayload(validation.call, 1), status: toolResult.status, durationMs: toolResult.durationMs, resultBytes: byteLength(toolResult.content), ...toolResultEvidence(toolResult), ...(toolResult.connection ? { connection: toolResult.connection } : {}), ...(toolResult.error ? { code: toolResult.error.code, message: toolResult.error.message } : {}) });
        if (input.liveEval || (input.model.provider === "fake" && input.model.model.startsWith("fake-eval-"))) {
          record("EvalToolObserved", { toolCallId: call.toolCallId, name: call.name, arguments: call.arguments, round, status: toolResult.status, output: toolResult.content });
        }
        continuationMessages = [...continuationMessages, toolResultMessage(resultId, call.name, projectToolResult(toolResult).content)];
        if (toolResult.status === "failed" && validation.definition.failurePolicy === "feedback") continue;
        if (toolResult.status !== "completed") {
          const failure = temporalFailure(
            toolResult.error?.code ?? "TOOL_EXECUTION_FAILED",
            "A tool execution did not complete, so the run was stopped.",
            toolResult.status === "cancelled" ? "cancelled" : toolResult.status === "unknown" ? "outcome_unknown" : "provider",
          );
          if (toolResult.status === "cancelled") return cancel(attemptCount);
          return fail(failure, attemptCount);
        }
      }
      inToolBatch = false;
      continuationMessages.push(...queuedUserInputs); queuedUserInputs = [];
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

/** Preparation persists a proposal only; failure here cannot dispatch this call.
 * Do not surface arbitrary Activity cause messages containing host paths or tokens.
 */
export function classifyInvocationPreparationFailure(): TemporalRunError {
  return temporalFailure("ACTION_REVIEW_PREPARATION_FAILED",
    "Action review could not be prepared. This tool action was not dispatched. Check the capability host connection and review policy.",
    "pre_dispatch");
}

export function classifyActivityFailure(error: unknown): TemporalRunError {
  if (isCancellation(error)) {
    return {
      code: "MODEL_CANCELLED",
      message: "The model activity was cancelled.",
      failureKind: "cancelled",
      retryable: false,
    };
  }
  if (error instanceof ActivityFailure && error.cause instanceof TimeoutFailure && error.cause.timeoutType === "HEARTBEAT") {
    // Worker loss proves missing liveness, not that the dispatched provider call
    // failed. Stop safely instead of presenting an ordinary elapsed model budget.
    return { code: "MODEL_ACTIVITY_HEARTBEAT_LOST", message: "The model Activity lost its heartbeat; the dispatched outcome is unknown.", failureKind: "outcome_unknown", retryable: false };
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
    ...(input.approvedNames ? { approvedNames: input.approvedNames.filter((name) => typeof name === "string") } : {}),
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
  if (result.status === "unknown") return "ToolExecutionUnknown";
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

function addUsage(left: TemporalUsage, right: TemporalUsage): TemporalUsage {
  const sum = (a: number | null, b: number | null) => a === null || b === null ? null : a + b;
  return { inputTokens: sum(left.inputTokens, right.inputTokens), outputTokens: sum(left.outputTokens, right.outputTokens), totalTokens: sum(left.totalTokens, right.totalTokens) };
}
