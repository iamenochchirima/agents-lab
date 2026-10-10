export type { RunExecutionPolicy, RunExecutionRequest } from "../../capabilities/execution/policy.js";
import type { RunExecutionPolicy, RunExecutionRequest } from "../../capabilities/execution/policy.js";
import type { ToolCatalogSnapshot } from "../../capabilities/extensions/contracts.js";
export const RUN_STATUSES = [
  "created",
  "queued",
  "running",
  "suspended",
  "completed",
  "failed",
  "cancelled",
  "reconciliation_required",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type TerminalRunStatus = "completed" | "failed" | "cancelled" | "reconciliation_required";
export type ModelProvider = "fake" | "openrouter";
import type { CapabilityApproval, CapabilityResolution } from "../../capabilities/contracts.js";
import type { CapabilityInventorySnapshot } from "../../capabilities/contracts.js";
import type { ConnectionBinding } from "../../capabilities/integrations/contracts.js";
import type { SkillSummary } from "../../capabilities/skills/index.js";
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

/**
 * User-selected Lab configuration retained with a run. Platform-native
 * settings remain in `platformConfig`; this object records what the UI chose
 * so a run can be reproduced without teaching the common server platform APIs.
 */
export interface RunSelection {
  readonly scenarioId?: string;
  readonly environmentId?: string;
  readonly backendProfileId?: string;
  readonly infrastructureId?: string;
  readonly experimentId?: string;
}

export interface RunCapabilities {
  /** Resolved once by trusted admission, never accepted from a browser. */
  readonly toolCatalog?: ToolCatalogSnapshot;
  /** Human-readable capability metadata projected from the admitted catalog. */
  readonly inventory?: CapabilityInventorySnapshot;
  readonly tools: {
    readonly enabledNames: readonly string[];
    readonly approvedNames?: readonly string[];
    readonly maxRounds: number;
    readonly maxCalls: number;
  };
  /** Safe connection bindings derived from the immutable capability resolution. */
  readonly connections?: readonly ConnectionBinding[];
  /** Server-owned profile selected by Chat or Compare. */
  readonly profileId?: string;
  /** User-requested packaged skills, checked against the selected profile. */
  readonly requestedSkillIds?: readonly string[];
  /** Approval decisions are references, never credentials. */
  readonly approvals?: readonly CapabilityApproval[];
  /** Immutable resolution retained in the manifest after admission. */
  readonly resolution?: CapabilityResolution;
  /** Selected context-only skills; bodies stay in the context session, not the manifest. */
  readonly skills?: readonly SkillSummary[];
}

export interface RunRequest {
  readonly execution?: RunExecutionRequest;
  readonly platform: string;
  readonly variant: string;
  /** Correlates independent members of one browser comparison. */
  readonly comparisonId?: string;
  readonly sessionId?: string;
  /** Stable client-generated key for retrying one turn within a session. */
  readonly clientTurnId?: string;
  readonly task: {
    readonly kind: "prompt";
    readonly prompt: string;
  };
  readonly model: {
    readonly provider: string;
    readonly model: string;
    readonly contextWindowTokens?: number;
  };
  /** Provider-neutral capability settings resolved into the immutable manifest. */
  readonly capabilities?: RunCapabilities;
  readonly selection?: RunSelection;
  readonly experiment?: undefined;
}

export interface RunManifest {
  readonly execution?: RunExecutionPolicy;
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly createdAt: string;
  readonly serverVersion: string;
  readonly platform: string;
  readonly variant: string;
  readonly comparisonId?: string;
  readonly task: {
    readonly kind: "prompt";
    readonly prompt: string;
  };
  readonly context: {
    readonly systemInstruction: string;
    readonly sessionId?: string;
    readonly turnId?: string;
    readonly clientTurnId?: string;
    readonly snapshotId?: string;
  };
  readonly platformConfig: Readonly<Record<string, unknown>>;
  readonly capabilities?: RunCapabilities;
  readonly selection?: RunSelection;
  readonly model: {
    readonly provider: ModelProvider;
    readonly model: string;
    readonly contextWindowTokens?: number;
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

/**
 * The identity used to deduplicate and order one normalized event stream.
 * `attemptId` is the stable identity of a platform execution attempt, not a
 * retry count or a human-readable event name.
 */
export interface RunEventIdentity {
  readonly platform: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly source: string;
  readonly sourceSequence: number;
}

export interface RunEvent<TPayload = Record<string, unknown>> {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly recordedSequence: number;
  /** Present on newly written scoped events; omitted by legacy schema-v1 events. */
  readonly platform?: string;
  /** Present on newly written scoped events; omitted by legacy schema-v1 events. */
  readonly attemptId?: string;
  readonly source: string;
  readonly sourceSequence: number;
  readonly kind: string;
  readonly runId: string;
  readonly occurredAt: string;
  readonly payload: TPayload;
}

export interface RunEventIntent<TPayload = Record<string, unknown>> {
  /** Defaults to the run manifest platform when omitted. */
  readonly platform?: string;
  /** Required for attempt-scoped identity; omitted only for legacy event producers. */
  readonly attemptId?: string;
  readonly source: string;
  readonly sourceSequence: number;
  readonly kind: string;
  readonly runId: string;
  readonly occurredAt: string;
  readonly payload: TPayload;
}

/**
 * Safe operator evidence for a run lifecycle operation. This deliberately
 * contains classifications and timing, not prompts, model output, or native
 * request payloads.
 */
export interface OperationalLogIntent {
  readonly runId: string;
  readonly occurredAt: string;
  readonly level: "info" | "warn" | "error";
  readonly operation: string;
  readonly requestId?: string;
  /** Provider or external-system request identity when the event exposes one. */
  readonly providerRequestId?: string;
  readonly platform?: string;
  readonly variant?: string;
  readonly status?: string;
  readonly nativeStatus?: string;
  readonly outcome?: string;
  readonly durationMs?: number | null;
  readonly retryCount?: number | null;
  readonly code?: string;
}

export interface OperationalLogEntry extends OperationalLogIntent {
  readonly schemaVersion: 1;
  readonly logId: string;
  readonly recordedSequence: number;
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

export interface RunProjection {
  /** Whether the response reflects the latest platform inspection. */
  readonly state: "current" | "stale";
  /** The latest observation retained by the Lab evidence projection. */
  readonly observedAt: string;
  /** A safe operator-facing explanation when the projection is stale. */
  readonly reason: string | null;
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
  readonly toolCallCount?: number;
  readonly toolAttemptCount?: number;
  /** Count of connection-backed tool calls observed in normalized events. */
  readonly connectionCallCount?: number;
  /** Connection calls whose provider outcome remained unknown. */
  readonly connectionUnknownCount?: number;
  /** Approval decisions observed during the run. */
  readonly approvalDecisionCount?: number;
  /** Model or platform retry decisions observed in normalized lifecycle events. */
  readonly retryCount?: number;
  /** Tool calls that ended with a validation, policy, or execution failure. */
  readonly toolFailureCount?: number;
  /** Tool calls cancelled before or during execution. */
  readonly toolCancellationCount?: number;
  /** Tool calls that exceeded their configured deadline. */
  readonly toolTimeoutCount?: number;
  /** Calls whose external outcome could not be established. */
  readonly unknownOutcomeCount?: number;
  /** Number of capability resolution decisions recorded for this run. */
  readonly capabilityResolutionCount?: number;
  /** Sum of bounded tool execution durations reported by lifecycle events. */
  readonly toolDurationMs?: number;
  /** Approval decisions grouped by outcome. */
  readonly approvalGrantedCount?: number;
  readonly approvalDeniedCount?: number;
  readonly approvalRequiredCount?: number;
  /** OAuth refresh lifecycle events observed by the run boundary. */
  readonly oauthRefreshCount?: number;
}
