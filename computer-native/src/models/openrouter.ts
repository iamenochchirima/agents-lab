import { ModelProviderError, redactSecrets } from "../runtime/errors.js";
import type { ModelRequest, ModelStreamEvent, ModelUsage } from "../runtime/contracts.js";
import type { ModelProvider } from "./provider.js";

interface OpenRouterChunk {
  readonly choices?: readonly [{ readonly delta?: { readonly content?: unknown } }?];
  readonly usage?: { readonly prompt_tokens?: unknown; readonly completion_tokens?: unknown; readonly total_tokens?: unknown };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function usageFrom(value: OpenRouterChunk["usage"]): ModelUsage | undefined {
  if (!value) return undefined;
  return {
    inputTokens: numberOrUndefined(value.prompt_tokens),
    outputTokens: numberOrUndefined(value.completion_tokens),
    totalTokens: numberOrUndefined(value.total_tokens),
  };
}

function parseChunk(data: string): ModelStreamEvent | undefined {
  if (data === "[DONE]") return { type: "completed" };
  let parsed: OpenRouterChunk;
  try {
    parsed = JSON.parse(data) as OpenRouterChunk;
  } catch {
    throw new ModelProviderError("OpenRouter returned an invalid streaming event.");
  }
  const content = parsed.choices?.[0]?.delta?.content;
  if (typeof content === "string" && content.length > 0) return { type: "text", text: content };
  const usage = usageFrom(parsed.usage);
  return usage ? { type: "completed", usage } : undefined;
}

export class OpenRouterModelProvider implements ModelProvider {
  readonly provider = "openrouter" as const;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    let response: Response;
    try {
      response = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ModelProviderError("OpenRouter request failed before a response was received.", { cause: error });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ModelProviderError(
        `OpenRouter returned HTTP ${response.status}: ${redactSecrets(body.slice(0, 500), [this.apiKey])}`,
      );
    }
    if (!response.body) throw new ModelProviderError("OpenRouter returned no response stream.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastUsage: ModelUsage | undefined;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/u);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const event = parseChunk(line.slice(5).trim());
          if (!event) continue;
          if (event.type === "completed") {
            lastUsage = event.usage ?? lastUsage;
            continue;
          }
          yield event;
        }
      }
      const trailing = buffer.trim();
      if (trailing.startsWith("data:")) {
        const event = parseChunk(trailing.slice(5).trim());
        if (event?.type === "text") yield event;
        if (event?.type === "completed") lastUsage = event.usage ?? lastUsage;
      }
    } finally {
      reader.releaseLock();
    }
    yield { type: "completed", usage: lastUsage };
  }
}
