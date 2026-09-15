import { ModelProviderError, redactSecrets } from "../runtime/errors.js";
import type { ModelMessage, ModelRequest, ModelStreamEvent, ModelToolCall, ModelUsage } from "../runtime/contracts.js";
import type { ModelProvider } from "./provider.js";

interface OpenRouterChunk {
  readonly choices?: readonly [{ readonly delta?: { readonly content?: unknown; readonly tool_calls?: readonly OpenRouterToolCallDelta[] } }?];
  readonly usage?: { readonly prompt_tokens?: unknown; readonly completion_tokens?: unknown; readonly total_tokens?: unknown };
}

interface OpenRouterToolCallDelta {
  readonly index?: unknown;
  readonly id?: unknown;
  readonly function?: { readonly name?: unknown; readonly arguments?: unknown };
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

function parseChunk(data: string): { readonly text?: string; readonly usage?: ModelUsage; readonly toolCalls: readonly OpenRouterToolCallDelta[]; readonly done: boolean } | undefined {
  if (data.length === 0) return undefined;
  if (data === "[DONE]") return { toolCalls: [], done: true };
  let parsed: OpenRouterChunk;
  try {
    parsed = JSON.parse(data) as OpenRouterChunk;
  } catch {
    throw new ModelProviderError("OpenRouter returned an invalid streaming event.");
  }
  const content = parsed.choices?.[0]?.delta?.content;
  const text = typeof content === "string" && content.length > 0 ? content : undefined;
  const usage = usageFrom(parsed.usage);
  return { text, usage, toolCalls: parsed.choices?.[0]?.delta?.tool_calls ?? [], done: false };
}

function toolCallFrom(index: number, value: { readonly id?: string; readonly name: string; readonly argumentsJson: string }): ModelToolCall {
  return {
    callId: value.id ?? `call_${index + 1}`,
    name: value.name,
    argumentsJson: value.argumentsJson,
  };
}

function wireMessages(messages: readonly ModelMessage[]): readonly Record<string, unknown>[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.toolCalls ? {
      tool_calls: message.toolCalls.map((call) => ({
        id: call.callId,
        type: "function",
        function: { name: call.name, arguments: call.argumentsJson },
      })),
    } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.name ? { name: message.name } : {}),
  }));
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
          messages: wireMessages(request.messages),
          tools: request.tools?.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
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
        { code: response.status === 429 ? "rate-limit" : "provider" },
      );
    }
    if (!response.body) throw new ModelProviderError("OpenRouter returned no response stream.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastUsage: ModelUsage | undefined;
    let sawDone = false;
    const toolCalls = new Map<number, { id?: string; name: string; argumentsJson: string }>();
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
          if (event.done) sawDone = true;
          if (event.text) yield { type: "text", text: event.text };
          lastUsage = event.usage ?? lastUsage;
          for (const delta of event.toolCalls) {
            const index = typeof delta.index === "number" && Number.isInteger(delta.index) ? delta.index : toolCalls.size;
            const existing = toolCalls.get(index) ?? { name: "", argumentsJson: "" };
            const id = typeof delta.id === "string" ? delta.id : existing.id;
            const name = typeof delta.function?.name === "string" ? `${existing.name}${delta.function.name}` : existing.name;
            const argumentsJson = typeof delta.function?.arguments === "string" ? `${existing.argumentsJson}${delta.function.arguments}` : existing.argumentsJson;
            toolCalls.set(index, { id, name, argumentsJson });
          }
        }
      }
      const trailing = buffer.trim();
      if (trailing.startsWith("data:")) {
        const event = parseChunk(trailing.slice(5).trim());
        if (event?.done) sawDone = true;
        if (event?.text) yield { type: "text", text: event.text };
        if (event?.usage) lastUsage = event.usage;
        for (const delta of event?.toolCalls ?? []) {
          const index = typeof delta.index === "number" && Number.isInteger(delta.index) ? delta.index : toolCalls.size;
          const existing = toolCalls.get(index) ?? { name: "", argumentsJson: "" };
          const id = typeof delta.id === "string" ? delta.id : existing.id;
          const name = typeof delta.function?.name === "string" ? `${existing.name}${delta.function.name}` : existing.name;
          const argumentsJson = typeof delta.function?.arguments === "string" ? `${existing.argumentsJson}${delta.function.arguments}` : existing.argumentsJson;
          toolCalls.set(index, { id, name, argumentsJson });
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (!sawDone) throw new ModelProviderError("OpenRouter stream ended before completion.", { code: "provider-incomplete" });
    for (const [index, value] of [...toolCalls.entries()].sort(([left], [right]) => left - right)) {
      if (value.name.length === 0) throw new ModelProviderError("OpenRouter returned an incomplete tool call.", { code: "provider-incomplete" });
      yield { type: "tool_call", call: toolCallFrom(index, value) };
    }
    yield { type: "completed", usage: lastUsage };
  }
}
