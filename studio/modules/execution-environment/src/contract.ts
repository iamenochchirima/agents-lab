import type { CapabilityDescriptor, JsonValue, ModuleCancellation, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";

export interface EnvironmentDescriptor {
  readonly identity: ModuleIdentity;
  readonly capabilities: readonly CapabilityDescriptor[];
}

export interface OpenEnvironmentSessionRequest {
  readonly scope: RunScope;
  readonly requestedCapabilities: readonly { readonly id: string; readonly version: string; readonly operations: readonly string[] }[];
}

export interface EnvironmentFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface EnvironmentInvocation {
  readonly operationId: string;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly operation: string;
  readonly input: JsonValue;
  readonly idempotencyKey?: string;
}

export type EnvironmentInvocationReceipt =
  | { readonly outcome: "completed"; readonly operationId: string; readonly output: JsonValue }
  | { readonly outcome: "rejected"; readonly operationId: string; readonly failure: EnvironmentFailure }
  | { readonly outcome: "uncertain"; readonly operationId: string; readonly failure: EnvironmentFailure };

export interface EnvironmentSession {
  readonly sessionId: string;
  readonly scope: RunScope;
  readonly capabilities: readonly CapabilityDescriptor[];
  invoke(request: EnvironmentInvocation, signal: ModuleCancellation): Promise<EnvironmentInvocationReceipt>;
  /** Cleanup is attempted even after run cancellation; implementations apply their own bounded cleanup timeout. */
  close(): Promise<EnvironmentCloseReceipt>;
}

export type EnvironmentOpenResult =
  | { readonly outcome: "opened"; readonly session: EnvironmentSession }
  | { readonly outcome: "failed"; readonly resourceState: "not-created" | "uncertain"; readonly failure: EnvironmentFailure };

export type EnvironmentCloseReceipt =
  | { readonly outcome: "closed" | "already-closed" }
  | { readonly outcome: "uncertain"; readonly failure: EnvironmentFailure };

/** A scoped environment exposes only the capabilities granted for this session. */
export interface ExecutionEnvironmentModule {
  readonly identity: ModuleIdentity;
  describe(): EnvironmentDescriptor;
  openSession(request: OpenEnvironmentSessionRequest, signal: ModuleCancellation): Promise<EnvironmentOpenResult>;
}
