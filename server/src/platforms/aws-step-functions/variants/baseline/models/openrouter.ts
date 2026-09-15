import type { AwsStepFunctionsActivityInput, AwsStepFunctionsModelResult } from "../contracts.js";

export interface OpenRouterModelOptions {
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly fetchImplementation: typeof fetch;
}

export async function runOpenRouterModel(
  input: AwsStepFunctionsActivityInput,
  options: OpenRouterModelOptions,
): Promise<AwsStepFunctionsModelResult> {
  if (!options.apiKey) {
    return {
      kind: "failure",
      code: "OpenRouterNotConfigured",
      message: "OpenRouter is not configured for the Step Functions service process.",
      failureKind: "configuration",
      retryable: false,
      requestSent: false,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let response: Response;
    try {
      response = await options.fetchImplementation(`${options.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
          "http-referer": "https://github.com/agent-harness-lab/agents-lab",
          "x-title": "Agent Harness Lab",
        },
        body: JSON.stringify({
          model: input.model,
          messages: [
            { role: "system", content: input.systemInstruction },
            { role: "user", content: input.prompt },
          ],
        }),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      return {
        kind: "failure",
        code: timedOut ? "OpenRouterTimeout" : "OpenRouterTransportError",
        message: timedOut ? "OpenRouter request timed out." : "OpenRouter request failed before a response was received.",
        failureKind: timedOut ? "timeout" : "provider",
        retryable: true,
        requestSent: true,
      };
    }

    const body = await readJson(response);
    if (!response.ok) {
      const status = response.status;
      return {
        kind: "failure",
        code: `OpenRouterHttp${status}`,
        message: `OpenRouter returned HTTP ${status}.`,
        failureKind: "provider",
        retryable: status === 408 || status === 409 || status === 425 || status === 429 || status >= 500,
        requestSent: true,
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
        code: "OpenRouterInvalidResponse",
        message: "OpenRouter returned no text content.",
        failureKind: "provider",
        retryable: false,
        requestSent: true,
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
  } finally {
    clearTimeout(timeout);
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
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
