import {
  GetActivityTaskCommand,
  SendTaskFailureCommand,
  SendTaskSuccessCommand,
} from "../aws-sdk.js";

import type { AwsStepFunctionsApi } from "../client.js";
import type { AwsStepFunctionsConfig } from "../config.js";
import type {
  AwsStepFunctionsActivityInput,
  AwsStepFunctionsActivityOutput,
  AwsStepFunctionsModelResult,
} from "../variants/baseline/contracts.js";
import type { AwsStepFunctionsModelRunner } from "../variants/baseline/models/factory.js";

export interface ActivityWorkerOptions {
  readonly api: AwsStepFunctionsApi;
  readonly config: Pick<AwsStepFunctionsConfig, "workerName" | "workerPollDelayMs">;
  readonly modelRunner: AwsStepFunctionsModelRunner;
  readonly now?: () => Date;
}

export type ActivityWorkerStatus = "stopped" | "running" | "degraded";

export interface ActivityWorkerHealth {
  readonly status: ActivityWorkerStatus;
  readonly lastError: string | null;
  readonly processedTaskCount: number;
}

/**
 * Polls one Step Functions Activity and returns each task through its token.
 * The worker deliberately does not retry a completion call after a transport
 * error: the token may already have been accepted, so the next observation is
 * the state machine's authoritative result.
 */
export class AwsStepFunctionsActivityWorker {
  private readonly now: () => Date;
  private readonly abortController = new AbortController();
  private loopPromise: Promise<void> | null = null;
  private activityArn: string | null = null;
  private status: ActivityWorkerStatus = "stopped";
  private lastError: string | null = null;
  private processedTaskCount = 0;

  constructor(private readonly options: ActivityWorkerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(activityArn: string): void {
    if (this.loopPromise) return;
    this.activityArn = activityArn;
    this.status = "running";
    this.lastError = null;
    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.abortController.abort();
    await this.loopPromise;
    this.loopPromise = null;
    this.status = "stopped";
  }

  health(): ActivityWorkerHealth {
    return {
      status: this.status,
      lastError: this.lastError,
      processedTaskCount: this.processedTaskCount,
    };
  }

  async processTask(taskToken: string, rawInput: string): Promise<void> {
    let completionAttempted = false;
    try {
      const input = parseActivityInput(rawInput);
      const startedAt = this.now();
      const modelResult = await this.options.modelRunner.run(input);
      const finishedAt = this.now();
      if (modelResult.kind === "success") {
        completionAttempted = true;
        await this.options.api.send(new SendTaskSuccessCommand({
          taskToken,
          output: JSON.stringify(successOutput(input, modelResult, startedAt, finishedAt)),
        }));
      } else {
        completionAttempted = true;
        await this.options.api.send(new SendTaskFailureCommand({
          taskToken,
          error: safeErrorName(modelResult.code, modelResult.retryable),
          cause: JSON.stringify({
            code: modelResult.code,
            message: redactText(modelResult.message),
            failureKind: modelResult.failureKind,
            retryable: modelResult.retryable,
            requestSent: modelResult.requestSent,
          }),
        }));
      }
      this.processedTaskCount += 1;
    } catch (error) {
      // Once a completion request has been sent, its acknowledgement is
      // ambiguous. Sending the opposite completion could duplicate or corrupt
      // the native task result if AWS accepted the first request.
      if (completionAttempted) throw error;
      // Invalid task input is a terminal worker error. A failure response lets
      // the state machine retain the error in its native execution history.
      completionAttempted = true;
      await this.options.api.send(new SendTaskFailureCommand({
        taskToken,
        error: "ActivityWorkerError",
        cause: JSON.stringify({
          code: "ActivityWorkerError",
          message: redactText(safeMessage(error, "Activity worker could not process the task.")),
          failureKind: "internal",
          retryable: false,
          requestSent: false,
        }),
      }));
    }
  }

  private async runLoop(): Promise<void> {
    const activityArn = this.activityArn;
    if (!activityArn) throw new Error("The Activity worker cannot start without an Activity ARN.");

    while (!this.abortController.signal.aborted) {
      try {
        const response = await this.options.api.send(
          new GetActivityTaskCommand({ activityArn, workerName: this.options.config.workerName }),
          { abortSignal: this.abortController.signal },
        ) as { readonly input?: string; readonly taskToken?: string };
        if (response.taskToken && response.input !== undefined) {
          await this.processTask(response.taskToken, response.input);
        } else {
          await wait(this.options.config.workerPollDelayMs, this.abortController.signal);
        }
      } catch (error) {
        if (this.abortController.signal.aborted) return;
        this.status = "degraded";
        this.lastError = redactText(safeMessage(error, "Activity polling failed."));
        await wait(this.options.config.workerPollDelayMs, this.abortController.signal);
        if (!this.abortController.signal.aborted) this.status = "running";
      }
    }
  }
}

function parseActivityInput(value: string): AwsStepFunctionsActivityInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Step Functions Activity input is not valid JSON.");
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.runId !== "string" ||
    typeof parsed.prompt !== "string" ||
    typeof parsed.systemInstruction !== "string" ||
    (parsed.provider !== "fake" && parsed.provider !== "openrouter") ||
    typeof parsed.model !== "string" ||
    typeof parsed.attempt !== "number" ||
    !Number.isInteger(parsed.attempt) ||
    parsed.attempt < 0
  ) {
    throw new Error("Step Functions Activity input does not match the baseline contract.");
  }
  return parsed as unknown as AwsStepFunctionsActivityInput;
}

function successOutput(
  input: AwsStepFunctionsActivityInput,
  result: Extract<AwsStepFunctionsModelResult, { kind: "success" }>,
  startedAt: Date,
  finishedAt: Date,
): AwsStepFunctionsActivityOutput {
  const started = startedAt.toISOString();
  const finished = finishedAt.toISOString();
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
  return {
    schemaVersion: 1,
    result: {
      schemaVersion: 1,
      runId: input.runId,
      status: "completed",
      startedAt: started,
      finishedAt: finished,
      output: result.output,
      error: null,
      attemptCount: input.attempt + 1,
      usage: result.usage,
    },
    trajectory: {
      schemaVersion: 1,
      runId: input.runId,
      phases: [{ name: "model-call", startedAt: started, finishedAt: finished }],
    },
    metrics: {
      schemaVersion: 1,
      runId: input.runId,
      status: "completed",
      durationMs,
      modelCallCount: 1,
      modelAttemptCount: 1,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      costUsd: null,
    },
    providerRequestId: result.providerRequestId,
  };
}

function safeErrorName(code: string, retryable: boolean): string {
  if (retryable) return "RetryableModelError";
  const normalized = code.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 200);
  return normalized || "ActivityWorkerError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/(?:api[_-]?key|secret|password)\s*[:=]\s*[^\s,}]+/gi, "$1=[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .slice(0, 32_768);
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
