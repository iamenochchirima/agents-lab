import { isAbortError, ModelProviderError } from "../runtime/errors.js";
import type { ModelRequest, ModelStreamEvent } from "../runtime/contracts.js";

export interface ModelProvider {
  readonly provider: ModelRequest["provider"];
  readonly model: string;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}

export function isRetryableModelFailure(error: unknown, emittedEvent: boolean): error is ModelProviderError {
  if (emittedEvent || isAbortError(error) || !(error instanceof ModelProviderError)) return false;
  return error.retryable ?? (error.code === "provider" || error.code === "rate-limit");
}
