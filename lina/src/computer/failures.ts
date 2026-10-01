import { ToolExecutionError } from "../runtime/errors.js";

/** User-visible failure categories for the bounded computer-use workflow. */
export type ComputerErrorCode =
  | "computer-disabled"
  | "computer-no-candidate"
  | "computer-confidence-abstention"
  | "computer-blocked"
  | "computer-disagreement"
  | "computer-verification"
  | "computer-decision"
  | "computer-malformed-response"
  | "computer-provider-timeout"
  | "computer-driver-failure"
  | "computer-display-unavailable"
  | "computer-stale-observation"
  | "computer-action-limit"
  | "computer-surface-ambiguous"
  | "computer-surface-unavailable"
  | "computer-task-invalid"
  | "computer-strategy-unavailable"
  | "computer-approval-denied"
  | "computer-approval-unavailable"
  | "computer-cancelled"
  | "computer-environment";

/**
 * A decision-stage failure with a stable category. The category is retained at
 * the tool and TUI boundaries; the message remains bounded and redacted by the
 * runner before it is emitted.
 */
export class ComputerFailureError extends ToolExecutionError {
  readonly computerCode: ComputerErrorCode;

  constructor(computerCode: ComputerErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "ComputerFailureError";
    this.computerCode = computerCode;
  }
}

function errorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>).code;
  return typeof candidate === "string" ? candidate : undefined;
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/** Map adapter/provider failures to the smallest useful public category. */
export function classifyComputerFailure(error: unknown): ComputerErrorCode {
  if (error instanceof ComputerFailureError) return error.computerCode;

  switch (errorCode(error)) {
    case "unavailable":
      return "computer-display-unavailable";
    case "stale-observation":
      return "computer-stale-observation";
    case "driver-failure":
    case "not-started":
    case "already-closed":
      return "computer-driver-failure";
  }

  const message = errorText(error);
  if (/\b(?:timeout|timed\s+out|deadline|ETIMEDOUT)\b/iu.test(message)) {
    return "computer-provider-timeout";
  }
  if (/(?:malformed|invalid\s+(?:json|object|response|selection|arguments|function|candidate)|returned\s+(?:no|an\s+invalid)|must\s+return\s+(?:exactly|one)|strict\s+(?:action|selection)|contained\s+fields|does\s+not\s+belong\s+to\s+operation)/iu.test(message)) {
    return "computer-malformed-response";
  }
  return "computer-decision";
}
