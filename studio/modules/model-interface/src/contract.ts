import type { AgentMessage, AgentToolCall, JsonValue, ModuleCancellation, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";

export type ModelMessageRole = AgentMessage["role"];

export interface ModelMessage extends AgentMessage {}

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonValue;
}

export interface ModelRequest {
  readonly scope: RunScope;
  readonly model: { readonly provider: string; readonly name: string; readonly revision?: string };
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly idempotencyKey?: string;
}

export interface ModelToolCall extends AgentToolCall {
  /** Retains provider text when argument parsing or normalization matters to evidence. */
  readonly rawArguments?: string;
}

export interface ModelUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly basis: "provider-reported" | "estimated" | "unknown";
}

export interface ModelProviderIdentity {
  readonly provider: string;
  readonly model: string;
  readonly adapter: ModuleIdentity;
  readonly requestId?: string;
}

export interface ModelResponse {
  readonly provider: ModelProviderIdentity;
  readonly text: string | null;
  readonly toolCalls: readonly ModelToolCall[];
  readonly finishReason: string;
  readonly usage: ModelUsage;
  readonly providerDetail?: JsonValue;
}

export type ModelFailureCategory =
  | "invalid-request"
  | "authentication"
  | "rate-limited"
  | "context-overflow"
  | "provider-unavailable"
  | "timeout"
  | "cancelled"
  | "malformed-response"
  | "unknown";

export interface ModelFailure {
  readonly category: ModelFailureCategory;
  readonly message: string;
  readonly retryable: boolean;
  /** "unknown" means the provider may have accepted or billed the request. */
  readonly dispatchOutcome: "not-sent" | "response-received" | "unknown";
  readonly provider?: string;
  readonly statusCode?: number;
}

export type ModelCallResult =
  | { readonly outcome: "completed"; readonly response: ModelResponse }
  | { readonly outcome: "failed"; readonly failure: ModelFailure };

/** Calls a model provider and preserves normalized results plus adapter-specific detail. */
export interface ModelInterfaceModule {
  readonly identity: ModuleIdentity;
  generate(request: ModelRequest, signal: ModuleCancellation): Promise<ModelCallResult>;
}
