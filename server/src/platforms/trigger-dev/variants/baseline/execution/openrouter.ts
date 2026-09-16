import type { RunUsage } from "../../../../../control-plane/domain/types.js";
import { TriggerBaselineTaskError, type TriggerPromptPayload } from "../contracts.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const REQUEST_TIMEOUT_MS = 30_000;
export const TRIGGER_OPENROUTER_MAX_RESPONSE_BYTES = 1_048_576;
export const TRIGGER_OPENROUTER_MAX_OUTPUT_BYTES = 100_000;

export interface TriggerOpenRouterModelResult {
  readonly output: string;
  readonly usage: RunUsage;
}

/**
 * Runs the provider call inside the Trigger task process. The task retry policy
 * remains the outer lifecycle boundary; an error after dispatch is classified
 * as outcome-unknown so inspection never turns an uncertain provider result
 * into a fabricated success.
 */
export async function completeTriggerOpenRouterModel(
  input: TriggerPromptPayload,
  signal: AbortSignal,
  fetchImplementation: typeof fetch = fetch,
): Promise<TriggerOpenRouterModelResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new TriggerBaselineTaskError(
      "TRIGGER_OPENROUTER_NOT_CONFIGURED",
      "configuration",
      "OPENROUTER_API_KEY is required for the Trigger.dev OpenRouter task.",
    );
  }
  if (signal.aborted) {
    throw new TriggerBaselineTaskError(
      "TRIGGER_OPENROUTER_CANCELLED",
      "cancelled",
      "The OpenRouter request was cancelled before dispatch.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetchImplementation(
      `${process.env.AGENTLAB_OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "http-referer": "https://github.com/agent-harness-lab",
          "x-title": "Agent Harness Lab Trigger.dev baseline",
        },
        body: JSON.stringify({
          model: input.model.model,
          messages: [
            { role: "system", content: input.systemInstruction },
            { role: "user", content: input.prompt },
          ],
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new TriggerBaselineTaskError(
        `TRIGGER_OPENROUTER_HTTP_${response.status}`,
        "provider",
        `OpenRouter returned HTTP ${response.status}.`,
      );
    }

    const bodyResult = await readJson(response);
    if (bodyResult.kind === "too_large") {
      throw new TriggerBaselineTaskError(
        "TRIGGER_OPENROUTER_RESPONSE_TOO_LARGE",
        "provider",
        "OpenRouter returned a response larger than the configured safety limit.",
      );
    }
    if (bodyResult.kind === "invalid") {
      throw new TriggerBaselineTaskError(
        "TRIGGER_OPENROUTER_INVALID_RESPONSE",
        "provider",
        "OpenRouter returned an invalid response.",
      );
    }

    const output = readText(bodyResult.value);
    if (!output) {
      throw new TriggerBaselineTaskError(
        "TRIGGER_OPENROUTER_EMPTY_RESPONSE",
        "provider",
        "OpenRouter returned no assistant text.",
      );
    }
    if (Buffer.byteLength(output, "utf8") > TRIGGER_OPENROUTER_MAX_OUTPUT_BYTES) {
      throw new TriggerBaselineTaskError(
        "TRIGGER_OPENROUTER_OUTPUT_TOO_LARGE",
        "provider",
        "OpenRouter assistant output exceeded the configured safety limit.",
      );
    }

    return { output, usage: readUsage(bodyResult.value) };
  } catch (error) {
    if (error instanceof TriggerBaselineTaskError) throw error;
    if (signal.aborted) {
      throw new TriggerBaselineTaskError("TRIGGER_OPENROUTER_CANCELLED", "cancelled", "The OpenRouter request was cancelled.");
    }
    throw new TriggerBaselineTaskError(
      "TRIGGER_OPENROUTER_OUTCOME_UNKNOWN",
      "outcome_unknown",
      "The OpenRouter response outcome could not be confirmed.",
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
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
      if (totalBytes > TRIGGER_OPENROUTER_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { kind: "too_large" };
      }
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

function readText(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices) || !isRecord(body.choices[0])) return null;
  const message = body.choices[0].message;
  return isRecord(message) && typeof message.content === "string" && message.content.trim() ? message.content : null;
}

function readUsage(body: unknown): RunUsage {
  const usage = isRecord(body) && isRecord(body.usage) ? body.usage : null;
  return {
    inputTokens: integerOrNull(usage?.prompt_tokens),
    outputTokens: integerOrNull(usage?.completion_tokens),
    totalTokens: integerOrNull(usage?.total_tokens),
  };
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object";
}
