import type {
  Context,
  HatchetClient,
  TaskWorkflowDeclaration,
} from "@hatchet-dev/typescript-sdk";

import type { HatchetConfig } from "../../../config.js";
import {
  HATCHET_TASK_OUTPUT_SCHEMA_VERSION,
  type HatchetModelCallResult,
  type HatchetPromptInput,
  type HatchetTaskOutput,
} from "../contracts.js";
import { createHatchetModelAdapter } from "../models/factory.js";

export class HatchetRetryableTaskError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HatchetRetryableTaskError";
  }
}

/**
 * Creates the one-task baseline declaration. The declaration is created by
 * the worker host and is also passed to the runner so the task name and retry
 * policy cannot drift between submission and worker registration.
 */
export function createHatchetBaselineTask(
  client: HatchetClient,
  config: HatchetConfig,
): TaskWorkflowDeclaration<HatchetPromptInput, HatchetTaskOutput> {
  return client.task<HatchetPromptInput, HatchetTaskOutput>({
    name: config.taskName,
    retries: config.retries,
    executionTimeout: `${Math.ceil(config.executionTimeoutMs / 1_000)}s`,
    scheduleTimeout: `${Math.ceil(config.scheduleTimeoutMs / 1_000)}s`,
    backoff: {
      factor: config.retryBackoffFactor,
      maxSeconds: config.retryBackoffMaxSeconds,
    },
    idempotency: {
      strategy: "status",
      expression: "input.runId",
      fallbackTtlMs: config.idempotencyFallbackTtlMs,
    },
    fn: async (input, context) => executeHatchetTask(input, context, config),
  });
}

export async function executeHatchetTask(
  input: HatchetPromptInput,
  context: Context<HatchetPromptInput>,
  config: Pick<HatchetConfig, "openRouterApiKey" | "openRouterBaseUrl">,
  clock: () => Date = () => new Date(),
): Promise<HatchetTaskOutput> {
  validateInput(input);

  const startedAt = clock().toISOString();
  const attemptNumber = context.retryCount() + 1;
  const attemptId = safeAttemptId(context);
  const eventIntents = [
    event(input.runId, 1, "AgentStarted", startedAt, { attemptNumber }),
    event(input.runId, 2, "ModelRequested", startedAt, {
      provider: input.model.provider,
      model: input.model.model,
      attemptNumber,
    }),
  ];

  try {
    const adapter = createHatchetModelAdapter(input.model.provider, config);
    const modelResult = await adapter.complete(
      {
        runId: input.runId,
        prompt: input.prompt,
        systemInstruction: input.systemInstruction,
        provider: input.model.provider,
        model: input.model.model,
        attemptId,
        attemptNumber,
      },
      context.abortController.signal,
    );
    context.rethrowIfCancelled(
      modelResult.kind === "failure"
        ? new Error(modelResult.message)
        : undefined,
    );

    if (
      modelResult.kind === "failure" &&
      modelResult.failureKind === "pre_dispatch"
    ) {
      throw new HatchetRetryableTaskError(
        modelResult.code,
        modelResult.message,
      );
    }

    const finishedAt = clock().toISOString();
    const result = resultFromModel(
      input,
      modelResult,
      startedAt,
      finishedAt,
      attemptNumber,
    );
    const terminalKind =
      result.status === "completed" ? "AgentCompleted" : "AgentFailed";
    eventIntents.push(
      event(input.runId, 3, "ModelResponded", finishedAt, {
        outcome: modelResult.kind,
        requestSent:
          modelResult.kind === "failure" ? modelResult.requestSent : true,
      }),
      event(input.runId, 4, terminalKind, finishedAt, {
        status: result.status,
      }),
    );

    return {
      schemaVersion: HATCHET_TASK_OUTPUT_SCHEMA_VERSION,
      runId: input.runId,
      result,
      trajectory: {
        schemaVersion: 1,
        runId: input.runId,
        phases: [
          { name: "agent-execution", startedAt, finishedAt },
          { name: "model-request", startedAt, finishedAt },
        ],
      },
      metrics: {
        schemaVersion: 1,
        runId: input.runId,
        status: result.status,
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
        modelCallCount: 1,
        modelAttemptCount: attemptNumber,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        costUsd: null,
      },
      eventIntents,
    };
  } catch (error) {
    context.rethrowIfCancelled(error);
    throw error;
  }
}

function resultFromModel(
  input: HatchetPromptInput,
  modelResult: HatchetModelCallResult,
  startedAt: string,
  finishedAt: string,
  attemptNumber: number,
) {
  if (modelResult.kind === "success") {
    return {
      schemaVersion: 1 as const,
      runId: input.runId,
      status: "completed" as const,
      startedAt,
      finishedAt,
      output: modelResult.output,
      error: null,
      attemptCount: attemptNumber,
      usage: modelResult.usage,
    };
  }

  return {
    schemaVersion: 1 as const,
    runId: input.runId,
    status:
      modelResult.failureKind === "outcome_unknown"
        ? ("reconciliation_required" as const)
        : ("failed" as const),
    startedAt,
    finishedAt,
    output: null,
    error: {
      code: modelResult.code,
      message: modelResult.message,
      failureKind: modelResult.failureKind,
      retryable: false,
    },
    attemptCount: attemptNumber,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function event(
  runId: string,
  sourceSequence: number,
  kind: string,
  occurredAt: string,
  payload: Record<string, unknown>,
) {
  return {
    source: "hatchet-task",
    sourceSequence,
    kind,
    runId,
    occurredAt,
    payload,
  };
}

function validateInput(input: HatchetPromptInput): void {
  if (!input || typeof input !== "object")
    throw new Error("Hatchet task input must be an object.");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.runId))
    throw new Error("Hatchet task input has an invalid run ID.");
  if (typeof input.prompt !== "string" || input.prompt.trim().length === 0)
    throw new Error("Hatchet task prompt must not be empty.");
  if (typeof input.systemInstruction !== "string")
    throw new Error("Hatchet task system instruction must be a string.");
  if (
    !input.model ||
    (input.model.provider !== "fake" && input.model.provider !== "openrouter")
  ) {
    throw new Error("Hatchet task model provider must be fake or openrouter.");
  }
  if (
    typeof input.model.model !== "string" ||
    input.model.model.trim().length === 0
  ) {
    throw new Error("Hatchet task model name must not be empty.");
  }
}

function safeAttemptId(
  context: Pick<Context<HatchetPromptInput>, "taskRunExternalId">,
): string {
  try {
    return context.taskRunExternalId();
  } catch {
    return "local-attempt";
  }
}
