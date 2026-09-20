import type {
  RunEventIntent,
  RunManifest,
  RunMetrics,
  PlatformExecutionReference,
  RunResult,
  RunTrajectory,
} from "../domain/types.js";

export type RunnerExecutionStatus = "queued" | "running" | "suspended" | "completed" | "failed" | "cancelled";

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

export interface RunnerResumeResult {
  readonly accepted: boolean;
  readonly alreadyTerminal: boolean;
  readonly message: string;
}

export interface RunnerInspection {
  readonly status: RunnerExecutionStatus;
  readonly reference: PlatformExecutionReference;
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
  /** Returns safe, immutable settings to include in the run manifest. */
  manifestConfiguration(): Readonly<Record<string, unknown>>;
  validate(manifest: RunManifest): RunnerValidationResult;
  checkConnection(): Promise<RunnerConnectivity>;
  start(manifest: RunManifest): Promise<PlatformExecutionReference>;
  /**
   * Allows a platform with a provider-specific overflow signal to prepare one
   * bounded context recovery attempt. The common service calls this at most
   * once for a Lab run and retains the returned native reference.
   */
  recoverContextOverflow?(manifest: RunManifest, reference: PlatformExecutionReference): Promise<PlatformExecutionReference>;
  cancel(reference: PlatformExecutionReference, reason: string): Promise<RunnerCancellationResult>;
  /** Resumes a native suspended execution when the platform supports it. */
  resume?(reference: PlatformExecutionReference, input: unknown): Promise<RunnerResumeResult>;
  inspect(reference: PlatformExecutionReference): Promise<RunnerInspection>;
  /** Releases platform-local workers or client connections when the server stops. */
  close?(): Promise<void>;
}
