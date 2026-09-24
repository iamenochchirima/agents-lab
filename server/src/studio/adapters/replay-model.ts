import type { ContextMessage } from "../../capabilities/context/contracts.js";

export interface StudioModelRequest {
  readonly model?: string;
  readonly task: string;
  readonly messages: readonly ContextMessage[];
  readonly seed: string;
  /** Legacy fixture fields are accepted for request compatibility and ignored by adapters. */
  readonly requiredMessageId?: string;
  readonly expectedAnswer?: string;
}

export interface StudioModelResponse {
  readonly output: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly providerRequestId?: string | null;
  readonly costUsd?: number | null;
}

export interface StudioModelAdapter {
  readonly provider: "replay" | "openrouter";
  readonly model: string;
  readonly adapterVersion?: string;
  complete(request: StudioModelRequest, signal?: AbortSignal): Promise<StudioModelResponse>;
}

/** Provider/model error that is safe to retry only with a changed Context input. */
export class StudioContextOverflowError extends Error {
  readonly code = "STUDIO_CONTEXT_OVERFLOW" as const;
  readonly retryable = true;

  constructor(message = "The model provider rejected the Context because it exceeded its input limit.") {
    super(message);
    this.name = "StudioContextOverflowError";
  }
}

/**
 * This adapter makes the model boundary reproducible. The optional fixture
 * answer is returned unchanged, whether or not the context contained the
 * required source. Context usefulness is evaluated by the separate grader.
 */
export class ReplayModelAdapter implements StudioModelAdapter {
  readonly provider = "replay" as const;
  readonly model = "context-replay-v1";
  readonly adapterVersion = "1";

  async complete(request: StudioModelRequest, signal?: AbortSignal): Promise<StudioModelResponse> {
    if (signal?.aborted) throw new DOMException("The replay model call was cancelled.", "AbortError");
    return {
      output: request.expectedAnswer ?? "The deterministic replay model completed the request.",
      inputTokens: null,
      outputTokens: null,
    };
  }
}
