import type {
  RunError,
  RunEventIntent,
  RunMetrics,
  RunResult,
  RunTrajectory,
  RunUsage,
} from "../../../../control-plane/domain/types.js";

export type InngestRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface InngestRunInput {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly provider: "fake" | "openrouter";
  readonly model: string;
}

export interface InngestModelRequest {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly provider: "fake" | "openrouter";
  readonly model: string;
  readonly attempt: number;
}

export type InngestModelResult =
  | {
      readonly kind: "success";
      readonly output: string;
      readonly providerRequestId: string | null;
      readonly usage: RunUsage;
    }
  | {
      readonly kind: "failure";
      readonly code: string;
      readonly message: string;
      readonly failureKind: RunError["failureKind"];
      readonly retryable: boolean;
      readonly requestSent: boolean;
    };

export interface InngestEventIntent extends RunEventIntent {
  readonly key: string;
}

export interface InngestRunRecord {
  readonly runId: string;
  readonly status: InngestRunStatus;
  readonly deduplicationId: string;
  readonly eventId: string | null;
  readonly functionRunId: string | null;
  readonly modelProvider: "fake" | "openrouter";
  readonly model: string;
  readonly submissionOutcome: "not_submitted" | "accepted" | "already_accepted" | "unknown";
  readonly dispatchErrorCode: string | null;
  readonly cancelEventId: string | null;
  readonly cancellationRequested: boolean;
  readonly attemptCount: number;
  readonly events: readonly InngestEventIntent[];
  readonly trajectory: RunTrajectory | null;
  readonly metrics: RunMetrics | null;
  readonly result: RunResult | null;
  readonly admittedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface InngestPublicRunRecord {
  readonly runId: string;
  readonly status: InngestRunStatus;
  readonly deduplicationId: string;
  readonly eventId: string | null;
  readonly functionRunId: string | null;
  readonly modelProvider: "fake" | "openrouter";
  readonly model: string;
  readonly submissionOutcome: InngestRunRecord["submissionOutcome"];
  readonly dispatchErrorCode: string | null;
  readonly cancelEventId: string | null;
  readonly cancellationRequested: boolean;
  readonly attemptCount: number;
  readonly events: readonly InngestEventIntent[];
  readonly trajectory: RunTrajectory | null;
  readonly metrics: RunMetrics | null;
  readonly result: RunResult | null;
  readonly admittedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface InngestServiceHealth {
  readonly status: "ready" | "degraded";
  readonly service: { readonly reachable: true };
  readonly devServer: { readonly reachable: boolean; readonly message: string };
  readonly functionEndpoint: string;
}

export const INNGEST_SOURCE = "inngest";
