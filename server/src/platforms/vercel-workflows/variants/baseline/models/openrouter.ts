import type {
  VercelWorkflowModelRequest,
  VercelWorkflowModelResult,
} from "../contracts.js";

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

    const body = await readJson(response);
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

    const record = asRecord(body);
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
