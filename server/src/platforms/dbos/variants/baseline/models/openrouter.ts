import { loadDbosSdk } from "../../../sdk.js";
import type { DbosModelRequest, DbosModelResult } from "../contracts.js";

const { DBOS } = loadDbosSdk();

export const DBOS_OPENROUTER_MAX_RESPONSE_BYTES = 1_048_576;

export interface DbosOpenRouterModelOptions {
  readonly fetchImplementation?: typeof fetch;
}

export async function completeOpenRouterModel(
  input: DbosModelRequest,
  apiKey: string,
  baseUrl: string,
  options: DbosOpenRouterModelOptions = {},
): Promise<DbosModelResult> {
  const signal = DBOS.stepStatus?.timeoutSignal;
  let response: Response;
  try {
    response = await (options.fetchImplementation ?? fetch)(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
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
      message: "The OpenRouter request outcome could not be confirmed after dispatch.",
      failureKind: "outcome_unknown",
      retryable: false,
      requestSent: true,
      attemptCount: input.attempt,
    };
  }

  const bodyResult = await readJson(response);
  if (bodyResult.kind === "too_large") {
    return {
      kind: "failure",
      code: "OPENROUTER_RESPONSE_TOO_LARGE",
      message: "OpenRouter response exceeded the configured response limit.",
      failureKind: "provider",
      retryable: false,
      requestSent: true,
      attemptCount: input.attempt,
    };
  }
  if (!response.ok) {
    return {
      kind: "failure",
      code: "OPENROUTER_PROVIDER_ERROR",
      message: `OpenRouter returned HTTP ${response.status}.`,
      failureKind: "provider",
      retryable: response.status >= 500 || response.status === 429,
      requestSent: true,
      attemptCount: input.attempt,
    };
  }
  if (bodyResult.kind === "invalid") {
    return {
      kind: "failure",
      code: "OPENROUTER_INVALID_RESPONSE",
      message: "OpenRouter returned an invalid JSON response.",
      failureKind: "provider",
      retryable: false,
      requestSent: true,
      attemptCount: input.attempt,
    };
  }
  const body = bodyResult.value as {
    readonly id?: unknown;
    readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[];
    readonly usage?: { readonly prompt_tokens?: unknown; readonly completion_tokens?: unknown; readonly total_tokens?: unknown };
  };
  const output = body.choices?.[0]?.message?.content;
  if (typeof output !== "string") {
    return {
      kind: "failure",
      code: "OPENROUTER_INVALID_RESPONSE",
      message: "OpenRouter returned no text content.",
      failureKind: "provider",
      retryable: false,
      requestSent: true,
      attemptCount: input.attempt,
    };
  }

  return {
    kind: "success",
    output,
    providerRequestId: typeof body.id === "string" ? body.id : null,
    usage: {
      inputTokens: numberOrNull(body.usage?.prompt_tokens),
      outputTokens: numberOrNull(body.usage?.completion_tokens),
      totalTokens: numberOrNull(body.usage?.total_tokens),
    },
    attemptCount: input.attempt,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type JsonReadResult =
  | { readonly kind: "parsed"; readonly value: unknown }
  | { readonly kind: "invalid" }
  | { readonly kind: "too_large" };

async function readJson(response: Response): Promise<JsonReadResult> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (Number.isSafeInteger(bytes) && bytes > DBOS_OPENROUTER_MAX_RESPONSE_BYTES) {
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
      if (chunkBytes > DBOS_OPENROUTER_MAX_RESPONSE_BYTES - totalBytes) {
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
