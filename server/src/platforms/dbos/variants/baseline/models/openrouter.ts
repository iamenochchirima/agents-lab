import { loadDbosSdk } from "../../../sdk.js";
import type { DbosModelRequest, DbosModelResult } from "../contracts.js";

const { DBOS } = loadDbosSdk();

export async function completeOpenRouterModel(input: DbosModelRequest, apiKey: string, baseUrl: string): Promise<DbosModelResult> {
  const signal = DBOS.stepStatus?.timeoutSignal;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
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

  const body = await response.json() as {
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
