import type { ModelAdapter, ModelCallResult, ModelRequest } from "../contracts.js";

export class FakeRestateModel implements ModelAdapter {
  async complete(input: ModelRequest, signal: AbortSignal): Promise<ModelCallResult> {
    if (signal.aborted) return cancelledResult();

    if (input.model === "fake-delay") {
      await waitWithAbort(250, signal);
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

    if (input.model === "fake-pre-dispatch-retry") {
      return {
        kind: "failure",
        code: "FAKE_PRE_DISPATCH_RETRY",
        message: "The deterministic fake model failed before dispatch and may be retried safely.",
        failureKind: "pre_dispatch",
        retryable: true,
        requestSent: false,
      };
    }

    if (input.model !== "fake-success" && input.model !== "fake-delay") {
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
}

function waitWithAbort(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("The fake model was cancelled.", "AbortError"));
    };
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function cancelledResult(): ModelCallResult {
  return {
    kind: "failure",
    code: "MODEL_CANCELLED",
    message: "The model request was cancelled before it started.",
    failureKind: "cancelled",
    retryable: false,
    requestSent: false,
  };
}
