import type { AgentEvent, JsonValue, ModuleCancellation, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import type { ObservabilityConfig } from "./config.js";

export interface ModuleDetail {
  readonly module: ModuleIdentity;
  readonly schemaVersion: string;
  readonly detail: JsonValue;
}

export interface ObservedEvent {
  readonly event: AgentEvent;
  readonly moduleDetail?: ModuleDetail;
}

export type ObservationAppendReceipt =
  | { readonly status: "accepted" | "duplicate"; readonly eventId: string; readonly sequence: number; readonly persistence: "buffered" | "durable" }
  | { readonly status: "rejected"; readonly eventId: string; readonly sequence: number; readonly reason: "out-of-order" | "conflicting-duplicate" | "capacity" | "invalid" }
  | { readonly status: "uncertain"; readonly eventId: string; readonly sequence: number; readonly persistence: "unknown" };

export interface ObservationFlushReceipt {
  readonly status: "durable" | "partial" | "failed" | "unknown";
  readonly durableThroughSequence: number | null;
  readonly pendingEvents: number;
  readonly failure?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

/**
 * Records normalized events without discarding module detail. Implementations
 * may throw a typed error before accepting an event when their backing store
 * cannot initialize; an uncertain post-dispatch write must instead be
 * represented in the append or flush receipt.
 */
export interface ObservabilityModule {
  readonly identity: ModuleIdentity;
  append(input: ObservedEvent, signal: ModuleCancellation): Promise<ObservationAppendReceipt>;
  flush(scope: RunScope, signal: ModuleCancellation): Promise<ObservationFlushReceipt>;
}

/** Host supplies a run-scoped directory; storage and writer exclusivity are implementation-specific. */
export interface ObservabilityDependencies {
  readonly rootDirectory: string;
  readonly scope: RunScope;
}

export type ObservabilityFactory = (config: ObservabilityConfig, dependencies: ObservabilityDependencies) => ObservabilityModule;

export type ObservabilityErrorCode =
  | "INVALID_OBSERVABILITY_INPUT"
  | "OBSERVABILITY_CANCELLED"
  | "OBSERVABILITY_STORAGE_FAILURE"
  | "OBSERVABILITY_RUN_MISMATCH";

export class ObservabilityError extends Error {
  constructor(readonly code: ObservabilityErrorCode, message: string) {
    super(message);
    this.name = "ObservabilityError";
  }
}
