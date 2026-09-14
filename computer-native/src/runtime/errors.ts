import type { TurnError } from "./contracts.js";

export type ComputerNativeErrorCode = TurnError["code"] | "session-not-found" | "invalid-input" | "lock";

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
  constructor(message: string, options?: { cause?: unknown }) {
    super("provider", message, options);
    this.name = "ModelProviderError";
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
