import type {
  VercelWorkflowModelRequest,
  VercelWorkflowModelResult,
} from "../contracts.js";

export const VERCEL_OPENROUTER_MAX_RESPONSE_BYTES = 1_048_576;

export interface OpenRouterModelOptions {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly fetchImplementation?: typeof fetch;
}

/** Executes the external model call inside a Workflow step boundary. */
export async function completeOpenRouterModel(
  input: VercelWorkflowModelRequest,
  options: OpenRouterModelOptions,
): Promise<VercelWorkflowModelResult> {
  if (!options.apiKey) {
    return {
      kind: "failure",
      requestSent: false,
      error: {
        code: "OPENROUTER_NOT_CONFIGURED",
        message: "OpenRouter is not configured for the Workflow service process.",
        failureKind: "configuration",
        retryable: false,
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.modelTimeoutMs);
  try {
    const response = await (options.fetchImplementation ?? fetch)(`${options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model.model,
        messages: [
          { role: "system", content: input.systemInstruction },
          { role: "user", content: input.prompt },
        ],
      }),
      signal: controller.signal,
    });

    const bodyResult = await readJson(response);
    if (bodyResult.kind === "too_large") {
      return {
        kind: "failure",
        requestSent: true,
        error: {
          code: "OPENROUTER_RESPONSE_TOO_LARGE",
          message: "OpenRouter response exceeded the configured response limit.",
          failureKind: "provider",
          retryable: false,
        },
      };
    }
    if (!response.ok) {
      return {
        kind: "failure",
        requestSent: true,
        error: {
          code: response.status === 429 ? "OPENROUTER_RATE_LIMITED" : "OPENROUTER_REQUEST_FAILED",
          message: `OpenRouter returned HTTP ${response.status}.`,
          failureKind: response.status === 429 || response.status >= 500 ? "provider" : "provider",
          retryable: response.status === 429 || response.status >= 500,
        },
      };
    }

    const record = asRecord(bodyResult.kind === "parsed" ? bodyResult.value : null);
    const choices = Array.isArray(record.choices) ? record.choices : [];
    const firstChoice = asRecord(choices[0]);
    const message = asRecord(firstChoice.message);
    const output = typeof message.content === "string" ? message.content : null;
    if (!output) {
      return {
        kind: "failure",
        requestSent: true,
        error: {
          code: "OPENROUTER_INVALID_RESPONSE",
          message: "OpenRouter returned no text content.",
          failureKind: "provider",
          retryable: false,
        },
      };
    }

    const usage = asRecord(record.usage);
    return {
      kind: "success",
      output,
      providerRequestId: typeof record.id === "string" ? record.id : null,
      usage: {
        inputTokens: numberOrNull(usage.prompt_tokens),
        outputTokens: numberOrNull(usage.completion_tokens),
        totalTokens: numberOrNull(usage.total_tokens),
      },
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      kind: "failure",
      requestSent: true,
      error: {
        code: timedOut ? "OPENROUTER_TIMEOUT" : "OPENROUTER_TRANSPORT_ERROR",
        message: timedOut ? "OpenRouter request timed out." : "OpenRouter request failed before a response was received.",
        failureKind: timedOut ? "timeout" : "provider",
        retryable: true,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

type JsonReadResult =
  | { readonly kind: "parsed"; readonly value: unknown }
  | { readonly kind: "invalid" }
  | { readonly kind: "too_large" };

async function readJson(response: Response): Promise<JsonReadResult> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (Number.isSafeInteger(bytes) && bytes > VERCEL_OPENROUTER_MAX_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      return { kind: "too_large" };
    }
  }

  if (!response.body) return { kind: "invalid" };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    return { kind: "invalid" };
  }
  const decoder = new TextDecoder();
  let text = "";
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const chunkBytes = chunk.value.byteLength;
      if (chunkBytes > VERCEL_OPENROUTER_MAX_RESPONSE_BYTES - totalBytes) {
        await reader.cancel().catch(() => undefined);
        return { kind: "too_large" };
      }
      totalBytes += chunkBytes;
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    await reader.cancel().catch(() => undefined);
    return { kind: "invalid" };
  } finally {
    reader.releaseLock();
  }

  try {
    return { kind: "parsed", value: JSON.parse(text) };
  } catch {
    return { kind: "invalid" };
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already being rejected; cancellation is best effort.
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
