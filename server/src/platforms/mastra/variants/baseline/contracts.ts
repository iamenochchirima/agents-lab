import type { ToolCall } from "../../../../capabilities/tools/contracts.js";
import type { InvocationReviewView } from "../../../../capabilities/reviews/contracts.js";
import type {
  PlatformExecutionReference,
  RunEventIntent,
  RunManifest,
  RunMetrics,
  RunResult,
  RunTrajectory,
} from "../../../../control-plane/domain/types.js";

export const MASTRA_EVENT_SOURCE = "mastra-agent" as const;

export interface MastraExecutionRecord {
  readonly reference: PlatformExecutionReference;
  readonly manifest: RunManifest;
  readonly controller: AbortController;
  readonly events: RunEventIntent[];
  readonly startedAt: string;
  status: "queued" | "running" | "suspended" | "completed" | "failed" | "cancelled";
  pendingReview?: InvocationReviewView | null;
  pendingCall?: ToolCall | null;
  result: RunResult | null;
  trajectory: RunTrajectory | null;
  metrics: RunMetrics | null;
  cancellationReason: string | null;
  timeoutRequested: boolean;
  /** Conservative recovery barrier, persisted before external tool dispatch. */
  pendingDispatches?: string[];
  unsafeOutcome?: boolean;
}
