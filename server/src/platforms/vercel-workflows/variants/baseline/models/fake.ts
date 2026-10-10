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

  if (input.model.model === "fake-tools" && (input.round ?? 1) === 1) {
    const requested = JSON.parse(input.prompt) as { name: string; arguments: unknown }[];
    return { kind: "success", output: null, toolCalls: requested.map((call, index) => ({
      ...call, toolCallId: `${input.runId}:call:${index + 1}`, round: 1,
    })), providerRequestId: "fake-tools", usage: { inputTokens: null, outputTokens: null, totalTokens: null } };
  }
  return {
    kind: "success",
    output: input.model.model === "fake-tools" ? (input.messages ?? []).filter(message => message.role === "tool").map(message => message.content).join("\n") : `Fake response: ${input.prompt}`,
    providerRequestId: `fake-${input.runId}-${input.attempt}`,
    usage: {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    },
  };
}
