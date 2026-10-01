/** Stable identifiers and event metadata shared by independently owned modules. */
export type RunId = string & { readonly __runId: unique symbol };
export type TurnId = string & { readonly __turnId: unique symbol };
export type SessionId = string & { readonly __sessionId: unique symbol };

function checkedIdentifier(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be a non-empty identifier without surrounding whitespace or control characters.`);
  }
  return value;
}

export function createRunId(value: string): RunId {
  return checkedIdentifier(value, "runId") as RunId;
}

export function createTurnId(value: string): TurnId {
  return checkedIdentifier(value, "turnId") as TurnId;
}

export function createSessionId(value: string): SessionId {
  return checkedIdentifier(value, "sessionId") as SessionId;
}

/** Identifies one concrete behavior implementation; package version is recorded separately in an assembly. */
export interface ModuleIdentity {
  readonly id: string;
  readonly version: string;
}

export interface RunScope {
  readonly runId: RunId;
  readonly sessionId?: SessionId;
  readonly turnId?: TurnId;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A normalized call proposed in an assistant message. */
export interface AgentToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: JsonValue;
}

/** Provider-neutral message shape shared by Context, Control, and Model Interface. */
export interface AgentMessage {
  readonly role: "system" | "developer" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly name?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly AgentToolCall[];
}

export interface CapabilityDescriptor {
  readonly id: string;
  readonly version: string;
  readonly kind: string;
  readonly operations: readonly string[];
}

export interface AgentEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly runId: RunId;
  readonly occurredAt: string;
  readonly source: ModuleIdentity;
  readonly kind: string;
  readonly payload: JsonValue;
}

/** Cancellation is passed as the platform AbortSignal to avoid a second token API. */
export type ModuleCancellation = AbortSignal;
