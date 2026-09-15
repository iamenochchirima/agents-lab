import type {
  VercelWorkflowModelRequest,
  VercelWorkflowModelResult,
} from "../contracts.js";

/** A deterministic provider used to exercise the workflow without network cost. */
export function completeFakeModel(input: VercelWorkflowModelRequest): VercelWorkflowModelResult {
  if (input.model.model === "fake-failure") {
    return {
      kind: "failure",
      requestSent: false,
      error: {
        code: "FAKE_MODEL_FAILURE",
        message: "The deterministic fake model was asked to fail.",
        failureKind: "provider",
        retryable: false,
      },
    };
  }

  return {
    kind: "success",
    output: `Fake response: ${input.prompt}`,
    providerRequestId: `fake-${input.runId}-${input.attempt}`,
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    },
  };
}
