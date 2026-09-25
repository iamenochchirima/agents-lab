import type { JsonValue, ModuleCancellation, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";

export interface ControlTask {
  /** Text normalized by the Input module for this first control contract. */
  readonly prompt: string;
}

export interface ControlModelMessage {
  readonly role: "system" | "developer" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly name?: string;
  readonly toolCallId?: string;
}

export interface ControlModelTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonValue;
}

/** Context and Planning are adapted by the kernel into this explicit model request. */
export interface PreparedModelTurn {
  readonly model: { readonly provider: string; readonly name: string; readonly revision?: string };
  readonly messages: readonly ControlModelMessage[];
  readonly tools?: readonly ControlModelTool[];
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly idempotencyKey?: string;
  readonly turnId?: string;
}

export interface ControlToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: JsonValue;
}

export interface ControlModelResponse {
  readonly text: string | null;
  readonly toolCalls: readonly ControlToolCall[];
  readonly finishReason: string;
  readonly providerDetail?: JsonValue;
}

export interface ControlToolResult {
  readonly callId: string;
  readonly outcome: "completed" | "rejected" | "uncertain";
  readonly output?: JsonValue;
  readonly failure?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

export interface ControlDeliveryResult {
  readonly outcome: "committed" | "rejected" | "uncertain";
  readonly receipt: JsonValue;
}

export type ControlObservation =
  | { readonly kind: "model-response"; readonly response: ControlModelResponse }
  | { readonly kind: "tool-result"; readonly result: ControlToolResult }
  | { readonly kind: "delivery-result"; readonly result: ControlDeliveryResult };

/**
 * The kernel implements these ports by composing the selected role modules.
 * Control owns call ordering and the decision to finish; the kernel owns run
 * status, cancellation, global limits, and evidence publication.
 */
export interface ControlPorts {
  prepareModelTurn(input: { readonly scope: RunScope; readonly task: ControlTask }, signal: ModuleCancellation): Promise<PreparedModelTurn>;
  generate(input: { readonly scope: RunScope; readonly turn: PreparedModelTurn }, signal: ModuleCancellation): Promise<ControlModelResponse>;
  /** The kernel must run the Safety policy and tool/environment adapters before effects occur. */
  executeTool(input: { readonly scope: RunScope; readonly call: ControlToolCall }, signal: ModuleCancellation): Promise<ControlToolResult>;
  recordObservation(input: { readonly scope: RunScope; readonly observation: ControlObservation }, signal: ModuleCancellation): Promise<void>;
  /** The kernel must run the Safety policy before handing final output to the sink. */
  deliverFinal(input: { readonly scope: RunScope; readonly text: string }, signal: ModuleCancellation): Promise<ControlDeliveryResult>;
}

export type ControlTermination = "model-finished" | "delivery-rejected" | "delivery-uncertain";

export interface ControlResult {
  readonly termination: ControlTermination;
  readonly finalText: string | null;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly observations: number;
}

/**
 * A Control implementation drives one run through the provided ports. It must
 * stop calling ports after cancellation and return only after a terminal
 * response or a typed port error. The kernel checks global call/time limits.
 */
export interface ControlModule {
  readonly identity: ModuleIdentity;
  run(input: { readonly scope: RunScope; readonly task: ControlTask }, ports: ControlPorts, signal: ModuleCancellation): Promise<ControlResult>;
}

export type ControlPortFailureKind = "budget-exhausted" | "module-failed" | "invalid-transition";

export class ControlPortError extends Error {
  constructor(readonly kind: ControlPortFailureKind, message: string, readonly retryable = false) {
    super(message);
    this.name = "ControlPortError";
  }
}
