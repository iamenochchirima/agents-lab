import type { CapabilityDescriptor, JsonValue, ModuleIdentity, RunScope } from "@agent-harness-lab/agent-protocol";
import type { ToolUseConfig } from "./config.js";

export type ToolArguments = Readonly<Record<string, JsonValue>>;

export type ToolRisk = "pure" | "read" | "write" | "external";
export type ToolExecutionStatus = "completed" | "failed" | "cancelled" | "timed-out" | "unknown" | "rejected";

export interface ToolDefinition {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly risk: ToolRisk;
  readonly inputSchema: ToolArguments;
  /** Explicit capability identity shared with Safety and the execution environment. */
  readonly capability?: CapabilityDescriptor;
  /** Operation selected from `capability.operations`; avoids deriving it from the tool name. */
  readonly capabilityOperation?: string;
}

/** Raw model-proposed arguments remain unknown until runtime validation succeeds. */
export interface ProposedToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: unknown;
}

export interface ValidatedToolCall {
  readonly callId: string;
  readonly definition: ToolDefinition;
  readonly arguments: ToolArguments;
}

export type ToolValidationResult =
  | { readonly accepted: true; readonly call: ValidatedToolCall }
  | { readonly accepted: false; readonly code: "INVALID_CALL" | "UNKNOWN_TOOL" | "INVALID_ARGUMENTS" | "ARGUMENTS_TOO_LARGE"; readonly message: string };

export interface ToolExecutionReceipt {
  readonly status: ToolExecutionStatus;
  readonly output: JsonValue | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly durationMs: number | null;
  readonly attemptCount: number;
}

/** The host implementation performs the action through its scoped environment capability. */
export interface ToolExecutor {
  execute(input: { readonly scope: RunScope; readonly call: ValidatedToolCall }, signal: AbortSignal): Promise<ToolExecutionReceipt>;
}

export interface ToolRegistration {
  readonly definition: ToolDefinition;
  /** Runtime validation remains necessary even when a JSON schema is sent to a model. */
  readonly validateArguments: (value: unknown) => ToolArguments;
}

export interface ToolUseDependencies {
  readonly registrations: readonly ToolRegistration[];
  readonly executor: ToolExecutor;
}

export type ToolUseErrorCode = "TOOL_USE_CANCELLED" | "TOOL_EXECUTION_FAILED" | "TOOL_TIMEOUT" | "TOOL_OUTCOME_UNKNOWN";

export class ToolUseError extends Error {
  constructor(readonly code: ToolUseErrorCode, message: string) {
    super(message);
    this.name = "ToolUseError";
  }
}

/** Tool Use validates and dispatches; Safety authorization and environment access stay outside this module. */
export interface ToolUseModule {
  readonly identity: ModuleIdentity;
  definitions(): readonly ToolDefinition[];
  validate(call: ProposedToolCall): ToolValidationResult;
  dispatch(call: ValidatedToolCall, scope: RunScope, signal: AbortSignal): Promise<ToolExecutionReceipt>;
}

export type ToolUseFactory = (config: ToolUseConfig, dependencies: ToolUseDependencies) => ToolUseModule;
