import type { ModelAdapter, ModelCallResult, ModelRequestInput } from "../contracts.js";

const FIXTURE_DELAY_MS = 60_000;

/**
 * Deterministic fixtures make lifecycle and failure semantics testable without
 * turning a provider outage into a flaky test or spending model tokens.
 */
export class FakeModelAdapter implements ModelAdapter {
  async complete(input: ModelRequestInput, signal: AbortSignal): Promise<ModelCallResult> {
    switch (input.model) {
      case "fake-success":
        return success(input, `Fake response: ${input.prompt}`);
      case "fake-pre-dispatch-retry":
        return input.attemptNumber === 1
          ? preDispatchFailure("FAKE_PRE_DISPATCH", "The deterministic adapter failed before dispatch.")
          : success(input, `Fake response after retry: ${input.prompt}`);
      case "fake-pre-dispatch-failure":
        return preDispatchFailure("FAKE_PRE_DISPATCH", "The deterministic adapter failed before dispatch.");
      case "fake-ambiguous":
        return {
          kind: "failure",
          failureKind: "outcome_unknown",
          code: "FAKE_AMBIGUOUS_OUTCOME",
          message: "The deterministic adapter simulates a lost acknowledgement after dispatch.",
          requestSent: true,
        };
      case "fake-provider-failure":
        return {
          kind: "failure",
          failureKind: "provider",
          code: "FAKE_PROVIDER_FAILURE",
          message: "The deterministic adapter simulates a provider-declared failure.",
          requestSent: true,
        };
      case "fake-timeout":
      case "fake-cancel":
        await cancellableDelay(FIXTURE_DELAY_MS, signal);
        return success(input, `Fake delayed response: ${input.prompt}`);
      default:
        return {
          kind: "failure",
          failureKind: "configuration",
          code: "UNKNOWN_FAKE_MODEL",
          message: `Unknown fake model: ${input.model}`,
          requestSent: false,
        };
    }
  }
}

function success(input: ModelRequestInput, output: string): ModelCallResult {
  return {
    kind: "success",
    output,
    providerRequestId: `fake-${input.attemptId}`,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function preDispatchFailure(code: string, message: string): ModelCallResult {
  return { kind: "failure", failureKind: "pre_dispatch", code, message, requestSent: false };
}

function cancellableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Operation cancelled."));
      return;
    }

    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Operation cancelled."));
      },
      { once: true },
    );
  });
}
