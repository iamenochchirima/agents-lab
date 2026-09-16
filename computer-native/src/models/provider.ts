import { isAbortError, ModelProviderError } from "../runtime/errors.js";
import type { ModelRequest, ModelStreamEvent } from "../runtime/contracts.js";

export interface ModelProviderCapabilities {
  readonly streaming: boolean;
  readonly toolCalls: boolean;
  readonly structuredOutput: boolean;
  readonly vision: boolean;
  readonly reasoningControls: boolean;
  readonly usageReporting: boolean;
  /** A numeric window is not asserted until the provider reports one. */
  readonly contextWindow: "harness-bounded" | "provider-reported" | "unknown";
}

export const DETERMINISTIC_CAPABILITIES = {
  streaming: true,
  toolCalls: true,
  structuredOutput: false,
  vision: false,
  reasoningControls: false,
  usageReporting: true,
  contextWindow: "harness-bounded",
} as const satisfies ModelProviderCapabilities;

export const OPENROUTER_CAPABILITIES = {
  streaming: true,
  toolCalls: true,
  structuredOutput: false,
  vision: false,
  reasoningControls: false,
  usageReporting: true,
  contextWindow: "unknown",
} as const satisfies ModelProviderCapabilities;

export interface ModelProvider {
  readonly provider: ModelRequest["provider"];
  readonly model: string;
  /** Adapters declare what this contract actually supports; custom test providers may omit it. */
  readonly capabilities?: ModelProviderCapabilities;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}

export function isRetryableModelFailure(error: unknown, emittedEvent: boolean): error is ModelProviderError {
  if (emittedEvent || isAbortError(error) || !(error instanceof ModelProviderError)) return false;
  return error.retryable ?? (error.code === "provider" || error.code === "rate-limit");
}
