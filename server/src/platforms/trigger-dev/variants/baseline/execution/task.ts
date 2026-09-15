import { task } from "@trigger.dev/sdk";

import { TRIGGER_TASK_IDENTIFIER } from "../../../config.js";
import {
  TriggerBaselineTaskError,
  type TriggerPromptPayload,
  type TriggerTaskOutput,
} from "../contracts.js";

const FAKE_MODEL_NAMES = new Set([
  "fake",
  "fake-success",
  "fake-slow",
  "fake-provider-failure",
  "fake-ambiguous",
  "fake-retry",
]);

/**
 * The task is deliberately a platform task, not a server-side shortcut. In
 * local development Trigger's scheduler admits this task and the Trigger
 * worker executes it in its own Node process.
 */
export const triggerBaselineTask = task({
  id: TRIGGER_TASK_IDENTIFIER,
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 100,
    maxTimeoutInMs: 1_000,
    factor: 2,
    randomize: false,
  },
  maxDuration: 60,
  run: async (
    payload: TriggerPromptPayload,
    { ctx, signal }: { readonly ctx: { readonly attempt: { readonly number: number } }; readonly signal: AbortSignal },
  ): Promise<TriggerTaskOutput> => {
    assertPayload(payload);
    const startedAt = new Date().toISOString();
    const attemptCount = ctx.attempt.number;
    const events: Array<import("../../../../../control-plane/domain/types.js").RunEventIntent> = [
      event(payload, 1, "TaskStarted", startedAt, { attempt: attemptCount }),
      event(payload, 2, "ModelRequested", startedAt, { provider: payload.model.provider, model: payload.model.model }),
    ];

    if (payload.model.model === "fake-provider-failure") {
      throw new TriggerBaselineTaskError(
        "TRIGGER_FAKE_PROVIDER_FAILURE",
        "provider",
        "The deterministic Trigger.dev fake model rejected the request.",
      );
    }

    if (payload.model.model === "fake-ambiguous") {
      throw new TriggerBaselineTaskError(
        "TRIGGER_FAKE_OUTCOME_UNKNOWN",
        "outcome_unknown",
        "The deterministic Trigger.dev fake model completed dispatch without a confirmed provider outcome.",
      );
    }

    if (payload.model.model === "fake-retry" && attemptCount === 1) {
      throw new TriggerBaselineTaskError(
        "TRIGGER_FAKE_RETRYABLE_FAILURE",
        "internal",
        "The deterministic Trigger.dev retry fixture fails on its first attempt.",
      );
    }

    if (payload.model.model === "fake-slow") {
      await waitWithSignal(2_000, signal);
    }

    const finishedAt = new Date().toISOString();
    const output = `Fake response: ${payload.prompt}`;
    events.push(
      event(payload, 3, "ModelCompleted", finishedAt, { outputLength: output.length }),
      event(payload, 4, "TaskCompleted", finishedAt, { attempt: attemptCount }),
    );
    const trajectory: TriggerTaskOutput["trajectory"] = {
      schemaVersion: 1,
      runId: payload.runId,
      phases: [
        { name: "trigger.task", startedAt, finishedAt },
        { name: "model.fake", startedAt, finishedAt },
      ],
    };
    return {
      schemaVersion: 1,
      runId: payload.runId,
      output,
      startedAt,
      finishedAt,
      attemptCount,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      eventIntents: events,
      trajectory,
      metrics: {
        schemaVersion: 1,
        runId: payload.runId,
        status: "completed",
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
        modelCallCount: 1,
        modelAttemptCount: 1,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
      },
    };
  },
});

function assertPayload(payload: TriggerPromptPayload): void {
  if (!payload || typeof payload !== "object" || payload.model.provider !== "fake" || !FAKE_MODEL_NAMES.has(payload.model.model)) {
    throw new TriggerBaselineTaskError(
      "TRIGGER_INVALID_TASK_PAYLOAD",
      "configuration",
      "The Trigger.dev baseline task received an unsupported fake model payload.",
    );
  }
}

function event(
  payload: TriggerPromptPayload,
  sourceSequence: number,
  kind: string,
  occurredAt: string,
  eventPayload: Record<string, unknown>,
): import("../../../../../control-plane/domain/types.js").RunEventIntent {
  return {
    source: "trigger-dev-task",
    sourceSequence,
    kind,
    runId: payload.runId,
    occurredAt,
    payload: eventPayload,
  };
}

async function waitWithSignal(durationMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, durationMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("Trigger.dev task was cancelled.");
  error.name = "AbortError";
  return error;
}
