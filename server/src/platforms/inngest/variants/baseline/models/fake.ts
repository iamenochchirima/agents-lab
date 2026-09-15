import { RetryAfterError } from "inngest";

import type { InngestModelRequest, InngestModelResult } from "../contracts.js";

export class InngestPreDispatchRetryError extends RetryAfterError {
  constructor(message = "The deterministic fake model failed before dispatch and may be retried safely.") {
    // Keep the deterministic fixture quick while still exercising Inngest's
    // native step retry path. Production errors use the configured backoff.
    super(message, 100);
    this.name = "InngestPreDispatchRetryError";
  }
}

export async function completeFakeModel(input: InngestModelRequest): Promise<InngestModelResult> {
  if (input.model === "fake-retry" && input.attempt === 0) {
    throw new InngestPreDispatchRetryError();
  }

  if (input.model === "fake-delay" || input.model === "fake-wait") {
    await delay(250);
  }

  if (input.model === "fake-failure") {
    return {
      kind: "failure",
      code: "FAKE_MODEL_FAILURE",
      message: "The deterministic fake model was instructed to fail.",
      failureKind: "provider",
      retryable: false,
      requestSent: false,
    };
  }

  if (input.model === "fake-unknown") {
    return {
      kind: "failure",
      code: "FAKE_MODEL_OUTCOME_UNKNOWN",
      message: "The fake model simulates a response whose outcome cannot be confirmed.",
      failureKind: "outcome_unknown",
      retryable: false,
      requestSent: true,
    };
  }

  if (!new Set(["fake-success", "fake-delay", "fake-wait", "fake-retry"]).has(input.model)) {
    return {
      kind: "failure",
      code: "UNKNOWN_FAKE_MODEL",
      message: `Unknown fake model: ${input.model}`,
      failureKind: "configuration",
      retryable: false,
      requestSent: false,
    };
  }

  return {
    kind: "success",
    output: `Fake response: ${input.prompt}`,
    providerRequestId: null,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
