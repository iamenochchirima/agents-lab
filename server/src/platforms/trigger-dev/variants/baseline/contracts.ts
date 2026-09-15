import type {
  ModelProvider,
  RunEventIntent,
  RunError,
  RunMetrics,
  RunResult,
  RunTrajectory,
  RunUsage,
} from "../../../../control-plane/domain/types.js";

export interface TriggerPromptPayload {
  readonly runId: string;
  readonly prompt: string;
  readonly systemInstruction: string;
  readonly model: {
    readonly provider: ModelProvider;
    readonly model: string;
  };
}

export interface TriggerTaskOutput {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly output: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly attemptCount: number;
  readonly usage: RunUsage;
  readonly eventIntents: readonly RunEventIntent[];
  readonly trajectory: RunTrajectory;
  readonly metrics: RunMetrics;
}

export class TriggerBaselineTaskError extends Error {
  constructor(
    readonly code: string,
    readonly failureKind: RunError["failureKind"],
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}
