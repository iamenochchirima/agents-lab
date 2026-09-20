import type { MastraModelConfig } from "@mastra/core/llm";

export interface DeterministicFakeModelOptions {
  readonly modelId: string;
  readonly responseText?: string;
  readonly delayMs?: number;
  readonly failure?: "provider" | "ambiguous";
  readonly toolCall?: boolean;
  readonly toolName?: "calculator" | "fixture_lookup" | "fixture_write";
  readonly contextAware?: boolean;
}

/**
 * Provides a minimal AI SDK v2 language-model implementation so the real
 * Agent.generate() and Agent.stream() lifecycles can run without a provider
 * or test framework.
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
              toolCallId: options.toolName === "fixture_lookup" ? "mastra-fixture-lookup-1" : options.toolName === "fixture_write" ? "mastra-fixture-write-1" : "mastra-calculator-1",
              toolName: options.toolName ?? "calculator",
              input: options.toolName === "fixture_lookup"
                ? JSON.stringify({ key: "alpha" })
                : options.toolName === "fixture_write"
                  ? JSON.stringify({ key: "alpha", value: "updated" })
                  : JSON.stringify({ operation: "add", left: 17, right: 25 }),
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
            warnings: [],
          };
        }

        return {
          content: [{
            type: "text",
            text: options.toolName === "fixture_lookup"
              ? "The local fixture returned {\"key\":\"alpha\",\"value\":\"local fixture alpha\"}."
              : options.toolName === "fixture_write"
                ? "The local fixture write returned {\"key\":\"alpha\",\"written\":true}."
              : "The calculator returned {\"value\":42}.",
          }],
          finishReason: "stop",
          usage: { inputTokens: 18, outputTokens: 9, totalTokens: 27 },
          warnings: [],
        };
      }

      if (options.contextAware) {
        const serializedPrompt = JSON.stringify(prompt);
        if (serializedPrompt.includes("Stored the test value.")) {
          return {
            content: [{ type: "text", text: "conformance-4318" }],
            finishReason: "stop",
            usage: { inputTokens: 18, outputTokens: 4, totalTokens: 22 },
            warnings: [],
          };
        }
        return {
          content: [{ type: "text", text: "Stored the test value." }],
          finishReason: "stop",
          usage: { inputTokens: 9, outputTokens: 5, totalTokens: 14 },
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
    doStream: async ({ abortSignal }: FakeStreamOptions = {}) => {
      if (abortSignal?.aborted) throw abortError();
      const text = options.responseText ?? "Deterministic Mastra response.";
      const stream = new ReadableStream<Record<string, unknown>>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({
            type: "response-metadata",
            id: `${options.modelId}-stream`,
            modelId: options.modelId,
            timestamp: new Date(0),
          });
          controller.enqueue({ type: "text-start", id: "mastra-text-1" });
          controller.enqueue({ type: "text-delta", id: "mastra-text-1", delta: text });
          controller.enqueue({ type: "text-end", id: "mastra-text-1" });
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
          });
          controller.close();
        },
      });
      return {
        stream,
        request: { body: "{}" },
        response: { headers: {} },
        rawResponse: {},
      };
    },
  } as unknown as MastraModelConfig;
}

interface FakeGenerateOptions {
  readonly abortSignal?: AbortSignal;
  readonly prompt?: unknown;
}

interface FakeStreamOptions {
  readonly abortSignal?: AbortSignal;
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
