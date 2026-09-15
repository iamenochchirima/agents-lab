import type {
  HatchetModelAdapter,
  HatchetModelCallResult,
  HatchetModelRequestInput,
} from "../contracts.js";

const DELAY_MS = 60_000;

/**
 * Deterministic model fixtures let the Hatchet lifecycle be exercised without
 * provider cost. `fake-pre-dispatch-retry` intentionally throws on its first
 * task attempt so Hatchet, rather than application code, owns the retry.
 */
export class FakeHatchetModelAdapter implements HatchetModelAdapter {
  async complete(
    input: HatchetModelRequestInput,
    signal: AbortSignal,
  ): Promise<HatchetModelCallResult> {
    switch (input.model) {
      case "fake-success":
        return success(input, `Fake response: ${input.prompt}`);
      case "fake-pre-dispatch-retry":
        return input.attemptNumber === 1
          ? preDispatchFailure(
              "FAKE_PRE_DISPATCH",
              "The deterministic adapter failed before dispatch.",
            )
          : success(input, `Fake response after retry: ${input.prompt}`);
      case "fake-pre-dispatch-failure":
        return preDispatchFailure(
          "FAKE_PRE_DISPATCH",
          "The deterministic adapter failed before dispatch.",
        );
      case "fake-provider-failure":
        return {
          kind: "failure",
          failureKind: "provider",
          code: "FAKE_PROVIDER_FAILURE",
          message:
            "The deterministic adapter simulates a provider-declared failure.",
          requestSent: true,
        };
      case "fake-ambiguous":
        return {
          kind: "failure",
          failureKind: "outcome_unknown",
          code: "FAKE_AMBIGUOUS_OUTCOME",
          message:
            "The deterministic adapter simulates a lost acknowledgement after dispatch.",
          requestSent: true,
        };
      case "fake-timeout":
      case "fake-cancel":
        await cancellableDelay(DELAY_MS, signal);
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

function success(
  input: HatchetModelRequestInput,
  output: string,
): HatchetModelCallResult {
  return {
    kind: "success",
    output,
    providerRequestId: `fake-${input.attemptId}`,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function preDispatchFailure(
  code: string,
  message: string,
): HatchetModelCallResult {
  return {
    kind: "failure",
    failureKind: "pre_dispatch",
    code,
    message,
    requestSent: false,
  };
}

function cancellableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
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
