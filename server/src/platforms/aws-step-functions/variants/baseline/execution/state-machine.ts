import { createHash } from "node:crypto";

import type { AwsStepFunctionsConfig } from "../../../config.js";
import type { AwsStepFunctionsRunInput } from "../contracts.js";

export interface AwsStepFunctionsStateMachineDefinition {
  readonly Comment: string;
  readonly StartAt: "RequestModel";
  readonly TimeoutSeconds: number;
  readonly Version: "1.0";
  readonly States: {
    readonly RequestModel: {
      readonly Type: "Task";
      readonly Resource: string;
      readonly Parameters: Readonly<Record<string, string>>;
      readonly TimeoutSeconds: number;
      readonly Retry: readonly {
        readonly ErrorEquals: readonly string[];
        readonly IntervalSeconds: number;
        readonly MaxAttempts: number;
        readonly BackoffRate: number;
      }[];
      readonly End: true;
    };
  };
}

export function buildStateMachineDefinition(
  activityArn: string,
  config: Pick<
    AwsStepFunctionsConfig,
    "executionTimeoutSeconds" | "activityTimeoutSeconds" | "retryIntervalSeconds" | "retryMaxAttempts" | "retryBackoffRate"
  >,
): AwsStepFunctionsStateMachineDefinition {
  return {
    Comment: "Agent Harness Lab Standard baseline using an Activity worker.",
    StartAt: "RequestModel",
    TimeoutSeconds: config.executionTimeoutSeconds,
    Version: "1.0",
    States: {
      RequestModel: {
        Type: "Task",
        Resource: activityArn,
        Parameters: {
          "runId.$": "$.runId",
          "prompt.$": "$.prompt",
          "systemInstruction.$": "$.systemInstruction",
          "provider.$": "$.provider",
          "model.$": "$.model",
          "attempt.$": "$$.State.RetryCount",
        },
        TimeoutSeconds: config.activityTimeoutSeconds,
        Retry: [
          {
            ErrorEquals: ["RetryableModelError", "States.Timeout"],
            IntervalSeconds: config.retryIntervalSeconds,
            MaxAttempts: config.retryMaxAttempts,
            BackoffRate: config.retryBackoffRate,
          },
        ],
        End: true,
      },
    },
  };
}

export function executionInputFromRun(run: AwsStepFunctionsRunInput): string {
  return JSON.stringify({
    runId: run.runId,
    prompt: run.prompt,
    systemInstruction: run.systemInstruction,
    provider: run.provider,
    model: run.model,
  });
}

/** Step Functions execution names are max 80 chars and reject punctuation. */
export function executionNameForRun(runId: string): string {
  const direct = `agentlab-${runId}`;
  if (direct.length <= 80 && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(direct)) return direct;
  return `agentlab-${createHash("sha256").update(runId).digest("hex").slice(0, 64)}`;
}

export function executionArnForStateMachine(
  stateMachineArn: string,
  executionName: string,
): string {
  const marker = ":stateMachine:";
  const markerIndex = stateMachineArn.indexOf(marker);
  if (markerIndex < 0) throw new Error("The Step Functions state-machine ARN has an invalid shape.");
  const prefix = stateMachineArn.slice(0, markerIndex);
  const name = stateMachineArn.slice(markerIndex + marker.length);
  return `${prefix}:execution:${name}:${executionName}`;
}
