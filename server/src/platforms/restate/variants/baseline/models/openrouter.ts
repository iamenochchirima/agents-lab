import type { ModelAdapter, ModelCallResult, ModelMessage, ModelRequest, ModelToolCall } from "../contracts.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ASSISTANT_TEXT_BYTES = 128 * 1024;
const MAX_TOOL_CALLS_PER_RESPONSE = 32;
const MAX_TOOL_CALL_ID_BYTES = 128;
const MAX_TOOL_NAME_BYTES = 64;
const MAX_TOOL_ARGUMENT_BYTES = 64 * 1024;
const MAX_PROVIDER_REQUEST_ID_BYTES = 256;
const MAX_PROVIDER_ERROR_CODE_BYTES = 128;
const MAX_PROVIDER_ERROR_MESSAGE_BYTES = 512;

export interface OpenRouterModelOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export class OpenRouterRestateModel implements ModelAdapter {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenRouterModelOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(input: ModelRequest, signal: AbortSignal): Promise<ModelCallResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
          "http-referer": "https://github.com/agent-harness-lab",
          "x-title": "Agent Harness Lab",
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages.length > 0 ? input.messages.map(toOpenRouterMessage) : [
            { role: "system", content: input.systemInstruction },
            { role: "user", content: input.prompt },
          ],
          ...(input.tools.length > 0 ? {
            tools: input.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
            tool_choice: "auto",
          } : {}),
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return {
          kind: "failure",
          code: "MODEL_CANCELLED",
          message: "The OpenRouter request was cancelled.",
          failureKind: "cancelled",
          retryable: false,
          requestSent: true,
        };
      }
      return {
        kind: "failure",
        code: "OPENROUTER_OUTCOME_UNKNOWN",
        message: "OpenRouter did not confirm whether the model request completed.",
        failureKind: "outcome_unknown",
        retryable: false,
        requestSent: true,
      };
    }

    const parsed = await readJson(response);
    if (parsed.tooLarge) {
      return providerFailure("OPENROUTER_RESPONSE_TOO_LARGE", "OpenRouter returned a response larger than the configured safety limit.");
    }
    const body = parsed.value;
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      return {
        kind: "failure",
        code: `OPENROUTER_HTTP_${response.status}`,
        message: retryable ? "OpenRouter returned a retryable provider response." : "OpenRouter rejected the model request.",
        failureKind: "provider",
        retryable,
        requestSent: true,
      };
    }

    const message = readMessage(body);
    if (message?.error) return providerFailure(message.error.code, message.error.message);
    if (!message || (!message.output && message.toolCalls.length === 0)) {
      return {
        kind: "failure",
        code: "OPENROUTER_INVALID_RESPONSE",
        message: "OpenRouter returned no assistant text or tool call.",
        failureKind: "provider",
        retryable: false,
        requestSent: true,
      };
    }
    const usageValue = objectValue(body, "usage");
    const inputTokens = numberValue(usageValue, "prompt_tokens");
    const outputTokens = numberValue(usageValue, "completion_tokens");
    const totalTokens = numberValue(usageValue, "total_tokens");
    const providerRequestId = stringValue(body, "id");
    if (providerRequestId && byteLength(providerRequestId) > MAX_PROVIDER_REQUEST_ID_BYTES) {
      return providerFailure("OPENROUTER_PROVIDER_ID_TOO_LARGE", "OpenRouter returned a provider request ID outside the configured safety limit.");
    }
    return {
      kind: "success",
      output: message.output,
      toolCalls: message.toolCalls,
      providerRequestId,
      usage: { inputTokens, outputTokens, totalTokens },
    };
  }
}

function providerFailure(code: string, message: string): ModelCallResult {
  return {
    kind: "failure",
    code: boundedText(code, MAX_PROVIDER_ERROR_CODE_BYTES),
    message: boundedText(message, MAX_PROVIDER_ERROR_MESSAGE_BYTES),
    failureKind: "provider",
    retryable: false,
    requestSent: true,
  };
}

function boundedText(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
}

function toOpenRouterMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.toolCalls && message.toolCalls.length > 0 ? {
        tool_calls: message.toolCalls.map((call) => ({
          id: call.toolCallId,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      } : {}),
    };
  }
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, name: message.name, content: message.content };
  }
  return { role: message.role, content: message.content };
}

function readMessage(value: unknown): { output: string | null; toolCalls: readonly ModelToolCall[]; error?: { code: string; message: string } } | null {
  const choices = objectValue(value, "choices");
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const message = objectValue(choices[0], "message");
  if (!message || typeof message !== "object") return null;
  const outputValue = objectValue(message, "content");
  const output = typeof outputValue === "string" && outputValue.trim() ? outputValue : null;
  if (output && Buffer.byteLength(output, "utf8") > MAX_ASSISTANT_TEXT_BYTES) {
    return { output: null, toolCalls: [], error: { code: "OPENROUTER_OUTPUT_TOO_LARGE", message: "OpenRouter assistant text exceeded the configured safety limit." } };
  }
  const rawCalls = objectValue(message, "tool_calls");
  const toolCalls: ModelToolCall[] = [];
  if (Array.isArray(rawCalls)) {
    if (rawCalls.length > MAX_TOOL_CALLS_PER_RESPONSE) {
      return { output: null, toolCalls: [], error: { code: "OPENROUTER_TOOL_CALLS_TOO_MANY", message: "OpenRouter returned more tool calls than the configured safety limit." } };
    }
    for (const rawCall of rawCalls) {
      if (!rawCall || typeof rawCall !== "object") continue;
      const functionValue = objectValue(rawCall, "function");
      if (!functionValue || typeof functionValue !== "object") continue;
      const name = stringValue(functionValue, "name");
      if (!name) continue;
      const toolCallId = stringValue(rawCall, "id") ?? "";
      const rawArguments = objectValue(functionValue, "arguments");
      const argumentBytes = byteLength(rawArguments);
      const knownToolLimit = toolLimitBytes(name);
      if (byteLength(toolCallId) > MAX_TOOL_CALL_ID_BYTES || byteLength(name) > MAX_TOOL_NAME_BYTES || argumentBytes > Math.min(MAX_TOOL_ARGUMENT_BYTES, knownToolLimit)) {
        return { output: null, toolCalls: [], error: { code: "OPENROUTER_TOOL_PAYLOAD_TOO_LARGE", message: "OpenRouter returned a tool call outside the configured safety limits." } };
      }
      toolCalls.push({
        toolCallId,
        name,
        arguments: parseArguments(rawArguments),
      });
    }
  }
  return { output, toolCalls };
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

async function readJson(response: Response): Promise<{ readonly tooLarge: boolean; readonly value: unknown }> {
  try {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) return { tooLarge: true, value: null };
    try {
      return { tooLarge: false, value: JSON.parse(text) as unknown };
    } catch {
      return { tooLarge: false, value: null };
    }
  } catch {
    return { tooLarge: false, value: null };
  }
}

function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value) ?? "", "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function toolLimitBytes(name: string): number {
  // Unknown tools are still bounded before the workflow's deny-by-default
  // registry gets a chance to reject them.
  return name === "calculator" ? 512 : MAX_TOOL_ARGUMENT_BYTES;
}

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value ? (value as Record<string, unknown>)[key] : null;
}

function stringValue(value: unknown, key: string): string | null {
  const result = objectValue(value, key);
  return typeof result === "string" ? result : null;
}

function numberValue(value: unknown, key: string): number | null {
  const result = objectValue(value, key);
  return typeof result === "number" && Number.isFinite(result) && result >= 0 ? result : null;
}
