import type {
  PlatformExecutionReference,
  RunError,
  RunMetrics,
  RunResult,
  RunTrajectory,
} from "../../../../control-plane/domain/types.js";

export const AWS_STEP_FUNCTIONS_NATIVE_SCHEMA_VERSION = 1 as const;
export const AWS_STEP_FUNCTIONS_EVENT_SOURCE = "aws-step-functions" as const;

export interface AwsStepFunctionsRunInput {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly provider: "fake" | "openrouter";
  readonly model: string;
}

export interface AwsStepFunctionsActivityInput extends AwsStepFunctionsRunInput {
  /** Comes from the ASL Context object and increments on a Step Functions retry. */
  readonly attempt: number;
}

export type AwsStepFunctionsModelResult =
  | {
      readonly kind: "success";
      readonly output: string;
      readonly providerRequestId: string | null;
      readonly usage: {
        readonly inputTokens: number | null;
        readonly outputTokens: number | null;
        readonly totalTokens: number | null;
      };
    }
  | {
      readonly kind: "failure";
      readonly code: string;
      readonly message: string;
      readonly failureKind: RunError["failureKind"];
      readonly retryable: boolean;
      readonly requestSent: boolean;
    };

export interface AwsStepFunctionsActivityOutput {
  readonly schemaVersion: 1;
  readonly result: RunResult;
  readonly trajectory: RunTrajectory;
  readonly metrics: RunMetrics;
  readonly providerRequestId: string | null;
}

export interface AwsStepFunctionsNativeReference {
  readonly schemaVersion: 1;
  readonly profile: "local" | "aws";
  readonly region: string;
  readonly endpointUrl: string | null;
  readonly stateMachineName: string;
  readonly stateMachineArn: string | null;
  readonly activityName: string;
  readonly activityArn: string | null;
  readonly executionName: string;
  readonly executionArn: string | null;
  readonly startDate: string | null;
  readonly stopDate: string | null;
  readonly nativeStatus: string;
  readonly terminalStatus: string | null;
  readonly nativeError: string | null;
  readonly nativeCause: string | null;
  readonly historyEventCount: number;
  readonly lastHistoryEventType: string | null;
  readonly retryCount: number;
  readonly providerRequestId?: string | null;
  readonly submissionOutcome: "accepted" | "already_accepted" | "unknown";
  readonly acknowledgement: "confirmed" | "unknown";
}

export interface AwsStepFunctionsPublicRunRecord {
  readonly runId: string;
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled" | "reconciliation_required";
  readonly reference: PlatformExecutionReference;
  readonly eventIntents: readonly import("../../../../control-plane/domain/types.js").RunEventIntent[];
  readonly result: RunResult | null;
  readonly trajectory: RunTrajectory | null;
  readonly metrics: RunMetrics | null;
}

export interface AwsStepFunctionsAdmitResponse {
  readonly runId: string;
  readonly stateMachineArn: string;
  readonly activityArn: string;
  readonly executionName: string;
}

export interface AwsStepFunctionsDispatchResponse {
  readonly runId: string;
  readonly stateMachineArn: string;
  readonly activityArn: string;
  readonly executionName: string;
  readonly executionArn: string | null;
  readonly startDate: string | null;
  readonly submissionOutcome: "accepted" | "already_accepted" | "unknown";
  readonly acknowledgement: "confirmed" | "unknown";
}

export function inputFromRun(
  run: AwsStepFunctionsRunInput,
): AwsStepFunctionsRunInput {
  return {
    runId: run.runId,
    prompt: run.prompt,
    systemInstruction: run.systemInstruction,
    provider: run.provider,
    model: run.model,
  };
}
