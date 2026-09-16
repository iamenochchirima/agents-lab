import type { MutationErrorCode, ProcessErrorCode, TurnError } from "./contracts.js";

export type ComputerNativeErrorCode = TurnError["code"] | "session-not-found" | "invalid-input" | "lock" | "browser";

export class ComputerNativeError extends Error {
  readonly code: ComputerNativeErrorCode;
  readonly safeMessage: string;

  constructor(code: ComputerNativeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ComputerNativeError";
    this.code = code;
    this.safeMessage = message;
  }
}

/**
 * Diagnostic-only interruption used to model an abrupt parent-process stop in
 * deterministic recovery tests. It intentionally bypasses normal terminalisation;
 * the persisted non-terminal turn is then handled by SessionStore recovery.
 */
export class RuntimeInterruptionError extends Error {
  readonly runtimeInterruption = true as const;
  /** Only set after the side effect's durable start evidence is known to exist. */
  readonly preserveSideEffect: boolean;

  constructor(message = "The runtime was interrupted by diagnostic fault injection.", options?: { readonly preserveSideEffect?: boolean }) {
    super(message);
    this.name = "RuntimeInterruptionError";
    this.preserveSideEffect = options?.preserveSideEffect === true;
  }
}

export function isRuntimeInterruptionError(error: unknown): error is RuntimeInterruptionError {
  return error instanceof RuntimeInterruptionError;
}

export class ModelProviderError extends ComputerNativeError {
  readonly retryable: boolean | undefined;

  constructor(message: string, options?: { cause?: unknown; code?: Extract<TurnError["code"], "provider" | "provider-empty" | "provider-incomplete" | "provider-context" | "provider-refusal" | "provider-auth" | "rate-limit">; retryable?: boolean }) {
    super(options?.code ?? "provider", message, options);
    this.name = "ModelProviderError";
    this.retryable = options?.retryable;
  }
}

export class ToolExecutionError extends ComputerNativeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("tool", message, options);
    this.name = "ToolExecutionError";
  }
}

export class ProcessExecutionError extends ToolExecutionError {
  readonly processCode: ProcessErrorCode;

  constructor(code: ProcessErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "ProcessExecutionError";
    this.processCode = code;
  }
}

export class MutationError extends ComputerNativeError {
  readonly mutationCode: MutationErrorCode;

  constructor(code: MutationErrorCode, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
    this.name = "MutationError";
    this.mutationCode = code;
  }
}

export class WorkspaceAccessError extends ComputerNativeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("workspace", message, options);
    this.name = "WorkspaceAccessError";
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof ComputerNativeError) {
    return error.safeMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected failure.";
}

export function redactSecrets(value: string, secrets: readonly string[] = []): string {
  let result = value;
  for (const secret of secrets) {
    if (secret.length > 0) {
      result = result.split(secret).join("[REDACTED]");
    }
  }
  return result
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    // Provider keys commonly use the `sk-...` shape. Keep this bounded to a
    // credential-like prefix so ordinary workspace text is not rewritten.
    .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9._-]{11,}\b/gi, "[REDACTED]");
}
