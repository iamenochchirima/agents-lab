import type { AgentEvent, JsonValue, ModuleCancellation, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";

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

/** Records normalized events without discarding each module's useful detail. */
export interface ObservabilityModule {
  readonly identity: ModuleIdentity;
  append(input: ObservedEvent, signal: ModuleCancellation): Promise<ObservationAppendReceipt>;
  flush(scope: RunScope, signal: ModuleCancellation): Promise<ObservationFlushReceipt>;
}
