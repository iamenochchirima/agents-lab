import type { StudioModelAdapter, StudioModelRequest, StudioModelResponse } from "./replay-model.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REQUEST_BYTES = 262_144;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_OUTPUT_CHARS = 100_000;

export interface StudioOpenRouterModelOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

export class StudioOpenRouterError extends Error {
  constructor(
    message: string,
    readonly details: { readonly code: string; readonly retryable: boolean; readonly requestSent: boolean },
  ) {
    super(message);
    this.name = "StudioOpenRouterError";
  }
}

/**
 * Minimal opt-in live model adapter. It owns only provider serialization and
 * response validation. Retry policy and experiment lifecycle stay in Studio.
 */
export class OpenRouterModelAdapter implements StudioModelAdapter {
  readonly provider = "openrouter" as const;
  readonly model: string;
  readonly adapterVersion = "1";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: StudioOpenRouterModelOptions) {
    if (!options.apiKey.trim()) throw new Error("Studio OpenRouter adapter requires an API key.");
    if (!options.model.trim()) throw new Error("Studio OpenRouter adapter requires a model.");
    if (!Number.isInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) || (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) < 1) {
      throw new Error("Studio OpenRouter adapter timeout must be a positive integer.");
    }
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async complete(request: StudioModelRequest, signal?: AbortSignal): Promise<StudioModelResponse> {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
    const body = JSON.stringify({
      model: this.model,
      messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
    });
    if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
      clearTimeout(timer);
      throw new StudioOpenRouterError("OpenRouter request exceeded the Studio limit.", {
        code: "OPENROUTER_REQUEST_TOO_LARGE",
        retryable: false,
        requestSent: false,
      });
    }
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: requestSignal,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "http-referer": "https://github.com/agent-harness-lab/agents-lab",
          "x-title": "Agent Harness Lab Studio",
        },
        body,
      });
    } catch (error) {
      const timedOut = timeoutController.signal.aborted && !signal?.aborted;
      throw new StudioOpenRouterError(
        timedOut ? "OpenRouter request timed out." : "OpenRouter request failed before a response was received.",
        { code: timedOut ? "OPENROUTER_TIMEOUT" : "OPENROUTER_TRANSPORT", retryable: true, requestSent: true },
      );
    }

    try {
      const bodyText = await readBoundedBody(response);
      if (!response.ok) {
        const contextOverflow = response.status === 400 && /context\s+(?:length|window|limit)|maximum\s+(?:context|input)|prompt\s+too\s+long|token\s+limit/i.test(bodyText);
        const retryable = contextOverflow || response.status === 408 || response.status === 409 || response.status === 425 || response.status === 429 || response.status >= 500;
        throw new StudioOpenRouterError(
          contextOverflow ? "OpenRouter rejected the Context because it exceeded the provider input limit." : `OpenRouter returned HTTP ${response.status}.`,
          { code: contextOverflow ? "OPENROUTER_CONTEXT_OVERFLOW" : `OPENROUTER_HTTP_${response.status}`, retryable, requestSent: true },
        );
      }

      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        throw new StudioOpenRouterError("OpenRouter returned invalid JSON.", { code: "OPENROUTER_INVALID_RESPONSE", retryable: false, requestSent: true });
      }
      const record = asRecord(body);
      const choices = Array.isArray(record.choices) ? record.choices : [];
      const message = asRecord(asRecord(choices[0]).message);
      const output = typeof message.content === "string" ? message.content.trim() : "";
      if (!output) {
        throw new StudioOpenRouterError("OpenRouter returned no assistant text.", { code: "OPENROUTER_EMPTY_RESPONSE", retryable: false, requestSent: true });
      }
      if (output.length > MAX_OUTPUT_CHARS) {
        throw new StudioOpenRouterError("OpenRouter output exceeded the Studio limit.", { code: "OPENROUTER_OUTPUT_TOO_LARGE", retryable: false, requestSent: true });
      }
      const usage = asRecord(record.usage);
      return {
        output,
        inputTokens: numberOrNull(usage.prompt_tokens),
        outputTokens: numberOrNull(usage.completion_tokens),
        providerRequestId: typeof record.id === "string" ? record.id : null,
        costUsd: numberOrNull(usage.cost),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw new StudioOpenRouterError("OpenRouter response exceeded the Studio limit.", { code: "OPENROUTER_RESPONSE_TOO_LARGE", retryable: false, requestSent: true });
  }
  return body;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
