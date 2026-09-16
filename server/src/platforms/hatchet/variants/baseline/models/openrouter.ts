import type {
  HatchetModelAdapter,
  HatchetModelCallResult,
  HatchetModelRequestInput,
} from "../contracts.js";

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_OUTPUT_CHARS = 100_000;

export interface OpenRouterHatchetModelAdapterOptions {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly fetchImplementation?: typeof fetch;
}

/**
 * Provider calls are not retried in the task function. A response lost after
 * the request was sent cannot be safely replayed without duplicating provider
 * work, so the result is surfaced as an unknown outcome.
 */
export class OpenRouterHatchetModelAdapter implements HatchetModelAdapter {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: OpenRouterHatchetModelAdapterOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async complete(
    input: HatchetModelRequestInput,
    signal: AbortSignal,
  ): Promise<HatchetModelCallResult> {
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
      response = await this.fetchImplementation(
        `${this.options.baseUrl}/chat/completions`,
        {
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
        },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      return {
        kind: "failure",
        failureKind: "outcome_unknown",
        code: "OPENROUTER_RESPONSE_UNKNOWN",
        message:
          "The OpenRouter request was sent but its outcome could not be confirmed.",
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

    const body = await readJson(response);
    if (body.kind === "too_large") {
      return {
        kind: "failure",
        failureKind: "provider",
        code: "OPENROUTER_RESPONSE_TOO_LARGE",
        message: "OpenRouter returned a response larger than the configured safety limit.",
        requestSent: true,
      };
    }
    if (body.kind === "invalid") {
      return {
        kind: "failure",
        failureKind: "provider",
        code: "OPENROUTER_INVALID_RESPONSE",
        message: "OpenRouter returned a response that was not valid JSON.",
        requestSent: true,
      };
    }

    const output = extractOutput(body.value);
    if (output === null) {
      return {
        kind: "failure",
        failureKind: "provider",
        code: "OPENROUTER_EMPTY_RESPONSE",
        message: "OpenRouter returned no assistant text.",
        requestSent: true,
      };
    }
    if (output.length > MAX_OUTPUT_CHARS) {
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
      output,
      providerRequestId: readString(body.value, "id"),
      usage: readUsage(body.value),
    };
  }
}

async function readJson(response: Response): Promise<JsonReadResult> {
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
  try {
    return { kind: "ok", value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { kind: "invalid" };
  }
}

type JsonReadResult =
  | { readonly kind: "ok"; readonly value: unknown }
  | { readonly kind: "too_large" }
  | { readonly kind: "invalid" };

function extractOutput(body: unknown): string | null {
  if (
    !isRecord(body) ||
    !Array.isArray(body.choices) ||
    !isRecord(body.choices[0])
  )
    return null;
  const message = body.choices[0].message;
  return isRecord(message) && typeof message.content === "string"
    ? message.content
    : null;
}

function readString(body: unknown, key: string): string | null {
  return isRecord(body) && typeof body[key] === "string" ? body[key] : null;
}

function readUsage(body: unknown) {
  if (!isRecord(body) || !isRecord(body.usage)) {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    } as const;
  }

  return {
    inputTokens: integerOrNull(body.usage.prompt_tokens),
    outputTokens: integerOrNull(body.usage.completion_tokens),
    totalTokens: integerOrNull(body.usage.total_tokens),
  } as const;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object";
}
