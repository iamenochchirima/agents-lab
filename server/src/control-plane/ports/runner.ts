import type {
  RunEventIntent,
  RunManifest,
  RunMetrics,
  RunResult,
  RunTrajectory,
  WorkflowExecutionReference,
} from "../domain/types.js";

export type RunnerExecutionStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface RunnerValidationResult {
  readonly valid: boolean;
  readonly reason: string | null;
}

export interface RunnerConnectivity {
  readonly reachable: boolean;
  readonly message: string;
}

export interface RunnerCancellationResult {
  readonly accepted: boolean;
  readonly alreadyTerminal: boolean;
  readonly message: string;
}

export interface RunnerInspection {
  readonly status: RunnerExecutionStatus;
  readonly reference: WorkflowExecutionReference;
  readonly eventIntents: readonly RunEventIntent[];
  readonly result: RunResult | null;
  readonly trajectory: RunTrajectory | null;
  readonly metrics: RunMetrics | null;
}

/**
 * The server's intentionally small runner seam. A platform adapter may
 * have richer native APIs, but those details stay behind this boundary.
 */
export interface PlatformRunner {
  readonly platform: RunManifest["platform"];
  readonly variant: RunManifest["variant"];
  validate(manifest: RunManifest): RunnerValidationResult;
  checkConnection(): Promise<RunnerConnectivity>;
  start(manifest: RunManifest): Promise<WorkflowExecutionReference>;
  cancel(reference: WorkflowExecutionReference, reason: string): Promise<RunnerCancellationResult>;
  inspect(reference: WorkflowExecutionReference): Promise<RunnerInspection>;
}
