import type { ModelAdapter, ModelCallResult, ModelRequest } from "../contracts.js";

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
          messages: [
            { role: "system", content: input.systemInstruction },
            { role: "user", content: input.prompt },
          ],
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

    const body = await readJson(response);
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

    const output = readText(body, ["choices", 0, "message", "content"]);
    if (!output) {
      return {
        kind: "failure",
        code: "OPENROUTER_INVALID_RESPONSE",
        message: "OpenRouter returned no assistant content.",
        failureKind: "provider",
        retryable: false,
        requestSent: true,
      };
    }

    const usageValue = objectValue(body, "usage");
    const inputTokens = numberValue(usageValue, "prompt_tokens");
    const outputTokens = numberValue(usageValue, "completion_tokens");
    const totalTokens = numberValue(usageValue, "total_tokens");
    return {
      kind: "success",
      output,
      providerRequestId: stringValue(body, "id"),
      usage: { inputTokens, outputTokens, totalTokens },
    };
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function readText(value: unknown, path: readonly (string | number)[]): string | null {
  let current = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return null;
      current = current[key];
    } else {
      current = objectValue(current, key);
    }
  }
  return typeof current === "string" && current.trim() ? current : null;
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
  return typeof result === "number" && Number.isFinite(result) ? result : null;
}
