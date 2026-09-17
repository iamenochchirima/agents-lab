import type { ContextMessage } from "../../capabilities/context/contracts.js";

export interface StudioModelRequest {
  readonly task: string;
  readonly messages: readonly ContextMessage[];
  readonly requiredMessageId: string;
  readonly expectedAnswer: string;
  readonly seed: string;
}

export interface StudioModelResponse {
  readonly output: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export interface StudioModelAdapter {
  readonly provider: "replay";
  readonly model: string;
  complete(request: StudioModelRequest, signal?: AbortSignal): Promise<StudioModelResponse>;
}

/**
 * This adapter verifies context wiring without pretending to measure model
 * quality. Its response changes only according to whether the fixture's
 * required message reached the model boundary.
 */
export class ReplayModelAdapter implements StudioModelAdapter {
  readonly provider = "replay" as const;
  readonly model = "context-replay-v1";

  async complete(request: StudioModelRequest, signal?: AbortSignal): Promise<StudioModelResponse> {
    if (signal?.aborted) throw new DOMException("The replay model call was cancelled.", "AbortError");
    const retained = request.messages.some((message) => message.messageId === request.requiredMessageId);
    return {
      output: retained
        ? request.expectedAnswer
        : "The required account preference was not present in the model context.",
      inputTokens: null,
      outputTokens: null,
    };
  }
}
