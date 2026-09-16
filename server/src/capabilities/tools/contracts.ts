/** Provider-neutral tool contracts.
 *
 * These types describe what a tool call means. They deliberately contain no
 * Restate, Temporal, HTTP, model-SDK, or browser types. A platform adapter
 * decides where the implementation runs and how its result becomes durable.
 */

export const TOOL_SCHEMA_VERSION = 1 as const;

export type ToolRiskClass = "pure" | "read" | "write" | "external";
export type ToolExecutionKind = "in_process";
export type ToolExecutionStatus = "completed" | "failed" | "cancelled" | "timed_out";

export interface ToolLimits {
  readonly maxArgumentBytes: number;
  readonly maxResultBytes: number;
  readonly timeoutMs: number;
}

export interface ToolDefinition {
  readonly schemaVersion: typeof TOOL_SCHEMA_VERSION;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly riskClass: ToolRiskClass;
  readonly executionKind: ToolExecutionKind;
  readonly limits: ToolLimits;
}

export interface ToolCall {
  readonly toolCallId: string;
  readonly name: string;
  /** Raw provider arguments. Validation turns this into a JSON object. */
  readonly arguments: unknown;
  readonly round: number;
}

export interface ToolExecutionContext {
  readonly runId: string;
  readonly turnId: string;
  readonly signal: AbortSignal;
}

export interface ToolImplementation {
  readonly definition: ToolDefinition;
  /** Returns a normalized JSON object or throws a classified validation error. */
  readonly validateArguments: (value: unknown) => Readonly<Record<string, unknown>>;
  readonly execute: (
    argumentsValue: Readonly<Record<string, unknown>>,
    context: ToolExecutionContext,
  ) => Promise<string>;
}

export interface AcceptedToolCall {
  readonly accepted: true;
  readonly call: ToolCall;
  readonly definition: ToolDefinition;
}

export interface RejectedToolCall {
  readonly accepted: false;
  readonly code:
    | "INVALID_CALL_ID"
    | "INVALID_TOOL_NAME"
    | "UNKNOWN_TOOL"
    | "INVALID_ARGUMENTS"
    | "ARGUMENTS_TOO_LARGE"
    | "INVALID_ROUND";
  readonly message: string;
  readonly toolCallId: string | null;
  readonly name: string | null;
}

export type ToolValidationResult = AcceptedToolCall | RejectedToolCall;

export interface ToolPolicyDecision {
  readonly allowed: boolean;
  readonly code: "TOOL_ALLOWED" | "TOOL_NOT_ENABLED" | "TOOL_RISK_NOT_ALLOWED" | "UNKNOWN_TOOL";
  readonly message: string;
}

export interface ToolExecutionError {
  readonly code: "TOOL_EXECUTION_FAILED" | "TOOL_CANCELLED" | "TOOL_TIMEOUT" | "TOOL_RESULT_TOO_LARGE";
  readonly message: string;
}

export interface ToolExecutionResult {
  readonly status: ToolExecutionStatus;
  readonly content: string;
  readonly error: ToolExecutionError | null;
  readonly durationMs: number;
  readonly attemptCount: number;
}

export type ToolLifecycleKind =
  | "ToolCallRequested"
  | "ToolCallValidated"
  | "ToolCallRejected"
  | "ToolPolicyDenied"
  | "ToolExecutionStarted"
  | "ToolExecutionCompleted"
  | "ToolExecutionFailed"
  | "ToolExecutionCancelled";

export interface ToolLifecyclePayload {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly round: number;
  readonly attempt: number;
  readonly argumentBytes?: number;
  readonly resultBytes?: number;
  readonly durationMs?: number;
  readonly status?: ToolExecutionStatus;
  readonly code?: string;
  readonly message?: string;
}
