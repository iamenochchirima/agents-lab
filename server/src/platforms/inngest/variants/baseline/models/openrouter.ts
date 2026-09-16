import type { InngestModelRequest, InngestModelResult } from "../contracts.js";

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_OUTPUT_CHARS = 100_000;

export interface InngestOpenRouterModelOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetchImplementation?: typeof fetch;
}

export async function completeOpenRouterModel(
  input: InngestModelRequest,
  options: InngestOpenRouterModelOptions,
  signal?: AbortSignal,
): Promise<InngestModelResult> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(`${options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
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
  } catch {
    return {
      kind: "failure",
      code: "OPENROUTER_OUTCOME_UNKNOWN",
      message: "OpenRouter did not confirm whether the model request completed.",
      failureKind: "outcome_unknown",
      retryable: false,
      requestSent: true,
    };
  }

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

  const body = await readJson(response);
  if (body.kind === "too_large") {
    return {
      kind: "failure",
      code: "OPENROUTER_RESPONSE_TOO_LARGE",
      message: "OpenRouter returned a response larger than the configured safety limit.",
      failureKind: "provider",
      retryable: false,
      requestSent: true,
    };
  }

  if (body.kind === "invalid") {
    return {
      kind: "failure",
      code: "OPENROUTER_INVALID_RESPONSE",
      message: "OpenRouter returned no assistant content.",
      failureKind: "provider",
      retryable: false,
      requestSent: true,
    };
  }

  const output = readText(body.value, ["choices", 0, "message", "content"]);
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
  if (output.length > MAX_OUTPUT_CHARS) {
    return {
      kind: "failure",
      code: "OPENROUTER_OUTPUT_TOO_LARGE",
      message: "OpenRouter assistant output exceeded the configured safety limit.",
      failureKind: "provider",
      retryable: false,
      requestSent: true,
    };
  }

  const usage = objectValue(body.value, "usage");
  return {
    kind: "success",
    output,
    providerRequestId: stringValue(body.value, "id"),
    usage: {
      inputTokens: numberValue(usage, "prompt_tokens"),
      outputTokens: numberValue(usage, "completion_tokens"),
      totalTokens: numberValue(usage, "total_tokens"),
    },
  };
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
