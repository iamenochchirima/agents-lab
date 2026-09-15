import type { MastraModelConfig } from "@mastra/core/llm";

export interface DeterministicFakeModelOptions {
  readonly modelId: string;
  readonly responseText?: string;
  readonly delayMs?: number;
  readonly failure?: "provider" | "ambiguous";
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
    doGenerate: async ({ abortSignal }: FakeGenerateOptions) => {
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
