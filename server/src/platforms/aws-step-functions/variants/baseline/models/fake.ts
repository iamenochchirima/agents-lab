import type { AwsStepFunctionsActivityInput, AwsStepFunctionsModelResult } from "../contracts.js";

export async function runFakeModel(
  input: AwsStepFunctionsActivityInput,
  timeoutMs: number,
): Promise<AwsStepFunctionsModelResult> {
  switch (input.model) {
    case "fake-success":
      return success(input, `Fake response: ${input.prompt}`);
    case "fake-retry-once":
      return input.attempt === 0
        ? failure("InjectedRetryableFailure", "Deterministic retry requested.", true)
        : success(input, `Fake response after retry: ${input.prompt}`);
    case "fake-failure":
      return failure("InjectedModelFailure", "Deterministic model failure.", false);
    case "fake-timeout":
      await delay(timeoutMs + 100);
      return failure("UnexpectedCompletion", "The timeout fixture completed unexpectedly.", false);
    default:
      return failure("UnknownFakeModel", `Unknown fake model: ${input.model}`, false);
  }
}

function success(input: AwsStepFunctionsActivityInput, output: string): AwsStepFunctionsModelResult {
  return {
    kind: "success",
    output,
    providerRequestId: `fake-${input.runId}-${input.attempt}`,
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

function failure(code: string, message: string, retryable: boolean): AwsStepFunctionsModelResult {
  return {
    kind: "failure",
    code,
    message,
    failureKind: retryable ? "provider" : "internal",
    retryable,
    requestSent: false,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
