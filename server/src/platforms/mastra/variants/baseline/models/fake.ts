import type { MastraModelConfig } from "@mastra/core/llm";

export interface DeterministicFakeModelOptions {
  readonly modelId: string;
  readonly responseText?: string;
  readonly delayMs?: number;
  readonly failure?: "provider" | "ambiguous";
  readonly toolCall?: boolean;
}

/**
 * Provides a minimal AI SDK v2 language-model implementation so the real
 * Agent.generate() lifecycle can run without a provider or test framework.
 * The runner injects this only for the fake provider; real runs use Mastra's
 * model router instead.
 */
export function createDeterministicFakeModel(options: DeterministicFakeModelOptions): MastraModelConfig {
  return {
    specificationVersion: "v2",
    provider: "agentlab.fake",
    modelId: options.modelId,
    supportedUrls: {},
    doGenerate: async ({ abortSignal, prompt }: FakeGenerateOptions) => {
      if (options.delayMs && options.delayMs > 0) {
        await waitForModel(options.delayMs, abortSignal);
      }

      if (options.failure) {
        const error = new Error(
          options.failure === "ambiguous"
            ? "The deterministic provider response was not confirmed."
            : "The deterministic provider rejected the request.",
        );
        error.name = options.failure === "ambiguous" ? "AmbiguousProviderError" : "ProviderError";
        throw error;
      }

      if (options.toolCall) {
        if (!containsToolResult(prompt)) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "mastra-calculator-1",
              toolName: "calculator",
              input: JSON.stringify({ operation: "add", left: 17, right: 25 }),
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
            warnings: [],
          };
        }

        return {
          content: [{ type: "text", text: "The calculator returned {\"value\":42}." }],
          finishReason: "stop",
          usage: { inputTokens: 18, outputTokens: 9, totalTokens: 27 },
          warnings: [],
        };
      }

      return {
        content: [{ type: "text", text: options.responseText ?? "Deterministic Mastra response." }],
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
        warnings: [],
      };
    },
    doStream: async () => {
      throw new Error("The Mastra baseline fake model only supports Agent.generate().");
    },
  } as unknown as MastraModelConfig;
}

interface FakeGenerateOptions {
  readonly abortSignal?: AbortSignal;
  readonly prompt?: unknown;
}

function containsToolResult(prompt: unknown): boolean {
  if (!Array.isArray(prompt)) return false;
  return JSON.stringify(prompt).includes('"tool-result"');
}

function waitForModel(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    const abort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    abortSignal?.addEventListener("abort", abort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("The deterministic model was aborted.");
  error.name = "AbortError";
  return error;
}
