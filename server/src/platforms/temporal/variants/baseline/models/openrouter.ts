import type { ModelAdapter, ModelCallResult, ModelRequestInput } from "../contracts.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterModelAdapterOptions {
  readonly apiKey: string | undefined;
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
      response = await this.fetchImplementation(OPENROUTER_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          messages: [
            { role: "system", content: input.systemInstruction },
            { role: "user", content: input.prompt },
          ],
        }),
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

    if (!response.ok) {
      return {
        kind: "failure",
        failureKind: "provider",
        code: `OPENROUTER_HTTP_${response.status}`,
        message: `OpenRouter returned HTTP ${response.status}.`,
        requestSent: true,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        kind: "failure",
        failureKind: "provider",
        code: "OPENROUTER_INVALID_RESPONSE",
        message: "OpenRouter returned a response that was not valid JSON.",
        requestSent: true,
      };
    }

    const output = extractOutput(body);
    if (output === null) {
      return {
        kind: "failure",
        failureKind: "provider",
        code: "OPENROUTER_EMPTY_RESPONSE",
        message: "OpenRouter returned no assistant text.",
        requestSent: true,
      };
    }

    return {
      kind: "success",
      output,
      providerRequestId: readString(body, "id"),
      usage: readUsage(body),
    };
  }
}

function extractOutput(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices) || !isRecord(body.choices[0])) {
    return null;
  }
  const message = body.choices[0].message;
  if (!isRecord(message) || typeof message.content !== "string") {
    return null;
  }
  return message.content;
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
