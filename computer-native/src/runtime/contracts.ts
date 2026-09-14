export type SessionId = string & { readonly __brand: "SessionId" };
export type TurnId = string & { readonly __brand: "TurnId" };

export type ProviderName = "deterministic" | "openrouter";
export type DeterministicBehavior = "success" | "failure" | "timeout";

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
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ModelRequest {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly provider: ProviderName;
  readonly model: string;
  readonly messages: readonly ModelMessage[];
}

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export type ModelStreamEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "completed"; readonly usage?: ModelUsage };

export interface TurnError {
  readonly code:
    | "configuration"
    | "persistence"
    | "provider"
    | "timeout"
    | "cancelled"
    | "interrupted";
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
  readonly error?: TurnError;
}

export type LifecycleEventType =
  | "TurnStarted"
  | "ModelRequested"
  | "ModelCompleted"
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
