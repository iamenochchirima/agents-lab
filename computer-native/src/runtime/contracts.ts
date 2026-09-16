export type SessionId = string & { readonly __brand: "SessionId" };
export type TurnId = string & { readonly __brand: "TurnId" };

export type ProviderName = "deterministic" | "openrouter";
export type DeterministicBehavior = "success" | "failure" | "timeout";

export type MutationErrorCode =
  | "mutation-invalid"
  | "approval-denied"
  | "approval-unavailable"
  | "mutation-stale"
  | "mutation-failed"
  | "reconciliation-required";

export type ProcessErrorCode =
  | "process-exit"
  | "process-signal"
  | "process-start"
  | "process-timeout"
  | "process-output-limit"
  | "process-cancelled"
  | "process-ambiguous"
  | "process-approval-denied"
  | "process-approval-unavailable"
  | "process-policy";

export type TurnStatus =
  | "idle"
  | "submitting"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type TerminalTurnStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type TranscriptRole = "user" | "assistant";

export interface TranscriptMessage {
  readonly schemaVersion: 1;
  readonly messageId: string;
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly role: TranscriptRole;
  readonly content: string;
  readonly createdAt: string;
}

export interface ModelMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly toolCallId?: string;
  readonly name?: string;
}

export interface ModelToolCall {
  readonly callId: string;
  readonly name: string;
  readonly argumentsJson: string;
}

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ModelRequest {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly provider: ProviderName;
  readonly model: string;
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDefinition[];
}

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface TurnMetrics {
  readonly modelRequestCount: number;
  readonly toolCallCount: number;
  readonly roundCount: number;
  readonly durationMs: number;
  readonly cost: null;
}

export type ModelStreamEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_call"; readonly call: ModelToolCall }
  | { readonly type: "completed"; readonly usage?: ModelUsage };

export interface TurnError {
  readonly code:
    | "configuration"
    | "persistence"
    | "provider"
    | "provider-empty"
    | "provider-incomplete"
    | "rate-limit"
    | "first-event-timeout"
    | "timeout"
    | "cancelled"
    | "interrupted"
    | "tool"
    | "resource-limit"
    | ProcessErrorCode
    | "workspace"
    | "round-limit"
    | MutationErrorCode;
  readonly message: string;
}

export interface TurnResult {
  readonly schemaVersion: 1;
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly status: TerminalTurnStatus;
  readonly provider: ProviderName;
  readonly model: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly assistantMessageId?: string;
  readonly assistantText?: string;
  readonly usage?: ModelUsage;
  readonly metrics?: TurnMetrics;
  readonly error?: TurnError;
}

export type LifecycleEventType =
  | "TurnStarted"
  | "ModelRequested"
  | "ModelRequestRejected"
  | "ModelAttemptCompleted"
  | "ModelRetryScheduled"
  | "ModelCompleted"
  | "ProcessPrepared"
  | "ProcessApprovalDecided"
  | "ProcessStarted"
  | "ProcessTerminating"
  | "ProcessCompleted"
  | "BrowserPrepared"
  | "BrowserApprovalDecided"
  | "BrowserStarted"
  | "BrowserCompleted"
  | "BrowserArtifactCreated"
  | "MemoryBootstrapLoaded"
  | "MemorySearched"
  | "MemoryPrepared"
  | "MemoryApprovalDecided"
  | "MemoryCommitted"
  | "MemoryForgotten"
  | "MemoryFailed"
  | "WorkspaceMutationProposed"
  | "WorkspaceMutationApprovalDecided"
  | "WorkspaceMutationApplying"
  | "WorkspaceMutationProgress"
  | "WorkspaceMutationCommitted"
  | "WorkspaceMutationFailed"
  | "WorkspaceMutationReconciled"
  | "TurnCompleted"
  | "TurnFailed"
  | "TurnCancelled"
  | "TurnInterrupted";

export interface LifecycleEvent {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly sequence: number;
  readonly type: LifecycleEventType;
  readonly recordedAt: string;
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface SessionMetadata {
  readonly schemaVersion: 1;
  readonly sessionId: SessionId;
  readonly createdAt: string;
  readonly source: "cli";
  readonly profileId: "default";
}

export interface TurnRecord {
  readonly schemaVersion: 1;
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly provider: ProviderName;
  readonly model: string;
  readonly state: Exclude<TurnStatus, "idle">;
  readonly userMessagePersisted: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type TurnEvent =
  | { readonly type: "waiting"; readonly round: number }
  | { readonly type: "retry"; readonly round: number; readonly attempt: number; readonly delayMs: number; readonly reason: string }
  | { readonly type: "text"; readonly text: string; readonly round: number }
  | { readonly type: "tool_started"; readonly round: number; readonly call: ModelToolCall }
  | { readonly type: "tool_completed"; readonly round: number; readonly callId: string; readonly name: string; readonly ok: boolean; readonly summary: string }
  | { readonly type: "status"; readonly status: TurnStatus; readonly round: number };

export interface RoundEvidence {
  readonly schemaVersion: 1;
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly round: number;
  readonly phase: "model_requested" | "model_completed" | "tool_requested" | "tool_completed";
  readonly recordedAt: string;
  readonly callId?: string;
  readonly toolName?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export function asSessionId(value: string): SessionId {
  return value as SessionId;
}

export function asTurnId(value: string): TurnId {
  return value as TurnId;
}

export function isTerminalStatus(status: TurnStatus): status is TerminalTurnStatus {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
}

export function terminalEventType(status: TerminalTurnStatus): LifecycleEventType {
  switch (status) {
    case "completed":
      return "TurnCompleted";
    case "failed":
      return "TurnFailed";
    case "cancelled":
      return "TurnCancelled";
    case "interrupted":
      return "TurnInterrupted";
  }
}
