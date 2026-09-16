import type { ModelAdapter, ModelCallResult, ModelRequest } from "../contracts.js";

/**
 * Deterministic fixtures for automated tests and local failure exercises.
 * The product UI exposes OpenRouter only; this adapter is selected only by an
 * explicit fixture request and is never a fallback for a provider failure.
 */
export class FakeRestateModel implements ModelAdapter {
  async complete(input: ModelRequest, signal: AbortSignal): Promise<ModelCallResult> {
    if (signal.aborted) return cancelledResult();

    const hasToolResult = input.messages.some((message) => message.role === "tool");
    if (input.model === "fake-delay" || (input.model === "fake-tool-call-delay" && hasToolResult)) {
      // Keep this fixture long enough for the native cancellation exercise and
      // browser playground to observe an active run. It remains abortable.
      try {
        await waitWithAbort(input.model === "fake-tool-call-delay" ? 15_000 : 5_000, signal);
      } catch (error) {
        if (signal.aborted) return cancelledResult();
        throw error;
      }
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

    if (input.model === "fake-pre-dispatch-retry" || (input.model === "fake-pre-dispatch-retry-once" && input.attempt === 1)) {
      return {
        kind: "failure",
        code: "FAKE_PRE_DISPATCH_RETRY",
        message: "The deterministic fake model failed before dispatch and may be retried safely.",
        failureKind: "pre_dispatch",
        retryable: true,
        requestSent: false,
      };
    }

    if (input.model === "fake-tool-call" || input.model === "fake-tool-call-delay") {
      const toolResult = input.messages.find((message) => message.role === "tool");
      if (!toolResult || toolResult.role !== "tool") {
        return {
          kind: "success",
          output: null,
          toolCalls: [{
            toolCallId: "call-calculator-1",
            name: "calculator",
            arguments: { operation: "add", left: 17, right: 25 },
          }],
          providerRequestId: null,
          usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
        };
      }
      return {
        kind: "success",
        output: `The calculator returned ${toolResult.content}.`,
        toolCalls: [],
        providerRequestId: null,
        usage: { inputTokens: 20, outputTokens: 9, totalTokens: 29 },
      };
    }

    if (input.model === "fake-tool-malformed") {
      return toolFixtureCall("call-malformed-1", "calculator", { operation: "add", left: 20 });
    }

    if (input.model === "fake-tool-unknown") {
      return toolFixtureCall("call-unknown-1", "unknown_tool", { value: 1 });
    }

    if (input.model === "fake-tool-duplicate") {
      return {
        kind: "success",
        output: null,
        toolCalls: [
          { toolCallId: "call-duplicate-1", name: "calculator", arguments: { operation: "add", left: 1, right: 1 } },
          { toolCallId: "call-duplicate-1", name: "calculator", arguments: { operation: "add", left: 2, right: 2 } },
        ],
        providerRequestId: null,
        usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      };
    }

    if (input.model === "fake-tool-loop") {
      return toolFixtureCall(`call-loop-${input.round}`, "calculator", { operation: "add", left: input.round, right: 1 });
    }

    if (input.model === "fake-context") {
      const remembered = input.messages.some((message) => typeof message.content === "string" && message.content.includes("conformance-4318"));
      return {
        kind: "success",
        output: /^Remember\b/.test(input.prompt) ? "Stored the test value." : remembered ? "conformance-4318" : "The test value was not present in the context.",
        toolCalls: [],
        providerRequestId: null,
        usage: { inputTokens: 16, outputTokens: 5, totalTokens: 21 },
      };
    }

    if (
      input.model !== "fake-success" &&
      input.model !== "fake-delay" &&
      input.model !== "fake-tool-call-delay" &&
      input.model !== "fake-pre-dispatch-retry-once" &&
      input.model !== "fake-context"
    ) {
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
      toolCalls: [],
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

function toolFixtureCall(toolCallId: string, name: string, argumentsValue: unknown): ModelCallResult {
  return {
    kind: "success",
    output: null,
    toolCalls: [{ toolCallId, name, arguments: argumentsValue }],
    providerRequestId: null,
    usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
  };
}
