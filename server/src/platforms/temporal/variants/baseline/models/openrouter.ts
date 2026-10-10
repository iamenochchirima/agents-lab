import { openRouterResponseMetadata, type OpenRouterResponseMetadata } from "../../../../../models/openrouter/response-metadata.js";
import { FREE_PROVIDER_ROUTING, getFreeEvalSettings, assertFreeModelRequest } from "../../../../../models/openrouter/free-model-policy.js";
import type { ModelAdapter, ModelCallResult, ModelRequestInput } from "../contracts.js";
import type { ToolDefinition } from "../../../../../capabilities/tools/contracts.js";

const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_OUTPUT_CHARS = 100_000;

export interface OpenRouterModelAdapterOptions {
  readonly apiKey: string | undefined;
  readonly baseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
}

/**
 * The provider adapter is intentionally non-retrying. Once an HTTP request is
 * sent, a lost response cannot be safely replayed by this baseline.
 */
export class OpenRouterModelAdapter implements ModelAdapter {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: OpenRouterModelAdapterOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async complete(input: ModelRequestInput, signal: AbortSignal): Promise<ModelCallResult> {
    const requestBody = {
          model: input.model,
          messages: (input.messages ?? [
            { role: "system", content: input.systemInstruction },
            { role: "user", content: input.prompt },
          ]).map(toOpenRouterMessage),
          ...(input.tools && input.tools.length > 0 ? {
            tools: input.tools.map(toOpenRouterTool),
            tool_choice: "auto",
          } : {}),
        };
    if (input.liveEval) {
      Object.assign(requestBody, { provider: FREE_PROVIDER_ROUTING, max_tokens: getFreeEvalSettings(input.liveEvalExperiment ?? "agent-harness-live")?.maxOutputTokens });
      try {
        assertFreeModelRequest(requestBody, input.model, input.liveEvalExperiment);
      } catch {
        return { kind: "failure", failureKind: "configuration", code: "LIVE_EVAL_FREE_MODEL_REQUIRED", message: "Live evals require the exact free model and zero-price provider routing.", requestSent: false };
      }
    }
    let responseMetadata: Partial<OpenRouterResponseMetadata> = {};
    const result = await this.execute(input, signal, requestBody, body => {
      if (input.liveEval) responseMetadata = openRouterResponseMetadata(body);
    });
    if (!input.liveEval) return result;
    return { ...result,  evalObservation: {
      ...result.evalObservation,
      ...responseMetadata,
      systemInstruction: input.systemInstruction,
      messages: input.messages ?? [{ role: "system", content: input.systemInstruction }, { role: "user", content: input.prompt }],
      tools: input.tools ?? [],
      providerRequest: requestBody,
      toolCalls: result.kind === "success" ? result.toolCalls ?? [] : [],
      providerRequestId: responseMetadata.providerRequestId ?? (result.kind === "success" ? result.providerRequestId : null),
      output: result.kind === "success" ? result.output : null,
      ...(result.kind === "failure" ? { errorCode: result.code } : {}),
    } };
  }

