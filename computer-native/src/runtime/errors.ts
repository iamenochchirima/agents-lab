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
export class ModelProviderError extends ComputerNativeError {
  constructor(message: string, options?: { cause?: unknown; code?: Extract<TurnError["code"], "provider" | "provider-empty" | "provider-incomplete" | "rate-limit"> }) {
    super(options?.code ?? "provider", message, options);
    this.name = "ModelProviderError";
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
  return result.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
}
