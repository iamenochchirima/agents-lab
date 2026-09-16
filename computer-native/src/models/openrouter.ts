import { ComputerNativeError, isAbortError, ModelProviderError, redactSecrets } from "../runtime/errors.js";
import type { ModelMessage, ModelRequest, ModelStreamEvent, ModelToolCall, ModelUsage } from "../runtime/contracts.js";
import { OPENROUTER_CAPABILITIES, type ModelProvider } from "./provider.js";

interface OpenRouterChunk {
  readonly choices?: readonly [{ readonly delta?: { readonly content?: unknown; readonly refusal?: unknown; readonly tool_calls?: readonly OpenRouterToolCallDelta[] } }?];
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

function retryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function providerHttpFailure(status: number, body: string): { readonly code: "provider" | "provider-context" | "provider-refusal" | "provider-auth" | "rate-limit"; readonly retryable: boolean } {
  const normalized = body.toLowerCase();
  if (status === 429) return { code: "rate-limit", retryable: true };
  if (status === 401 || status === 403) return { code: "provider-auth", retryable: false };
  if (status === 400 || status === 413) {
    if (/context|token limit|maximum .*length|prompt .*too (large|long)|request .*too (large|long)/u.test(normalized)) {
      return { code: "provider-context", retryable: false };
    }
    if (/refus|safety|content policy|blocked/u.test(normalized)) {
      return { code: "provider-refusal", retryable: false };
    }
  }
  return { code: "provider", retryable: retryableHttpStatus(status) };
}

function parseChunk(data: string): { readonly text?: string; readonly refusal?: string; readonly usage?: ModelUsage; readonly toolCalls: readonly OpenRouterToolCallDelta[]; readonly done: boolean } | undefined {
  if (data.length === 0) return undefined;
  if (data === "[DONE]") return { toolCalls: [], done: true };
  let parsed: OpenRouterChunk;
  try {
    const candidate = JSON.parse(data) as unknown;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("stream event is not an object");
    parsed = candidate as OpenRouterChunk;
  } catch {
    throw new ModelProviderError("OpenRouter returned an invalid streaming event.", { code: "provider-incomplete", retryable: false });
  }
  if (parsed.choices !== undefined && !Array.isArray(parsed.choices)) {
    throw new ModelProviderError("OpenRouter returned an invalid choices field.", { code: "provider-incomplete", retryable: false });
  }
  const firstChoice = parsed.choices?.[0];
  if (firstChoice !== undefined && firstChoice !== null && (typeof firstChoice !== "object" || Array.isArray(firstChoice))) {
    throw new ModelProviderError("OpenRouter returned an invalid choice entry.", { code: "provider-incomplete", retryable: false });
  }
  const delta = firstChoice?.delta;
  if (delta !== undefined && delta !== null && (typeof delta !== "object" || Array.isArray(delta))) {
    throw new ModelProviderError("OpenRouter returned an invalid delta.", { code: "provider-incomplete", retryable: false });
  }
  if (delta?.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) {
    throw new ModelProviderError("OpenRouter returned an invalid tool-call list.", { code: "provider-incomplete", retryable: false });
  }
  for (const toolCall of delta?.tool_calls ?? []) {
    if (!toolCall || typeof toolCall !== "object" || Array.isArray(toolCall)) {
      throw new ModelProviderError("OpenRouter returned an invalid tool-call entry.", { code: "provider-incomplete", retryable: false });
    }
    if (toolCall.function !== undefined && (!toolCall.function || typeof toolCall.function !== "object" || Array.isArray(toolCall.function))) {
      throw new ModelProviderError("OpenRouter returned an invalid tool-call function.", { code: "provider-incomplete", retryable: false });
    }
  }
  const content = parsed.choices?.[0]?.delta?.content;
  const refusal = parsed.choices?.[0]?.delta?.refusal;
  const text = typeof content === "string" && content.length > 0 ? content : undefined;
  const refusalText = typeof refusal === "string" && refusal.length > 0 ? refusal : undefined;
  const usage = usageFrom(parsed.usage);
  return { text, refusal: refusalText, usage, toolCalls: parsed.choices?.[0]?.delta?.tool_calls ?? [], done: false };
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
  readonly capabilities = OPENROUTER_CAPABILITIES;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxOutputBytes = 256 * 1024,
  ) {}

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    const requestStartedAt = Date.now();
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
      throw new ModelProviderError("OpenRouter request failed before a response was received.", { cause: error, retryable: true });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const failure = providerHttpFailure(response.status, body);
      throw new ModelProviderError(
        `OpenRouter returned HTTP ${response.status}: ${redactSecrets(body.slice(0, 500), [this.apiKey])}`,
        { code: failure.code, retryable: failure.retryable },
      );
    }
    if (!response.body) throw new ModelProviderError("OpenRouter returned no response stream.");

    const providerRequestId = [response.headers.get("x-request-id"), response.headers.get("x-openrouter-request-id")]
      .map((value) => value?.trim())
      .find((value): value is string => value !== undefined && value.length > 0);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let lastUsage: ModelUsage | undefined;
    let sawDone = false;
    let sawOutputEvent = false;
    let responseBytes = 0;
    const toolCalls = new Map<number, { id?: string; name: string; argumentsJson: string }>();
    const countResponseBytes = (value: string): void => {
      responseBytes += Buffer.byteLength(value, "utf8");
      if (responseBytes > this.maxOutputBytes) {
        throw new ComputerNativeError("resource-limit", `The model response exceeded the ${this.maxOutputBytes}-byte limit.`);
      }
    };
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
          if (event.refusal) throw new ModelProviderError("OpenRouter refused the request.", { code: "provider-refusal", retryable: false });
          if (event.text) {
            sawOutputEvent = true;
            countResponseBytes(event.text);
            yield { type: "text", text: event.text };
          }
          lastUsage = event.usage ?? lastUsage;
          for (const delta of event.toolCalls) {
            sawOutputEvent = true;
            const index = typeof delta.index === "number" && Number.isInteger(delta.index) ? delta.index : toolCalls.size;
            const existing = toolCalls.get(index) ?? { name: "", argumentsJson: "" };
            if (typeof delta.id === "string") countResponseBytes(delta.id);
            if (typeof delta.function?.name === "string") countResponseBytes(delta.function.name);
            if (typeof delta.function?.arguments === "string") countResponseBytes(delta.function.arguments);
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
        if (event?.refusal) throw new ModelProviderError("OpenRouter refused the request.", { code: "provider-refusal", retryable: false });
        if (event?.text) {
          sawOutputEvent = true;
          countResponseBytes(event.text);
          yield { type: "text", text: event.text };
        }
        if (event?.usage) lastUsage = event.usage;
        for (const delta of event?.toolCalls ?? []) {
          sawOutputEvent = true;
          const index = typeof delta.index === "number" && Number.isInteger(delta.index) ? delta.index : toolCalls.size;
          const existing = toolCalls.get(index) ?? { name: "", argumentsJson: "" };
          if (typeof delta.id === "string") countResponseBytes(delta.id);
          if (typeof delta.function?.name === "string") countResponseBytes(delta.function.name);
          if (typeof delta.function?.arguments === "string") countResponseBytes(delta.function.arguments);
          const id = typeof delta.id === "string" ? delta.id : existing.id;
          const name = typeof delta.function?.name === "string" ? `${existing.name}${delta.function.name}` : existing.name;
          const argumentsJson = typeof delta.function?.arguments === "string" ? `${existing.argumentsJson}${delta.function.arguments}` : existing.argumentsJson;
          toolCalls.set(index, { id, name, argumentsJson });
        }
      }
    } catch (error) {
      if (error instanceof ComputerNativeError || isAbortError(error)) throw error;
      throw new ModelProviderError("OpenRouter response stream disconnected before completion.", {
        cause: error,
        retryable: !sawOutputEvent,
      });
    } finally {
      reader.releaseLock();
    }
    if (!sawDone) throw new ModelProviderError("OpenRouter stream ended before completion.", { code: "provider-incomplete" });
    for (const [index, value] of [...toolCalls.entries()].sort(([left], [right]) => left - right)) {
      if (value.name.length === 0) throw new ModelProviderError("OpenRouter returned an incomplete tool call.", { code: "provider-incomplete" });
      yield { type: "tool_call", call: toolCallFrom(index, value) };
    }
    yield {
      type: "completed",
      usage: lastUsage,
      ...(providerRequestId ? { providerRequestId: redactSecrets(providerRequestId, [this.apiKey]).slice(0, 256) } : {}),
      latencyMs: Math.max(0, Date.now() - requestStartedAt),
    };
  }
}