  private async execute(input: ModelRequestInput, signal: AbortSignal, requestBody: Record<string, unknown>, observeResponse: (body: unknown) => void): Promise<ModelCallResult> {
    const apiKey = this.options.apiKey?.trim();
    if (!apiKey) {
      return {
        kind: "failure",
        failureKind: "configuration",
        code: "OPENROUTER_API_KEY_MISSING",
        message: "OPENROUTER_API_KEY is required for the OpenRouter adapter.",
        requestSent: false,
      };
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.options.baseUrl?.replace(/\/$/, "") || OPENROUTER_DEFAULT_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      return {
        kind: "failure",
        failureKind: "outcome_unknown",
        code: "OPENROUTER_RESPONSE_UNKNOWN",
        message: "The OpenRouter request was sent but its outcome could not be confirmed.",
        requestSent: true,
      };
    }

    const responseBody = await readResponseText(response);
    if (responseBody.kind === "too_large") {
      return {
        kind: "failure",
        failureKind: "provider",
        code: "OPENROUTER_RESPONSE_TOO_LARGE",
        message: "OpenRouter returned a response larger than the configured safety limit.",
        requestSent: true,
      };
    }
    if (responseBody.kind === "invalid") {
      return {
        kind: "failure",
        failureKind: "provider",
        code: "OPENROUTER_INVALID_RESPONSE",
        message: "OpenRouter returned a response that could not be read.",
        requestSent: true,
      };
    }

    const responseText = responseBody.text;
    let body: unknown;
    let invalidJson = false;
    try { body = JSON.parse(responseText); } catch { invalidJson = true; }
    if (!invalidJson) observeResponse(body);
    if (!response.ok) {
      if ((response.status === 400 || response.status === 413) && isContextOverflowResponse(responseText)) {
        return {
          kind: "failure",
          failureKind: "provider",
          code: "OPENROUTER_CONTEXT_OVERFLOW",
          message: "OpenRouter rejected the request because its context window was exceeded.",
          requestSent: true,
        };
      }
      return {
        kind: "failure",
        failureKind: "provider",
        code: `OPENROUTER_HTTP_${response.status}`,
        message: `OpenRouter returned HTTP ${response.status}.`,
        requestSent: true,
      };
    }

    if (invalidJson) {
      return {
        kind: "failure",
        failureKind: "provider",
        code: "OPENROUTER_INVALID_RESPONSE",
        message: "OpenRouter returned a response that was not valid JSON.",
        requestSent: true,
      };
    }

    const message = extractMessage(body);
    if (!message || (message.output === null && message.toolCalls.length === 0)) {
      return {
        kind: "failure",
        failureKind: "provider",
        code: "OPENROUTER_EMPTY_RESPONSE",
        message: "OpenRouter returned no assistant text.",
        requestSent: true,
      };
    }
    if (message.output !== null && message.output.length > MAX_OUTPUT_CHARS) {
      return {
        kind: "failure",
        failureKind: "provider",
        code: "OPENROUTER_OUTPUT_TOO_LARGE",
        message: "OpenRouter assistant output exceeded the configured safety limit.",
        requestSent: true,
      };
    }

    return {
      kind: "success",
      output: message.output,
      ...(message.toolCalls.length > 0 ? { toolCalls: message.toolCalls } : {}),
      providerRequestId: readString(body, "id"),
      ...(input.liveEval ? { evalObservation: { systemInstruction: input.systemInstruction, messages: input.messages ?? [], toolCalls: message.toolCalls, providerModel: readString(body, "model"), providerName: readString(body, "provider") } } : {}),
      usage: readUsage(body),
    };
  }
}

async function readResponseText(response: Response): Promise<ResponseTextResult> {
  if (!response.body) return { kind: "invalid" };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) return { kind: "too_large" };
      chunks.push(chunk.value);
    }
  } catch {
    return { kind: "invalid" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "ok", text: new TextDecoder().decode(bytes) };
}

type ResponseTextResult =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "too_large" }
  | { readonly kind: "invalid" };

function isContextOverflowResponse(body: string): boolean {
  return /context|token limit|maximum tokens|too many tokens|prompt is too long/i.test(body);
}

function extractMessage(body: unknown): { readonly output: string | null; readonly toolCalls: readonly import("../contracts.js").TemporalModelToolCall[] } | null {
  if (!isRecord(body) || !Array.isArray(body.choices) || !isRecord(body.choices[0])) {
    return null;
  }
  const message = body.choices[0].message;
  if (!isRecord(message)) return null;
  const output = typeof message.content === "string" && message.content.length > 0 ? message.content : null;
  const toolCalls: import("../contracts.js").TemporalModelToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const rawCall of message.tool_calls) {
      if (!isRecord(rawCall) || !isRecord(rawCall.function)) continue;
      const name = typeof rawCall.function.name === "string" ? rawCall.function.name : "";
      if (!name) continue;
      const toolCallId = typeof rawCall.id === "string" ? rawCall.id : "";
      toolCalls.push({
        toolCallId,
        name,
        arguments: parseArguments(rawCall.function.arguments),
      });
    }
  }
  return { output, toolCalls };
}

function toOpenRouterTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  };
}

function toOpenRouterMessage(message: import("../contracts.js").TemporalModelMessage): Record<string, unknown> {
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

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function readString(body: unknown, key: string): string | null {
  return isRecord(body) && typeof body[key] === "string" ? body[key] : null;
}

function readUsage(body: unknown) {
  if (!isRecord(body) || !isRecord(body.usage)) {
    return { inputTokens: null, outputTokens: null, totalTokens: null } as const;
  }

  const inputTokens = integerOrNull(body.usage.prompt_tokens);
  const outputTokens = integerOrNull(body.usage.completion_tokens);
  const totalTokens = integerOrNull(body.usage.total_tokens);
  return { inputTokens, outputTokens, totalTokens } as const;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object";
}
