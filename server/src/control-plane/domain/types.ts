export const RUN_STATUSES = [
  "created",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "reconciliation_required",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type TerminalRunStatus = "completed" | "failed" | "cancelled" | "reconciliation_required";
export type ModelProvider = "fake" | "openrouter";
export type FailureKind =
  | "validation"
  | "configuration"
  | "pre_dispatch"
  | "provider"
  | "timeout"
  | "cancelled"
  | "outcome_unknown"
  | "internal"
  | "reconciliation";

export interface RunRequest {
  readonly platform: string;
  readonly variant: string;
  readonly task: {
    readonly kind: "prompt";
    readonly prompt: string;
  };
  readonly model: {
    readonly provider: string;
    readonly model: string;
  };
  readonly experiment?: undefined;
}

export interface RunManifest {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly createdAt: string;
  readonly serverVersion: string;
  readonly platform: string;
  readonly variant: string;
  readonly task: {
    readonly kind: "prompt";
    readonly prompt: string;
  };
  readonly context: {
    readonly systemInstruction: string;
  };
  readonly platformConfig: Readonly<Record<string, unknown>>;
  readonly model: {
    readonly provider: ModelProvider;
    readonly model: string;
  };
}

/**
 * The server keeps only the identity needed to call the selected runner again.
 * Native details are retained for inspection, but the common server must not
 * interpret their platform-specific shape.
 */
export interface PlatformExecutionReference {
  readonly platform: string;
  readonly variant: string;
  readonly executionId: string;
  readonly native: Readonly<Record<string, unknown>>;
}

export interface RunEvent<TPayload = Record<string, unknown>> {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly recordedSequence: number;
  readonly source: string;
  readonly sourceSequence: number;
  readonly kind: string;
  readonly runId: string;
  readonly occurredAt: string;
  readonly payload: TPayload;
}

export interface RunEventIntent<TPayload = Record<string, unknown>> {
  readonly source: string;
  readonly sourceSequence: number;
  readonly kind: string;
  readonly runId: string;
  readonly occurredAt: string;
  readonly payload: TPayload;
}

export interface RunError {
  readonly code: string;
  readonly message: string;
  readonly failureKind: FailureKind;
  readonly retryable: boolean;
}

export interface RunUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

export interface RunResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly status: TerminalRunStatus;
  readonly startedAt: string | null;
  readonly finishedAt: string;
  readonly output: string | null;
  readonly error: RunError | null;
  readonly attemptCount: number;
  readonly usage: RunUsage;
}

export interface RunTrajectory {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly phases: readonly {
    readonly name: string;
    readonly startedAt: string;
    readonly finishedAt: string | null;
  }[];
}

export interface RunMetrics {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly status: TerminalRunStatus;
  readonly durationMs: number | null;
  readonly modelCallCount: number;
  readonly modelAttemptCount: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly costUsd: number | null;
}
