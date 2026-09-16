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
import { calculateContextBudget } from "../../../../capabilities/context/budget.js";
import { calculatorTool } from "../../../../capabilities/tools/calculator.js";
import { ToolRegistry } from "../../../../capabilities/tools/registry.js";
import type {
  ToolCall,
  ToolDefinition,
  ToolExecutionResult,
  ToolLifecyclePayload,
} from "../../../../capabilities/tools/contracts.js";
import {
  RESTATE_WORKFLOW_SOURCE,
  type ModelCallResult,
  type ModelMessage,
  type ModelSuccess,
  type RestateWorkflowInput,
  type RestateWorkflowResult,
} from "./contracts.js";
import { createRestateModel } from "./models/factory.js";

const DEFAULT_TOOL_CONFIGURATION = Object.freeze({
  enabledNames: ["calculator"] as readonly string[],
  maxRounds: 6,
  maxCalls: 8,
});

export const baselineWorkflow = restate.workflow({
  name: RESTATE_SERVICE_NAME,
  handlers: {
    run: async (ctx: restate.WorkflowContext, input: RestateWorkflowInput): Promise<RestateWorkflowResult> => {
      const events: RunEventIntent[] = [];
      const phases: Array<RunTrajectory["phases"][number]> = [];
      const startedAt = await ctx.date.toJSON();
      const toolConfiguration = normalizeToolConfiguration(input.tools);
      const registry = new ToolRegistry({ enabledNames: toolConfiguration.enabledNames });
      registry.register(calculatorTool);
      const toolDefinitions = registry.definitions();
      const turnId = input.turnId ?? `${input.runId}:turn:1`;
      let sequence = 0;
      let modelCallCount = 0;
      let modelAttemptCount = 0;
      let toolCallCount = 0;
      let toolAttemptCount = 0;
      let usage = emptyUsage();
      let usageObserved = false;
      let messages: ModelMessage[] = [
        { role: "system", content: input.systemInstruction },
        { role: "user", content: input.prompt },
      ];

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

      const recordTool = async (kind: string, call: ToolCall, payload: ToolEventDetails): Promise<void> => {
        const safePayload = {
          ...payload,
          ...(payload.message ? { message: boundedEventText(payload.message, 512) } : {}),
        };
        await record(kind, {
          ...safePayload,
          toolCallId: boundedEventText(call.toolCallId, 128) || null,
          toolName: boundedEventText(call.name, 64) || null,
          round: call.round,
        });
      };

      const completePhase = async (phase: { readonly name: string; readonly startedAt: string; finishedAt: string | null }): Promise<void> => {
        phase.finishedAt = await ctx.date.toJSON();
      };

      const executionPhase = { name: "agent_execution", startedAt, finishedAt: null as string | null };
      phases.push(executionPhase);
      await record("AgentStarted", { workflowKey: ctx.key, invocationId: String(ctx.request().id) });
      ctx.set("status", { status: "running", runId: input.runId });

      try {
        for (let round = 1; round <= toolConfiguration.maxRounds; round += 1) {
          const modelPhase = { name: `model_request_${round}`, startedAt: await ctx.date.toJSON(), finishedAt: null as string | null };
          phases.push(modelPhase);
          modelCallCount += 1;
          let modelAttemptForRound = 0;
          let modelResult: ModelCallResult = {
            kind: "failure",
            code: "MODEL_ATTEMPT_NOT_EXECUTED",
            message: "The model attempt did not execute.",
            failureKind: "internal",
            retryable: false,
            requestSent: false,
          };
          const maxModelAttempts = positiveInteger(input.modelRetryAttempts ?? 0, RESTATE_DEFAULT_RUN_MAX_RETRY_ATTEMPTS);
          for (let attempt = 1; attempt <= maxModelAttempts; attempt += 1) {
            modelAttemptForRound = attempt;
            modelAttemptCount += 1;
            await record("ModelRequested", {
              provider: input.model.provider,
              model: input.model.model,
              attempt,
              round,
              toolCount: toolDefinitions.length,
            });
            modelResult = await requestModel(ctx, input, round, attempt, messages, toolDefinitions);
            if (modelResult.kind !== "failure" || !modelResult.retryable || modelResult.requestSent) break;
            if (attempt < maxModelAttempts) {
              await record("ModelRetryScheduled", {
                provider: input.model.provider,
                model: input.model.model,
                attempt,
                nextAttempt: attempt + 1,
                round,
                code: modelResult.code,
              });
            }
          }
          await completePhase(modelPhase);

          if (modelResult.kind === "failure") {
            const cancelled = modelResult.failureKind === "cancelled";
            await record(cancelled ? "ModelCancelled" : "ModelFailed", {
              code: modelResult.code,
              failureKind: modelResult.failureKind,
              requestSent: modelResult.requestSent,
              round,
              attempt: modelAttemptForRound,
            });
            await record(cancelled ? "AgentCancelled" : "AgentFailed", {
              code: modelResult.code,
              failureKind: modelResult.failureKind,
              round,
            });
            await completePhase(executionPhase);
            await record(cancelled ? "RunCancelled" : "RunFailed", {
              code: modelResult.code,
              failureKind: modelResult.failureKind,
            });
            return finish(
              input.runId,
              cancelled ? "cancelled" : "failed",
              startedAt,
              null,
              toRunError(modelResult),
              usage,
              modelCallCount,
              modelAttemptCount,
              toolCallCount,
              toolAttemptCount,
              events,
              phases,
            );
          }

          // A null usage value means that a provider did not report that
          // dimension, not that no model call has occurred yet. Seed the
          // accumulator from the first successful call so one real
          // OpenRouter response is not erased by the initial empty state.
          usage = usageObserved ? addUsage(usage, modelResult.usage) : modelResult.usage;
          usageObserved = true;
          await record("ModelCompleted", {
            provider: input.model.provider,
            model: input.model.model,
            providerRequestId: modelResult.providerRequestId,
            round,
            toolCallCount: modelResult.toolCalls.length,
            usage: modelResult.usage,
          });
          await record("ContextUsageObserved", contextUsagePayload(input, modelResult.usage, round));

          const toolCalls = modelResult.toolCalls;
          messages = [...messages, assistantMessage(modelResult)];
          if (toolCalls.length === 0) {
            if (!modelResult.output) {
              const failure = internalFailure("MODEL_EMPTY_OUTPUT", "The model returned neither text nor a tool call.");
              await record("AgentFailed", { code: failure.code, failureKind: failure.failureKind, round });
              await completePhase(executionPhase);
              await record("RunFailed", { code: failure.code, failureKind: failure.failureKind });
              return finish(input.runId, "failed", startedAt, null, failure, usage, modelCallCount, modelAttemptCount, toolCallCount, toolAttemptCount, events, phases);
            }
            await record("AgentCompleted", { attempt: modelAttemptForRound, round });
            await completePhase(executionPhase);
            await record("RunCompleted", { attempt: modelAttemptForRound, round });
            return finish(input.runId, "completed", startedAt, modelResult.output, null, usage, modelCallCount, modelAttemptCount, toolCallCount, toolAttemptCount, events, phases);
          }

          const calls: ToolCall[] = toolCalls.map((modelToolCall) => ({
            toolCallId: modelToolCall.toolCallId,
            name: modelToolCall.name,
            arguments: modelToolCall.arguments,
            round,
          }));
          const callIds = new Set<string>();
          let protocolInvalid = false;
          const invalidCallReasons = new Map<number, { readonly code: string; readonly message: string }>();

          // Validate the response-level identity before executing any member
          // of a batch. If pairing is unsafe, no side effect is allowed to
          // occur merely because an earlier call happened to be valid.
          for (let index = 0; index < calls.length; index += 1) {
            const call = calls[index];
            toolCallCount += 1;
            await recordTool("ToolCallRequested", call, { attempt: 1, round });
            if (!call.toolCallId) {
              protocolInvalid = true;
              invalidCallReasons.set(index, { code: "INVALID_CALL_ID", message: "Tool call ID is missing or unsafe." });
            } else if (callIds.has(call.toolCallId)) {
              protocolInvalid = true;
              invalidCallReasons.set(index, { code: "DUPLICATE_CALL_ID", message: "Duplicate tool call ID in one model response." });
            } else {
              callIds.add(call.toolCallId);
            }
          }

          if (protocolInvalid) {
            for (let index = 0; index < calls.length; index += 1) {
              const call = calls[index];
              const reason = invalidCallReasons.get(index) ?? {
                code: "INVALID_TOOL_CALL_RESPONSE",
                message: "Another tool call in this response could not be paired safely.",
              };
              await recordTool("ToolCallRejected", call, { attempt: 1, round, ...reason });
              messages = [...messages, toolResultMessage(call.toolCallId || `invalid-call-${round}-${index + 1}`, call.name, toolErrorContent(reason.code, reason.message))];
            }
            const failure = internalFailure("INVALID_TOOL_CALL_RESPONSE", "The model returned a tool call that could not be paired safely.");
            await record("AgentFailed", { code: failure.code, failureKind: failure.failureKind, round });
            await completePhase(executionPhase);
            await record("RunFailed", { code: failure.code, failureKind: failure.failureKind });
            return finish(input.runId, "failed", startedAt, null, failure, usage, modelCallCount, modelAttemptCount, toolCallCount, toolAttemptCount, events, phases);
          }

          let executionHalted = false;
          let callLimitExceeded = false;

          for (let index = 0; index < calls.length; index += 1) {
            const call = calls[index];

            const resultId = call.toolCallId || `invalid-call-${round}-${index + 1}`;

            if (executionHalted) {
              const code = "TOOL_EXECUTION_ABORTED";
              const message = "The run stopped before this tool call could execute.";
              await recordTool("ToolCallRejected", call, { attempt: 1, round, code, message });
              messages = [...messages, toolResultMessage(resultId, call.name, toolErrorContent(code, message))];
              continue;
            }

            const validation = registry.validateCall(call);
            if (!validation.accepted) {
              await recordTool("ToolCallRejected", call, {
                attempt: 1,
                round,
                code: validation.code,
                message: validation.message,
              });
              messages = [...messages, toolResultMessage(resultId, call.name, toolErrorContent(validation.code, validation.message))];
              continue;
            }

            await recordTool("ToolCallValidated", call, { attempt: 1, round });
            const policy = registry.authorize(call);
            if (!policy.allowed) {
              await recordTool("ToolPolicyDenied", call, {
                attempt: 1,
                round,
                code: policy.code,
                message: policy.message,
              });
              messages = [...messages, toolResultMessage(resultId, call.name, toolErrorContent(policy.code, policy.message))];
              continue;
            }

            if (toolAttemptCount >= toolConfiguration.maxCalls) {
              callLimitExceeded = true;
              const code = "TOOL_CALL_LIMIT_EXCEEDED";
              const message = "The run reached its maximum tool-call limit.";
              await recordTool("ToolCallRejected", call, { attempt: 1, round, code, message });
              messages = [...messages, toolResultMessage(resultId, call.name, toolErrorContent(code, message))];
              continue;
            }

            toolAttemptCount += 1;
            const toolPhase = { name: `tool_execution_${round}_${index + 1}`, startedAt: await ctx.date.toJSON(), finishedAt: null as string | null };
            phases.push(toolPhase);
            await recordTool("ToolExecutionStarted", call, { attempt: 1, round });
            const toolResult = await ctx.run(
              `tool.execute.${round}.${index + 1}.${stableStepId(call.toolCallId)}`,
              () => registry.execute(validation, {
                runId: input.runId,
                turnId,
                signal: ctx.request().attemptCompletedSignal,
              }),
              { maxRetryAttempts: 1 },
            );
            await completePhase(toolPhase);
            await recordTool(toolEventKind(toolResult), call, toolPayload(toolResult, round));
            messages = [...messages, toolResultMessage(resultId, call.name, toolResult.content)];

            if (toolResult.status !== "completed") executionHalted = true;
          }

          if (executionHalted) {
            const failure = internalFailure("TOOL_EXECUTION_FAILED", "A tool execution did not complete, so the run was stopped.", "provider");
            await record("AgentFailed", { code: failure.code, failureKind: failure.failureKind, round });
            await completePhase(executionPhase);
            await record("RunFailed", { code: failure.code, failureKind: failure.failureKind });
            return finish(input.runId, "failed", startedAt, null, failure, usage, modelCallCount, modelAttemptCount, toolCallCount, toolAttemptCount, events, phases);
          }

          if (callLimitExceeded) {
            const failure = internalFailure("TOOL_CALL_LIMIT_EXCEEDED", "The run reached its maximum tool-call limit.", "validation");
            await record("AgentFailed", { code: failure.code, failureKind: failure.failureKind, round });
            await completePhase(executionPhase);
            await record("RunFailed", { code: failure.code, failureKind: failure.failureKind });
            return finish(input.runId, "failed", startedAt, null, failure, usage, modelCallCount, modelAttemptCount, toolCallCount, toolAttemptCount, events, phases);
          }

          if (round === toolConfiguration.maxRounds) {
            const failure = internalFailure("TOOL_ROUND_LIMIT_EXCEEDED", "The model did not return final text within the tool round limit.", "validation");
            await record("AgentFailed", { code: failure.code, failureKind: failure.failureKind, round });
            await completePhase(executionPhase);
            await record("RunFailed", { code: failure.code, failureKind: failure.failureKind });
            return finish(input.runId, "failed", startedAt, null, failure, usage, modelCallCount, modelAttemptCount, toolCallCount, toolAttemptCount, events, phases);
          }
        }

        const failure = internalFailure("TOOL_ROUND_LIMIT_EXCEEDED", "The model did not return final text within the tool round limit.", "validation");
        await record("AgentFailed", { code: failure.code, failureKind: failure.failureKind });
        await completePhase(executionPhase);
        await record("RunFailed", { code: failure.code, failureKind: failure.failureKind });
        return finish(input.runId, "failed", startedAt, null, failure, usage, modelCallCount, modelAttemptCount, toolCallCount, toolAttemptCount, events, phases);
      } catch (error) {
        // RetryableError is meaningful only inside ctx.run. Let the durable
        // action own that retry rather than converting it into a fake result.
        if (error instanceof restate.RetryableError) throw error;
        await completePhase(executionPhase);
        const failure = classifyWorkflowError(error);
        const eventKind = failure.failureKind === "cancelled" ? "AgentCancelled" : "AgentFailed";
        await record(eventKind, { code: failure.code, failureKind: failure.failureKind });
        await record(failure.failureKind === "cancelled" ? "RunCancelled" : "RunFailed", {
          code: failure.code,
          failureKind: failure.failureKind,
        });
        return finish(
          input.runId,
          failure.failureKind === "cancelled" ? "cancelled" : "failed",
          startedAt,
          null,
          failure,
          usage,
          modelCallCount,
          modelAttemptCount,
          toolCallCount,
          toolAttemptCount,
          events,
          phases,
        );
      }
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

async function requestModel(
  ctx: restate.WorkflowContext,
  input: RestateWorkflowInput,
  round: number,
  attempt: number,
  messages: readonly ModelMessage[],
  tools: readonly ToolDefinition[],
): Promise<ModelCallResult> {
  return ctx.run(
    `model.request.${round}.attempt.${attempt}`,
    async (): Promise<ModelCallResult> => {
      const model = createRestateModel(input.model.provider, input.model.model, {
        openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || null,
        openRouterBaseUrl: process.env.AGENTLAB_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      });
      const result = await model.complete(
        {
          runId: input.runId,
          prompt: input.prompt,
          systemInstruction: input.systemInstruction,
          provider: input.model.provider,
          model: input.model.model,
          round,
          attempt,
          messages,
          tools,
        },
        ctx.request().attemptCompletedSignal,
      );
      return result;
    },
    {
      // Provider-level pre-dispatch retries are explicit workflow steps so
      // normalized evidence can report each attempt. Restate still journals
      // every action and can replay it after a worker crash.
      maxRetryAttempts: 1,
      initialRetryInterval: RESTATE_DEFAULT_RUN_RETRY_INTERVAL_MS,
      maxRetryInterval: RESTATE_DEFAULT_RUN_MAX_RETRY_INTERVAL_MS,
      retryIntervalFactor: 2,
    },
  );
}

function assistantMessage(result: ModelSuccess): ModelMessage {
  return {
    role: "assistant",
    content: result.output,
    ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}),
  };
}

function toolResultMessage(toolCallId: string, name: string, content: string): ModelMessage {
  return { role: "tool", toolCallId, name, content };
}

type ToolEventDetails = Omit<ToolLifecyclePayload, "toolCallId" | "toolName">;

function toolPayload(result: ToolExecutionResult, round: number): ToolEventDetails {
  return {
    round,
    attempt: result.attemptCount,
    status: result.status,
    durationMs: result.durationMs,
    resultBytes: Buffer.byteLength(result.content, "utf8"),
    ...(result.error ? { code: result.error.code, message: result.error.message } : {}),
  };
}

function toolEventKind(result: ToolExecutionResult): string {
  if (result.status === "completed") return "ToolExecutionCompleted";
  if (result.status === "cancelled" || result.status === "timed_out") return "ToolExecutionCancelled";
  return "ToolExecutionFailed";
}

function toolErrorContent(code: string, message: string): string {
  return JSON.stringify({ error: boundedEventText(message, 512), code: boundedEventText(code, 128) });
}

function boundedEventText(value: unknown, maxBytes: number): string {
  if (typeof value !== "string" || value.length === 0) return "";
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let result = value.slice(0, maxBytes);
  while (Buffer.byteLength(result, "utf8") > maxBytes) result = result.slice(0, -1);
  return result;
}

function contextUsagePayload(input: RestateWorkflowInput, usage: RunUsage, round: number): Record<string, unknown> {
  const inputTokens = usage.inputTokens;
  const budget = calculateContextBudget(
    input.model.contextWindowTokens ?? null,
    {
      tokens: inputTokens,
      quality: inputTokens === null ? "unknown" : "exact",
      basis: inputTokens === null ? "provider-usage-unavailable" : "provider-reported-prompt-tokens",
    },
    {
      reservedOutputTokens: 4_096,
      safetyMarginTokens: 1_024,
      compactionThresholdPercent: 20,
    },
  );
  return {
    round,
    contextWindowTokens: budget.contextWindowTokens,
    inputTokens: budget.inputTokens,
    reservedOutputTokens: budget.reservedOutputTokens,
    safetyMarginTokens: budget.safetyMarginTokens,
    remainingTokens: budget.remainingTokens,
    remainingPercent: budget.remainingPercent,
    pressure: budget.pressure,
    quality: budget.quality,
    tokenizerBasis: budget.tokenizerBasis,
  };
}

function stableStepId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return sanitized || "anonymous";
}

function normalizeToolConfiguration(input: RestateWorkflowInput["tools"] | undefined): RestateWorkflowInput["tools"] {
  if (!input) return DEFAULT_TOOL_CONFIGURATION;
  const enabledNames = input.enabledNames.filter((name) => typeof name === "string");
  return {
    enabledNames: enabledNames.length > 0 ? enabledNames : DEFAULT_TOOL_CONFIGURATION.enabledNames,
    maxRounds: positiveInteger(input.maxRounds, DEFAULT_TOOL_CONFIGURATION.maxRounds),
    maxCalls: positiveInteger(input.maxCalls, DEFAULT_TOOL_CONFIGURATION.maxCalls),
  };
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function finish(
  runId: string,
  status: "completed" | "failed" | "cancelled",
  startedAt: string,
  output: string | null,
  error: RunError | null,
  usage: RunUsage,
  modelCallCount: number,
  modelAttemptCount: number,
  toolCallCount: number,
  toolAttemptCount: number,
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
    modelCallCount,
    modelAttemptCount,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    costUsd: null,
    toolCallCount,
    toolAttemptCount,
  };
  return {
    schemaVersion: 1,
    runId,
    status,
    startedAt,
    finishedAt,
    output,
    error,
    attemptCount: modelAttemptCount,
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

function internalFailure(code: string, message: string, failureKind: RunError["failureKind"] = "internal"): RunError {
  return { code, message, failureKind, retryable: false };
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

function addUsage(left: RunUsage, right: RunUsage): RunUsage {
  return {
    inputTokens: addNullable(left.inputTokens, right.inputTokens),
    outputTokens: addNullable(left.outputTokens, right.outputTokens),
    totalTokens: addNullable(left.totalTokens, right.totalTokens),
  };
}

function addNullable(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}
